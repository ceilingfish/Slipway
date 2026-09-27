/** The outcome of running a git command. */
export type GitResult =
  | { readonly kind: "succeeded"; readonly stdout: string }
  | { readonly kind: "failed"; readonly exitCode: number | undefined; readonly message: string };

/** Runs git commands. Injected so `core` never spawns processes itself. */
export interface Git {
  run(cwd: string, args: readonly string[]): Promise<GitResult>;
}

export type MainWorktree =
  | { readonly kind: "found"; readonly path: string }
  | { readonly kind: "not-a-repository"; readonly reason: string };

/**
 * Finds the main worktree of the repository containing `directory`, whether `directory` is the
 * main worktree itself, a linked worktree or a folder inside either. `git worktree list` always
 * lists the main worktree first.
 */
export const findMainWorktree = async (git: Git, directory: string): Promise<MainWorktree> => {
  const result = await git.run(directory, ["worktree", "list", "--porcelain"]);
  if (result.kind === "failed") {
    return { kind: "not-a-repository", reason: result.message };
  }
  const first = result.stdout.split("\n").find((line) => line.startsWith("worktree "));
  return first === undefined
    ? { kind: "not-a-repository", reason: "git listed no worktrees." }
    : { kind: "found", path: first.slice("worktree ".length) };
};

/** The URL of the `origin` remote exactly as git reports it, or `undefined` if there is none. */
export const readOriginRemote = async (
  git: Git,
  directory: string,
): Promise<string | undefined> => {
  const result = await git.run(directory, ["remote", "get-url", "origin"]);
  if (result.kind === "failed") {
    return undefined;
  }
  const url = result.stdout.trim();
  return url === "" ? undefined : url;
};
