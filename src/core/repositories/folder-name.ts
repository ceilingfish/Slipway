const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;
const SCP_LIKE = /^(?:[^@/]+@)?(?<host>[^:/]+):(?<path>.*)$/;
const RESERVED_NAMES = new Set([".", "..", ".git", ".gitignore", ".non-functional"]);

interface RemoteParts {
  readonly host: string;
  readonly path: string;
}

const splitRemote = (remote: string): RemoteParts => {
  if (URL_SCHEME.test(remote)) {
    try {
      const url = new URL(remote);
      return { host: url.hostname, path: decodeURIComponent(url.pathname) };
    } catch {
      return { host: "", path: remote };
    }
  }
  const scp = SCP_LIKE.exec(remote)?.groups;
  if (scp?.["host"] !== undefined && scp["path"] !== undefined) {
    return { host: scp["host"], path: scp["path"] };
  }
  return { host: "", path: remote };
};

/** Keeps only characters that are safe in a folder name; dots are removed as the PRD asks. */
const cleanSegment = (segment: string): string => segment.replaceAll(/[^\w-]/g, "");

/**
 * The default repository folder for a remote URL: the host and path, with `.git` stripped,
 * dots removed and the segments joined with `-`. `git@github.com:ceilingfish/foo.git` becomes
 * `githubcom-ceilingfish-foo`. Returns `undefined` if nothing usable is left.
 */
export const defaultFolderName = (remote: string): string | undefined => {
  const { host, path } = splitRemote(remote.trim());
  const segments = [host, ...path.replace(/\.git\/?$/, "").split(/[/\\]/)]
    .map(cleanSegment)
    .filter((segment) => segment !== "");
  return segments.length > 0 ? segments.join("-") : undefined;
};

/**
 * Checks that a repository folder name is a single folder directly under `~/.spec-plans` that
 * doesn't collide with Spec Plans' own files. Returns the reason it's invalid, or `undefined`.
 */
export const folderNameProblem = (name: string): string | undefined => {
  if (name.trim() === "") {
    return "The folder name can't be empty.";
  }
  if (name !== name.trim()) {
    return "The folder name can't start or end with spaces.";
  }
  if (/[/\\]/.test(name)) {
    return "The folder name must be a single folder, not a path.";
  }
  if (RESERVED_NAMES.has(name) || name === "repositories.yml") {
    return `"${name}" is reserved by Spec Plans.`;
  }
  return undefined;
};
