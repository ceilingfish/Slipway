import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NodeFileSystem } from "../storage/node-file-system";
import type { Git, GitResult } from "./git";
import { RepositoryRegistry } from "./registry";
import { resolveRepository } from "./resolve";

const REMOTE = "git@github.com:ceilingfish/foo.git";

const WORKTREE_LIST = [
  "worktree /code/foo",
  "HEAD 0123456789abcdef0123456789abcdef01234567",
  "branch refs/heads/main",
  "",
  "worktree /code/foo-oauth-03-cli-login",
  "HEAD 0123456789abcdef0123456789abcdef01234567",
  "branch refs/heads/feature/oauth-03-cli-login",
  "",
].join("\n");

const ok = (stdout: string): GitResult => ({ kind: "succeeded", stdout });
const failed = (message: string): GitResult => ({ kind: "failed", exitCode: 128, message });

/** A fake git that answers from a table keyed by the command's arguments. */
const fakeGit = (answers: Readonly<Record<string, GitResult>>): Git => ({
  run: (_cwd, args) =>
    Promise.resolve(answers[args.join(" ")] ?? failed(`unexpected: ${args.join(" ")}`)),
});

const repository = (remote: GitResult): Git =>
  fakeGit({ "worktree list --porcelain": ok(WORKTREE_LIST), "remote get-url origin": remote });

describe("resolveRepository", () => {
  let home: string;
  let registry: RepositoryRegistry;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "spec-plans-resolve-"));
    registry = new RepositoryRegistry(new NodeFileSystem(), home);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("reports a directory that isn't in a git repository", async () => {
    const git = fakeGit({ "worktree list --porcelain": failed("fatal: not a git repository") });
    expect(await resolveRepository(git, registry, "/tmp/elsewhere")).toEqual({
      kind: "not-a-repository",
      directory: "/tmp/elsewhere",
      reason: "fatal: not a git repository",
    });
  });

  it("reports a repository without an origin remote", async () => {
    const git = repository({
      kind: "failed",
      exitCode: 2,
      message: "error: No such remote 'origin'",
    });
    expect(await resolveRepository(git, registry, "/code/foo-oauth-03-cli-login")).toEqual({
      kind: "no-origin",
      mainWorktree: "/code/foo",
    });
  });

  it("suggests the default folder for an unregistered remote", async () => {
    expect(await resolveRepository(repository(ok(`${REMOTE}\n`)), registry, "/code/foo")).toEqual({
      kind: "unregistered",
      mainWorktree: "/code/foo",
      remote: REMOTE,
      suggestedFolder: "githubcom-ceilingfish-foo",
    });
  });

  it("finds the folder of a registered remote", async () => {
    await registry.register({ remote: REMOTE, path: "foo" });
    expect(await resolveRepository(repository(ok(`${REMOTE}\n`)), registry, "/code/foo")).toEqual({
      kind: "registered",
      mainWorktree: "/code/foo",
      remote: REMOTE,
      folder: "foo",
      folderPath: join(home, "foo"),
    });
  });

  it("doesn't match a differently spelled URL for the same repository", async () => {
    await registry.register({ remote: "https://github.com/ceilingfish/foo.git", path: "foo" });
    const resolution = await resolveRepository(repository(ok(REMOTE)), registry, "/code/foo");
    expect(resolution.kind).toBe("unregistered");
  });

  it("reports an unreadable repositories.yml", async () => {
    await new NodeFileSystem().writeText(registry.file, "repositories: [\n");
    const resolution = await resolveRepository(repository(ok(REMOTE)), registry, "/code/foo");
    expect(resolution.kind).toBe("invalid-registry");
  });
});
