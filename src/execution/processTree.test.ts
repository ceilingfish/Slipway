import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { descendantsOf, killProcessTree, parsePs } from "./processTree";

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

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (check: () => Promise<boolean>, attempts = 100): Promise<void> => {
  if (await check()) {
    return;
  }
  if (attempts <= 0) {
    throw new Error("timed out");
  }
  await delay(20);
  await waitFor(check, attempts - 1);
};

describe.skipIf(process.platform === "win32")("killProcessTree", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "process-tree-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("kills a grandchild that was moved to its own process group", async () => {
    const pidFile = join(dir, "grandchild.pid");
    // The child starts a detached grandchild, as Claude does for tool commands.
    const script = `
      const { spawn } = require("node:child_process");
      const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
      require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const exited = new Promise<NodeJS.Signals | null>((resolve) => {
      child.on("exit", (_code, signal) => {
        resolve(signal);
      });
    });
    const childPid = child.pid ?? 0;
    let grandchildPid = 0;
    await waitFor(async () => {
      grandchildPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      return grandchildPid > 0;
    });

    await killProcessTree(childPid, 2000);

    await waitFor(() => Promise.resolve(!isAlive(grandchildPid)));
    expect(await exited).toBe("SIGTERM");
  });

  it("falls back to SIGKILL for a process that ignores SIGTERM", async () => {
    const child = spawn(
      process.execPath,
      ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
      { stdio: "ignore" },
    );
    const exited = new Promise<NodeJS.Signals | null>((resolve) => {
      child.on("exit", (_code, signal) => {
        resolve(signal);
      });
    });
    await delay(200);

    await killProcessTree(child.pid ?? 0, 100);

    expect(await exited).toBe("SIGKILL");
  });
});
