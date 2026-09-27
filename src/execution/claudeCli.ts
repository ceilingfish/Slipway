import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Execution, ExecutionRequest, ExecutionStrategy, RunOutcome } from "../core/execution";
import { ClaudeRun } from "./claudeRun";

export interface ClaudeCliOptions {
  /** The `claude` executable: a name on the PATH, or a path. */
  readonly executable?: string;
  /** Added after the standard arguments, e.g. `["--model", "sonnet"]`. */
  readonly extraArgs?: readonly string[];
  /** The agent's environment. Defaults to the extension's. */
  readonly env?: NodeJS.ProcessEnv;
  /** How long cancelled processes get to exit before they are killed. */
  readonly killGraceMs?: number;
  /** Diagnostics: Claude's stderr and anything that went wrong running it. */
  readonly log?: (message: string) => void;
  readonly newSessionId?: () => string;
}

/**
 * The arguments for a headless run. The prompt goes to stdin, so its size isn't
 * limited by the command line. `--output-format stream-json` needs `--verbose`
 * in print mode. New sessions get their id up front with `--session-id`; a
 * resumed session keeps its id.
 */
export const claudeArgs = (
  request: ExecutionRequest,
  sessionId: string,
  extraArgs: readonly string[] = [],
): string[] => [
  "--print",
  "--verbose",
  "--output-format",
  "stream-json",
  "--permission-mode",
  "auto",
  ...(request.resumeSessionId === undefined
    ? ["--session-id", sessionId]
    : ["--resume", request.resumeSessionId]),
  ...extraArgs,
];

const DEFAULT_KILL_GRACE_MS = 5000;

/**
 * Runs agents with the `claude` CLI in print mode and auto permission mode.
 * Reviews, the planner and task runs all go through here.
 *
 * Agents are children of the extension: call `dispose` when the extension
 * deactivates, so no agent outlives it. Anything recorded as running when the
 * extension next starts was interrupted, and is recorded as cancelled (see
 * `statusOnStartup`).
 */
export class ClaudeCli implements ExecutionStrategy {
  readonly name = "claude";
  readonly #running = new Set<Execution>();

  constructor(private readonly options: ClaudeCliOptions = {}) {}

  start(request: ExecutionRequest): Execution {
    const sessionId = request.resumeSessionId ?? (this.options.newSessionId ?? randomUUID)();
    const log = this.options.log ?? ((): void => undefined);
    const child = spawn(
      this.options.executable ?? "claude",
      claudeArgs(request, sessionId, this.options.extraArgs),
      { cwd: request.cwd, env: this.options.env ?? process.env, stdio: "pipe", windowsHide: true },
    );
    child.stdin.on("error", (error) => {
      log(`Couldn't send the prompt to claude: ${error.message}`);
    });
    child.stdin.end(request.prompt);
    const run = new ClaudeRun(sessionId, child, {
      killGraceMs: this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      log,
    });
    this.#running.add(run);
    void run.done.then(() => this.#running.delete(run));
    return run;
  }

  /** Cancels every running agent, and waits for them to stop. */
  async dispose(): Promise<RunOutcome[]> {
    const running = [...this.#running];
    for (const run of running) {
      run.cancel();
    }
    return Promise.all(running.map(async (run) => run.done));
  }
}
