import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { LogEntry } from "../core/agentLog";
import type { Execution, RunOutcome, RunStatus, Unsubscribe } from "../core/execution";
import { parseStreamLine, type StreamResult } from "./claudeStream";
import { killProcessTree } from "./processTree";

export interface ClaudeRunSettings {
  readonly killGraceMs: number;
  readonly log: (message: string) => void;
}

export interface ProcessEnd {
  readonly cancelled: boolean;
  /** `null` when the process was killed by a signal or never started. */
  readonly exitCode: number | null;
  readonly result: StreamResult | undefined;
}

/**
 * A run finishes only when Claude exits cleanly and reports a successful
 * result. A cancelled run is cancelled however it then exited.
 */
export const outcomeOf = (sessionId: string, end: ProcessEnd): RunOutcome => {
  if (end.cancelled) {
    return { status: "cancelled", sessionId };
  }
  if (end.exitCode === 0 && end.result !== undefined && !end.result.isError) {
    return { status: "finished", sessionId, resultText: end.result.text ?? "" };
  }
  return { status: "failed", sessionId };
};

/** One `claude` process, from spawn to exit. */
export class ClaudeRun implements Execution {
  readonly done: Promise<RunOutcome>;
  #status: RunStatus = "running";
  readonly #entries: LogEntry[] = [];
  readonly #listeners = new Set<(entry: LogEntry) => void>();
  #cancelled = false;
  #result: StreamResult | undefined;

  constructor(
    readonly sessionId: string,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly settings: ClaudeRunSettings,
  ) {
    this.done = new Promise((resolve) => {
      const settle = (exitCode: number | null): void => {
        if (this.#status !== "running") {
          return;
        }
        const outcome = outcomeOf(sessionId, {
          cancelled: this.#cancelled,
          exitCode,
          result: this.#result,
        });
        this.#status = outcome.status;
        resolve(outcome);
      };
      child.on("error", (error) => {
        settings.log(`claude: ${error.message}`);
        settle(null);
      });
      child.on("close", settle);
    });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      this.#onLine(line);
    });
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", (line) => {
      settings.log(`claude: ${line}`);
    });
  }

  get pid(): number | undefined {
    return this.#status === "running" ? this.child.pid : undefined;
  }

  get status(): RunStatus {
    return this.#status;
  }

  get entries(): readonly LogEntry[] {
    return this.#entries;
  }

  onEntry(listener: (entry: LogEntry) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  cancel(): void {
    const pid = this.pid;
    if (this.#cancelled || pid === undefined) {
      return;
    }
    this.#cancelled = true;
    killProcessTree(pid, this.settings.killGraceMs).catch((error: unknown) => {
      this.settings.log(`Couldn't stop claude (pid ${String(pid)}): ${String(error)}`);
    });
  }

  #onLine(line: string): void {
    const parsed = parseStreamLine(line);
    if (parsed.init !== undefined && parsed.init.permissionMode !== "auto") {
      // Claude silently falls back to another mode, e.g. for models without
      // auto mode, and tool calls are then denied with no one to approve them.
      this.settings.log(
        `claude is running in ${parsed.init.permissionMode ?? "an unknown"} permission mode, not auto`,
      );
    }
    this.#result = parsed.result ?? this.#result;
    for (const entry of parsed.entries) {
      this.#entries.push(entry);
      for (const listener of this.#listeners) {
        listener(entry);
      }
    }
  }
}
