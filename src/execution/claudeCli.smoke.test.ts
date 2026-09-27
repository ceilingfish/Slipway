import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import type { LogEntry } from "../core/agentLog";
import { ClaudeCli } from "./claudeCli";

const SLEEP = "sleep 117";

const sleeping = (): string[] =>
  execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" })
    .split("\n")
    .filter((command) => command.trim() === SLEEP);

const waitFor = async (check: () => boolean, attempts = 600): Promise<void> => {
  if (check()) {
    return;
  }
  if (attempts <= 0) {
    throw new Error("timed out");
  }
  await delay(100);
  await waitFor(check, attempts - 1);
};

// Runs the real `claude` CLI, which costs usage. Opt in with:
//   SPEC_PLANS_CLAUDE_SMOKE=1 pnpm test claudeCli.smoke
describe.runIf(process.env["SPEC_PLANS_CLAUDE_SMOKE"] === "1")("ClaudeCli with real claude", () => {
  let dir = "";
  const messages: string[] = [];
  const cli = new ClaudeCli({ log: (message) => messages.push(message) });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-smoke-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs a prompt, streams its log, and resumes the session", async () => {
    const run = cli.start({
      cwd: dir,
      prompt: "Create a file called note.txt containing 'pong', then reply with exactly: pong",
    });
    const streamed: LogEntry[] = [];
    run.onEntry((entry) => streamed.push(entry));

    const outcome = await run.done;
    expect(outcome).toEqual({ status: "finished", sessionId: run.sessionId, resultText: "pong" });
    expect(streamed).toContainEqual(expect.objectContaining({ kind: "edit", tool: "Write" }));
    expect(messages).not.toContainEqual(expect.stringContaining("permission mode"));

    const resumed = cli.start({
      cwd: dir,
      prompt: "What did you write in note.txt? Reply with just its contents.",
      resumeSessionId: run.sessionId,
    });
    expect(await resumed.done).toEqual({
      status: "finished",
      sessionId: run.sessionId,
      resultText: "pong",
    });
  }, 180_000);

  it("cancels a running agent, and the command it is running", async () => {
    const run = cli.start({
      cwd: dir,
      prompt: `Run the shell command \`${SLEEP}\` in the foreground, then say done.`,
    });
    await waitFor(() => sleeping().length > 0);

    run.cancel();

    expect((await run.done).status).toBe("cancelled");
    await waitFor(() => sleeping().length === 0);
  }, 180_000);
});
