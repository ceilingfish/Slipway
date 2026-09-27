import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LogEntry } from "../core/agentLog";
import type { Execution } from "../core/execution";
import { ClaudeCli, type ClaudeCliOptions, claudeArgs } from "./claudeCli";
import { outcomeOf } from "./claudeRun";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

// Stands in for `claude`: records how it was invoked, then behaves as told by
// FAKE_* environment variables.
const FAKE_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const env = process.env;
const stdin = fs.readFileSync(0, "utf8");
fs.writeFileSync(env.FAKE_RECORD, JSON.stringify({ args: process.argv.slice(2), stdin, cwd: process.cwd() }));
if (env.FAKE_STDERR) process.stderr.write(env.FAKE_STDERR + "\\n");
if (env.FAKE_MODE === "hang") {
  const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  fs.writeFileSync(env.FAKE_GRANDCHILD, String(grandchild.pid));
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "s", permissionMode: "auto" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }) + "\\n");
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(env.FAKE_OUTPUT ? fs.readFileSync(env.FAKE_OUTPUT, "utf8") : "");
  process.exitCode = Number(env.FAKE_EXIT ?? "0");
}
`;

interface Recorded {
  readonly args: string[];
  readonly stdin: string;
  readonly cwd: string;
}

const isRecorded = (value: unknown): value is Recorded =>
  typeof value === "object" &&
  value !== null &&
  "args" in value &&
  Array.isArray(value.args) &&
  "stdin" in value &&
  typeof value.stdin === "string";

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const firstEntry = async (run: Execution): Promise<LogEntry> =>
  new Promise((resolve) => {
    const unsubscribe = run.onEntry((entry) => {
      unsubscribe();
      resolve(entry);
    });
  });

describe.skipIf(process.platform === "win32")("ClaudeCli", () => {
  let dir = "";
  let executable = "";
  let record = "";
  let messages: string[] = [];

  const cli = (env: Record<string, string> = {}, options: ClaudeCliOptions = {}): ClaudeCli =>
    new ClaudeCli({
      executable,
      env: { ...process.env, FAKE_RECORD: record, ...env },
      newSessionId: () => "new-session",
      killGraceMs: 1000,
      log: (message) => messages.push(message),
      ...options,
    });

  const recorded = async (): Promise<Recorded> => {
    const value: unknown = JSON.parse(await readFile(record, "utf8"));
    if (!isRecorded(value)) {
      throw new Error("The fake claude didn't record its invocation");
    }
    return value;
  };

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "claude-cli-")));
    executable = join(dir, "claude");
    record = join(dir, "record.json");
    messages = [];
    await writeFile(executable, FAKE_CLAUDE);
    await chmod(executable, 0o755);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs claude headless in auto mode, in the directory, with the prompt on stdin", async () => {
    const run = cli({ FAKE_OUTPUT: fixture("tools-run.jsonl") }).start({
      cwd: dir,
      prompt: "Do the thing",
    });
    await run.done;

    expect(await recorded()).toEqual({
      args: [
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "auto",
        "--session-id",
        "new-session",
      ],
      stdin: "Do the thing",
      cwd: dir,
    });
  });

  it("streams log entries and finishes with the result text", async () => {
    const run = cli({ FAKE_OUTPUT: fixture("tools-run.jsonl") }).start({ cwd: dir, prompt: "p" });
    const streamed: LogEntry[] = [];
    run.onEntry((entry) => streamed.push(entry));

    expect(run.status).toBe("running");
    expect(run.sessionId).toBe("new-session");
    expect(await run.done).toEqual({
      status: "finished",
      sessionId: "new-session",
      resultText: expect.stringContaining("edited it to 'two'") as unknown,
    });
    expect(run.status).toBe("finished");
    expect(run.pid).toBeUndefined();
    expect(streamed.map((entry) => entry.kind)).toEqual([
      "read",
      "output",
      "edit",
      "output",
      "edit",
      "output",
      "command",
      "output",
      "commentary",
    ]);
    expect(run.entries).toEqual(streamed);
  });

  it("resumes a session", async () => {
    const run = cli({ FAKE_OUTPUT: fixture("resumed-run.jsonl") }).start({
      cwd: dir,
      prompt: "And then?",
      resumeSessionId: "a854db5c-e9ed-4556-9fa4-b9878b75e000",
    });

    expect(await run.done).toEqual({
      status: "finished",
      sessionId: "a854db5c-e9ed-4556-9fa4-b9878b75e000",
      resultText: "two",
    });
    expect((await recorded()).args.slice(-2)).toEqual([
      "--resume",
      "a854db5c-e9ed-4556-9fa4-b9878b75e000",
    ]);
  });

  it("passes extra arguments after the standard ones", async () => {
    const run = cli({}, { extraArgs: ["--model", "sonnet"] }).start({ cwd: dir, prompt: "p" });
    await run.done;
    expect((await recorded()).args.slice(-2)).toEqual(["--model", "sonnet"]);
  });

  it("fails when claude reports an error and exits non-zero", async () => {
    const run = cli({ FAKE_OUTPUT: fixture("failed-resume.jsonl"), FAKE_EXIT: "1" }).start({
      cwd: dir,
      prompt: "p",
    });
    expect(await run.done).toEqual({ status: "failed", sessionId: "new-session" });
    expect(run.status).toBe("failed");
    expect(run.entries).toEqual([expect.objectContaining({ kind: "error" })]);
  });

  it("fails when claude exits without a result", async () => {
    const run = cli().start({ cwd: dir, prompt: "p" });
    expect((await run.done).status).toBe("failed");
  });

  it("fails when the executable doesn't exist", async () => {
    const run = cli({}, { executable: join(dir, "missing") }).start({ cwd: dir, prompt: "p" });
    expect((await run.done).status).toBe("failed");
    expect(messages).toEqual([expect.stringContaining("ENOENT")]);
  });

  it("logs claude's stderr and a permission mode other than auto", async () => {
    const run = cli({
      FAKE_OUTPUT: fixture("permission-denied-run.jsonl"),
      FAKE_STDERR: "a warning",
    }).start({ cwd: dir, prompt: "p" });
    await run.done;
    expect(messages).toEqual(
      expect.arrayContaining([
        "claude: a warning",
        "claude is running in default permission mode, not auto",
      ]),
    );
  });

  it("cancels a run, killing everything it started", async () => {
    const grandchildFile = join(dir, "grandchild.pid");
    const run = cli({ FAKE_MODE: "hang", FAKE_GRANDCHILD: grandchildFile }).start({
      cwd: dir,
      prompt: "p",
    });
    expect(await firstEntry(run)).toEqual({ kind: "commentary", text: "working" });
    const grandchild = Number(await readFile(grandchildFile, "utf8"));
    expect(isAlive(grandchild)).toBe(true);

    run.cancel();
    run.cancel();

    expect(await run.done).toEqual({ status: "cancelled", sessionId: "new-session" });
    expect(run.status).toBe("cancelled");
    await delay(100);
    expect(isAlive(grandchild)).toBe(false);
  });

  it("ignores cancel once a run has ended", async () => {
    const run = cli({ FAKE_OUTPUT: fixture("resumed-run.jsonl") }).start({ cwd: dir, prompt: "p" });
    await run.done;
    run.cancel();
    expect(run.status).toBe("finished");
  });

  it("cancels every running agent on dispose", async () => {
    const strategy = cli({ FAKE_MODE: "hang", FAKE_GRANDCHILD: join(dir, "grandchild.pid") });
    const runs = [
      strategy.start({ cwd: dir, prompt: "a" }),
      strategy.start({ cwd: dir, prompt: "b" }),
    ];
    await Promise.all(runs.map(firstEntry));

    const outcomes = await strategy.dispose();

    expect(outcomes.map((outcome) => outcome.status)).toEqual(["cancelled", "cancelled"]);
    expect(await strategy.dispose()).toEqual([]);
  });
});

describe("claudeArgs", () => {
  it("starts a new session with its id", () => {
    expect(claudeArgs({ cwd: "/", prompt: "p" }, "id")).toContain("--session-id");
  });
});

describe("outcomeOf", () => {
  const success = { isError: false, text: "done" };

  it("is cancelled when cancel was requested, however the process exited", () => {
    expect(outcomeOf("s", { cancelled: true, exitCode: 0, result: success })).toEqual({
      status: "cancelled",
      sessionId: "s",
    });
  });

  it("is failed for a non-zero exit, an error result or a missing result", () => {
    expect(outcomeOf("s", { cancelled: false, exitCode: 1, result: success }).status).toBe(
      "failed",
    );
    expect(
      outcomeOf("s", { cancelled: false, exitCode: 0, result: { isError: true, text: "x" } })
        .status,
    ).toBe("failed");
    expect(outcomeOf("s", { cancelled: false, exitCode: 0, result: undefined }).status).toBe(
      "failed",
    );
    expect(outcomeOf("s", { cancelled: false, exitCode: null, result: success }).status).toBe(
      "failed",
    );
  });

  it("finishes with an empty result text when claude gives none", () => {
    expect(
      outcomeOf("s", {
        cancelled: false,
        exitCode: 0,
        result: { isError: false, text: undefined },
      }),
    ).toEqual({ status: "finished", sessionId: "s", resultText: "" });
  });
});
