import type { LogEntry } from "./agentLog";

/**
 * How a run ended. The status is all the tool reports about a run: there is
 * deliberately no failure reason.
 */
export type RunOutcome =
  | {
      readonly status: "finished";
      readonly sessionId: string;
      /** The agent's final answer, e.g. a review's criteria or a planner reply. */
      readonly resultText: string;
    }
  | { readonly status: "failed"; readonly sessionId: string }
  | { readonly status: "cancelled"; readonly sessionId: string };

export type RunStatus = "running" | RunOutcome["status"];

export interface ExecutionRequest {
  /** The directory the agent works in, e.g. a task's worktree. */
  readonly cwd: string;
  readonly prompt: string;
  /**
   * Continue an earlier session rather than starting a new one. The planner
   * resumes the same session for every message in its conversation.
   */
  readonly resumeSessionId?: string;
}

export type Unsubscribe = () => void;

/** One running (or finished) agent session. */
export interface Execution {
  /**
   * The agent session's id, known from the start. Pass it back as
   * `resumeSessionId` to continue the conversation.
   */
  readonly sessionId: string;
  /** The OS process id, while the agent process is known to exist. */
  readonly pid: number | undefined;
  readonly status: RunStatus;
  /** Everything logged so far, in order. */
  readonly entries: readonly LogEntry[];
  /** Called for every log entry logged from now on. */
  onEntry(listener: (entry: LogEntry) => void): Unsubscribe;
  /** Stops the agent and everything it started. Safe to call more than once. */
  cancel(): void;
  /** Settles once the agent process and its output have ended. Never rejects. */
  readonly done: Promise<RunOutcome>;
}

/**
 * How an agent is run: how it is started, how its log is captured, how it is
 * cancelled and how its final status is determined.
 */
export interface ExecutionStrategy {
  /** Recorded as e.g. a review's `reviewer`. */
  readonly name: string;
  start(request: ExecutionRequest): Execution;
}

/**
 * The status to record for a stored run when the extension starts. Agents are
 * children of the extension and are killed when it stops, so a run still
 * recorded as running was interrupted: it is recorded as cancelled.
 */
export const statusOnStartup = (recorded: RunStatus): RunOutcome["status"] =>
  recorded === "running" ? "cancelled" : recorded;
