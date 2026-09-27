import { describe, expect, it } from "vitest";

import { defaultFolderName, folderNameProblem } from "./folder-name";

describe("defaultFolderName", () => {
  it.each([
    ["git@github.com:ceilingfish/foo.git", "githubcom-ceilingfish-foo"],
    ["git@github.com:ceilingfish/foo", "githubcom-ceilingfish-foo"],
    ["https://github.com/ceilingfish/foo.git", "githubcom-ceilingfish-foo"],
    ["https://github.com/ceilingfish/foo", "githubcom-ceilingfish-foo"],
    ["https://github.com/ceilingfish/foo.git/", "githubcom-ceilingfish-foo"],
    ["https://gitlab.example.com/team/bar.git", "gitlabexamplecom-team-bar"],
    [
      "https://user:secret@gitlab.example.com:8443/team/sub/bar.git",
      "gitlabexamplecom-team-sub-bar",
    ],
    ["ssh://git@github.com:22/ceilingfish/foo.git", "githubcom-ceilingfish-foo"],
    ["ssh://git@github.com/ceilingfish/foo.js.git", "githubcom-ceilingfish-foojs"],
    ["github.com:ceilingfish/foo.git", "githubcom-ceilingfish-foo"],
    ["file:///srv/git/foo.git", "srv-git-foo"],
    ["/srv/git/foo.git", "srv-git-foo"],
    ["../foo.git", "foo"],
  ])("maps %s to %s", (remote, expected) => {
    expect(defaultFolderName(remote)).toBe(expected);
  });

  it("returns undefined when nothing usable is left", () => {
    expect(defaultFolderName("...")).toBeUndefined();
    expect(defaultFolderName("")).toBeUndefined();
  });
});

describe("folderNameProblem", () => {
  it("accepts any single folder name", () => {
    expect(folderNameProblem("githubcom-ceilingfish-foo")).toBeUndefined();
    expect(folderNameProblem("work bar")).toBeUndefined();
  });

  it.each([
    "",
    "  ",
    " padded",
    "a/b",
    "a\\b",
    ".",
    "..",
    ".git",
    ".non-functional",
    "repositories.yml",
  ])("rejects %j", (name) => {
    expect(folderNameProblem(name)).toBeTypeOf("string");
  });
});
