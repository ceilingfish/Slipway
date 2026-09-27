import { join } from "node:path";

import { defaultFolderName } from "./folder-name";
import { findMainWorktree, readOriginRemote, type Git } from "./git";
import { findEntry, type RepositoryRegistry } from "./registry";

/** How the open workspace maps to a repository folder under `~/.spec-plans`. */
export type RepositoryResolution =
  | { readonly kind: "not-a-repository"; readonly directory: string; readonly reason: string }
  | { readonly kind: "no-origin"; readonly mainWorktree: string }
  | {
      readonly kind: "invalid-registry";
      readonly mainWorktree: string;
      readonly remote: string;
      readonly reason: string;
    }
  | {
      readonly kind: "unregistered";
      readonly mainWorktree: string;
      readonly remote: string;
      /** The default folder name, if one can be derived from the remote. */
      readonly suggestedFolder: string | undefined;
    }
  | {
      readonly kind: "registered";
      readonly mainWorktree: string;
      readonly remote: string;
      /** The folder name from `repositories.yml`. */
      readonly folder: string;
      /** The absolute path of that folder. */
      readonly folderPath: string;
    };

/**
 * Resolves `directory` (the main repository, any of its worktrees, or a folder inside them) to
 * its main worktree and `origin` remote, and looks the remote up in `repositories.yml`.
 */
export const resolveRepository = async (
  git: Git,
  registry: RepositoryRegistry,
  directory: string,
): Promise<RepositoryResolution> => {
  const main = await findMainWorktree(git, directory);
  if (main.kind === "not-a-repository") {
    return { kind: "not-a-repository", directory, reason: main.reason };
  }
  const mainWorktree = main.path;
  const remote = await readOriginRemote(git, directory);
  if (remote === undefined) {
    return { kind: "no-origin", mainWorktree };
  }
  const contents = await registry.read();
  if (contents.kind === "invalid") {
    return { kind: "invalid-registry", mainWorktree, remote, reason: contents.reason };
  }
  const entry = findEntry(contents.entries, remote);
  if (entry === undefined) {
    return {
      kind: "unregistered",
      mainWorktree,
      remote,
      suggestedFolder: defaultFolderName(remote),
    };
  }
  return {
    kind: "registered",
    mainWorktree,
    remote,
    folder: entry.path,
    folderPath: join(registry.home, entry.path),
  };
};
