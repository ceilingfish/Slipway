import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { descendantsOf, isAlive, killProcessTree, parsePs } from "./processTree";

describe("descendantsOf", () => {
  it("finds children, grandchildren and nothing else", () => {
    const processes = [
      [1, 0],
      [10, 1],
      [11, 10],
      [12, 11],
      [13, 10],
      [20, 1],
    ] as const;
    expect(descendantsOf(10, processes).toSorted((a, b) => a - b)).toEqual([11, 12, 13]);
    expect(descendantsOf(12, processes)).toEqual([]);
  });

  it("survives a cycle", () => {
    expect(
      descendantsOf(1, [
        [2, 1],
        [1, 2],
      ]),
    ).toEqual([2]);
  });
});

describe("parsePs", () => {
  it("reads pid and parent pid columns", () => {
    expect(parsePs("    1     0\n  523     1\n\nbad line\n")).toEqual([
      [1, 0],
      [523, 1],
    ]);
  });
});

const exitSignal = async (child: ChildProcess): Promise<NodeJS.Signals | null> => {
  await once(child, "exit");
  return child.signalCode;
};

const processesMatching = (marker: string): string[] =>
  execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" })
    .split("\n")
    .filter((command) => command.includes(marker));

describe.skipIf(process.platform === "win32")("killProcessTree", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "process-tree-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Starts a process that starts a detached grandchild, as Claude does for
  // tool commands, and waits until the grandchild has run its script.
  const startTree = async (grandchildScript: string): Promise<[ChildProcess, number]> => {
    const pidFile = join(dir, "grandchild.pid");
    const ready = `${grandchildScript}; require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`;
    const script = `
      const { spawn } = require("node:child_process");
      spawn(process.execPath, ["-e", ${JSON.stringify(ready)}], { detached: true, stdio: "ignore" });
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const readPid = async (): Promise<number> =>
      Number(await readFile(pidFile, "utf8").catch(() => "0"));
    await expect.poll(readPid, { timeout: 10_000 }).toBeGreaterThan(0);
    return [child, await readPid()];
  };

  it("kills the process, and asks its descendants in other process groups to stop", async () => {
    const termFile = join(dir, "terminated");
    const [child, grandchild] = await startTree(
      `process.on("SIGTERM", () => { require("node:fs").writeFileSync(${JSON.stringify(termFile)}, ""); process.exit(0); }); setInterval(() => {}, 1000);`,
    );
    const exited = exitSignal(child);

    await killProcessTree(child.pid ?? 0, 2000);

    expect(await exited).toBe("SIGKILL");
    await expect.poll(() => isAlive(grandchild)).toBe(false);
    expect(await readFile(termFile, "utf8")).toBe("");
  });

  it("kills descendants that ignore SIGTERM once the grace period is over", async () => {
    const [child, grandchild] = await startTree(
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);',
    );

    await killProcessTree(child.pid ?? 0, 100);

    await expect.poll(() => isAlive(grandchild)).toBe(false);
  });

  it("leaves nothing behind when the process keeps starting children", async () => {
    const marker = `spawn-storm-${String(process.pid)}-${String(Date.now())}`;
    const script = `
      const { spawn } = require("node:child_process");
      setInterval(() => {
        spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ${JSON.stringify(marker)}], { detached: true, stdio: "ignore" });
      }, 5);
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    await expect.poll(() => processesMatching(marker).length).toBeGreaterThan(5);

    await killProcessTree(child.pid ?? 0, 1000);

    await expect.poll(() => processesMatching(marker).length).toBe(0);
  });
});
