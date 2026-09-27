import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RepositoryRegistry } from "../core/repositories/registry";
import { resolveRepository } from "../core/repositories/resolve";
import { NodeFileSystem } from "../core/storage/node-file-system";
import { ProcessGit } from "./git";

const REMOTE = "git@github.com:ceilingfish/foo.git";
const git = new ProcessGit();

const run = async (cwd: string, ...args: string[]): Promise<string> => {
  const result = await git.run(cwd, args);
  if (result.kind === "failed") {
    throw new Error(`git ${args.join(" ")} failed: ${result.message}`);
  }
  return result.stdout;
};

/** Creates a repository with one commit on `main`. */
const createRepository = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true });
  await run(path, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(path, "README.md"), "# foo\n");
  await run(path, "add", "README.md");
  await run(
    path,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "Initial",
  );
};

describe("ProcessGit", () => {
  let root: string;

  beforeAll(async () => {
    // realpath, because macOS's temp directory is behind a symlink and git reports real paths.
    root = await realpath(await mkdtemp(join(tmpdir(), "spec-plans-git-")));
    // Keep the developer's own git config (e.g. url.insteadOf) out of the tests.
    await writeFile(join(root, "gitconfig"), "");
    vi.stubEnv("GIT_CONFIG_GLOBAL", join(root, "gitconfig"));
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("returns the output of a successful command", async () => {
    expect(await git.run(root, ["--version"])).toMatchObject({ kind: "succeeded" });
  });

  it("reports the exit code and stderr of a failed command", async () => {
    const outside = await mkdtemp(join(tmpdir(), "spec-plans-not-git-"));
    try {
      const result = await git.run(outside, ["rev-parse", "--git-dir"]);
      expect(result).toMatchObject({ kind: "failed", exitCode: 128 });
      expect(result.kind === "failed" && result.message).toMatch(/not a git repository/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reports a missing working directory as a failure", async () => {
    const result = await git.run(join(root, "missing"), ["status"]);
    expect(result).toMatchObject({ kind: "failed", exitCode: undefined });
  });

  describe("repository resolution", () => {
    let main: string;
    let worktree: string;
    let registry: RepositoryRegistry;

    beforeAll(async () => {
      main = join(root, "foo");
      worktree = join(root, "foo-oauth-03-cli-login");
      await createRepository(main);
      await run(main, "worktree", "add", "--quiet", "-b", "feature/oauth-03-cli-login", worktree);
      await mkdir(join(worktree, "src"));
      registry = new RepositoryRegistry(new NodeFileSystem(), join(root, ".spec-plans"));
    });

    it("resolves a repository without origin to its main worktree", async () => {
      expect(await resolveRepository(git, registry, worktree)).toEqual({
        kind: "no-origin",
        mainWorktree: main,
      });
    });

    it("offers the default folder once origin is set", async () => {
      await run(main, "remote", "add", "origin", REMOTE);
      expect(await resolveRepository(git, registry, worktree)).toEqual({
        kind: "unregistered",
        mainWorktree: main,
        remote: REMOTE,
        suggestedFolder: "githubcom-ceilingfish-foo",
      });
    });

    it("resolves the main repo and its worktrees to the same folder", async () => {
      await registry.register({ remote: REMOTE, path: "githubcom-ceilingfish-foo" });
      const expected = {
        kind: "registered",
        mainWorktree: main,
        remote: REMOTE,
        folder: "githubcom-ceilingfish-foo",
        folderPath: join(root, ".spec-plans", "githubcom-ceilingfish-foo"),
      };
      const directories = [main, worktree, join(worktree, "src")];
      const resolutions = await Promise.all(
        directories.map(async (directory) => resolveRepository(git, registry, directory)),
      );
      expect(resolutions).toEqual([expected, expected, expected]);
    });

    it("reports a folder outside any repository", async () => {
      const resolution = await resolveRepository(git, registry, root);
      expect(resolution).toMatchObject({ kind: "not-a-repository", directory: root });
    });
  });
});
