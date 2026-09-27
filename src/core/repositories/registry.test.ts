import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NodeFileSystem } from "../storage/node-file-system";
import { findEntry, parseRegistry, RepositoryRegistry } from "./registry";

const FOO = { remote: "git@github.com:ceilingfish/foo.git", path: "githubcom-ceilingfish-foo" };
const BAR = { remote: "https://gitlab.example.com/team/bar.git", path: "work-bar" };

describe("parseRegistry", () => {
  it("reads the PRD's example", () => {
    const text = [
      "repositories:",
      `  - remote: ${FOO.remote}`,
      `    path: ${FOO.path}`,
      `  - remote: ${BAR.remote}`,
      `    path: ${BAR.path}`,
    ].join("\n");
    expect(parseRegistry(text)).toEqual({ kind: "loaded", entries: [FOO, BAR] });
  });

  it.each([undefined, "", "# nothing yet\n", "repositories:\n", "repositories: []\n"])(
    "treats %j as empty",
    (text) => {
      expect(parseRegistry(text)).toEqual({ kind: "loaded", entries: [] });
    },
  );

  it.each([
    ["broken YAML", "repositories: [\n"],
    ["a top-level list", "- remote: a\n  path: b\n"],
    ["repositories that aren't a list", "repositories: nope\n"],
    ["an entry without a path", "repositories:\n  - remote: a\n"],
    ["a nested path", "repositories:\n  - remote: a\n    path: a/b\n"],
  ])("rejects %s", (_, text) => {
    expect(parseRegistry(text).kind).toBe("invalid");
  });
});

describe("findEntry", () => {
  it("matches the remote exactly, without normalisation", () => {
    expect(findEntry([FOO, BAR], FOO.remote)).toEqual(FOO);
    expect(findEntry([FOO], "https://github.com/ceilingfish/foo.git")).toBeUndefined();
    expect(findEntry([FOO], "git@github.com:ceilingfish/foo")).toBeUndefined();
  });
});

describe("RepositoryRegistry", () => {
  let home: string;
  let registry: RepositoryRegistry;

  beforeEach(async () => {
    home = join(await mkdtemp(join(tmpdir(), "spec-plans-registry-")), ".spec-plans");
    registry = new RepositoryRegistry(new NodeFileSystem(), home);
  });

  afterEach(async () => {
    await rm(join(home, ".."), { recursive: true, force: true });
  });

  it("has no entries before ~/.spec-plans exists", async () => {
    expect(await registry.read()).toEqual({ kind: "loaded", entries: [] });
  });

  it("creates repositories.yml on first registration", async () => {
    expect(await registry.register(FOO)).toEqual({ kind: "registered", entry: FOO });
    expect(await readFile(join(home, "repositories.yml"), "utf8")).toBe(
      `repositories:\n  - remote: ${FOO.remote}\n    path: ${FOO.path}\n`,
    );
  });

  it("appends to an existing file, keeping its comments", async () => {
    await registry.register(FOO);
    const edited = `# my repositories\n${await readFile(registry.file, "utf8")}`;
    await writeFile(registry.file, edited);

    await registry.register(BAR);

    const text = await readFile(registry.file, "utf8");
    expect(text).toContain("# my repositories");
    expect(await registry.read()).toEqual({ kind: "loaded", entries: [FOO, BAR] });
  });

  it("appends to an empty flow list as a block list", async () => {
    await new NodeFileSystem().writeText(registry.file, "repositories: []\n");
    await registry.register(FOO);
    expect(await readFile(registry.file, "utf8")).toBe(
      `repositories:\n  - remote: ${FOO.remote}\n    path: ${FOO.path}\n`,
    );
  });

  it("keeps the folder of a remote that is already registered", async () => {
    await registry.register(FOO);
    expect(await registry.register({ remote: FOO.remote, path: "other" })).toEqual({
      kind: "already-registered",
      entry: FOO,
    });
  });

  it("allows two remotes to share a folder", async () => {
    await registry.register(FOO);
    const https = { remote: "https://github.com/ceilingfish/foo.git", path: FOO.path };
    expect(await registry.register(https)).toEqual({ kind: "registered", entry: https });
  });

  it("refuses an invalid folder name", async () => {
    const result = await registry.register({ remote: FOO.remote, path: "a/b" });
    expect(result.kind).toBe("invalid-folder");
    expect(await registry.read()).toEqual({ kind: "loaded", entries: [] });
  });

  it("refuses to overwrite a file it can't read", async () => {
    await registry.register(FOO);
    await writeFile(registry.file, "repositories: [\n");
    expect((await registry.register(BAR)).kind).toBe("invalid-registry");
    expect(await readFile(registry.file, "utf8")).toBe("repositories: [\n");
  });
});
