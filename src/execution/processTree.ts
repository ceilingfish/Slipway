import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Every descendant of `root`, given `[pid, parentPid]` pairs for every
 * process. Claude runs tool commands in their own process groups, so killing
 * the agent's process group isn't enough: the tree has to be walked.
 */
export const descendantsOf = (
  root: number,
  processes: readonly (readonly [number, number])[],
): number[] => {
  const children = new Map<number, number[]>();
  for (const [pid, parent] of processes) {
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  const found: number[] = [];
  const pending = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const child of children.get(next) ?? []) {
      if (child !== root && !found.includes(child)) {
        found.push(child);
        pending.push(child);
      }
    }
  }
  return found;
};

/** Parses `ps -A -o pid= -o ppid=` output into `[pid, parentPid]` pairs. */
export const parsePs = (output: string): [number, number][] =>
  output
    .split("\n")
    .map((line) => line.trim().split(/\s+/u).map(Number))
    .flatMap(([pid, parent]) =>
      pid !== undefined && parent !== undefined && Number.isInteger(pid) && Number.isInteger(parent)
        ? [[pid, parent] as [number, number]]
        : [],
    );

const listProcesses = async (): Promise<[number, number][]> => {
  const { stdout } = await execFileAsync("ps", ["-A", "-o", "pid=", "-o", "ppid="]);
  return parsePs(stdout);
};

const signal = (pid: number, name: NodeJS.Signals): void => {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const POLL_MS = 50;

/** Polls until every process has exited, or `timeoutMs` has passed. */
const waitForExit = async (pids: readonly number[], timeoutMs: number): Promise<boolean> => {
  if (!pids.some(isAlive)) {
    return true;
  }
  if (timeoutMs <= 0) {
    return false;
  }
  await delay(POLL_MS);
  return waitForExit(pids, timeoutMs - POLL_MS);
};

const killPosixTree = async (root: number, graceMs: number): Promise<void> => {
  // Snapshot the tree before signalling: once a parent dies its children are
  // re-parented to init and can no longer be found from the root.
  const tree = [root, ...descendantsOf(root, await listProcesses())];
  for (const pid of tree) {
    signal(pid, "SIGTERM");
  }
  if (await waitForExit(tree, graceMs)) {
    return;
  }
  const processes = await listProcesses();
  const survivors = tree.filter(isAlive);
  const late = survivors.flatMap((pid) => descendantsOf(pid, processes));
  for (const pid of [...survivors, ...late]) {
    signal(pid, "SIGKILL");
  }
};

const killWindowsTree = async (root: number): Promise<void> => {
  try {
    await execFileAsync("taskkill", ["/pid", String(root), "/T", "/F"]);
  } catch {
    // taskkill fails when the process has already exited.
  }
};

/**
 * Terminates a process and everything it started. On POSIX each process gets
 * SIGTERM, then SIGKILL if it's still running after `graceMs`.
 */
export const killProcessTree = async (root: number, graceMs: number): Promise<void> => {
  await (process.platform === "win32" ? killWindowsTree(root) : killPosixTree(root, graceMs));
};
