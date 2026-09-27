import { join } from "node:path";
import { isMap, isSeq, parseDocument, stringify } from "yaml";

import type { FileSystem } from "../storage/file-system";
import { folderNameProblem } from "./folder-name";

/** One entry of `repositories.yml`: a git remote and its folder under `~/.spec-plans`. */
export interface RepositoryEntry {
  readonly remote: string;
  readonly path: string;
}

export type RegistryContents =
  | { readonly kind: "loaded"; readonly entries: readonly RepositoryEntry[] }
  | { readonly kind: "invalid"; readonly reason: string };

export type RegisterResult =
  | { readonly kind: "registered"; readonly entry: RepositoryEntry }
  | { readonly kind: "already-registered"; readonly entry: RepositoryEntry }
  | { readonly kind: "invalid-folder"; readonly reason: string }
  | { readonly kind: "invalid-registry"; readonly reason: string };

export const REGISTRY_FILE = "repositories.yml";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toEntry = (item: unknown, index: number): RepositoryEntry | string => {
  if (!isRecord(item)) {
    return `Entry ${index + 1} must have a remote and a path.`;
  }
  const { remote, path } = item;
  if (typeof remote !== "string" || typeof path !== "string") {
    return `Entry ${index + 1} must have a remote and a path.`;
  }
  const problem = folderNameProblem(path);
  return problem === undefined ? { remote, path } : `Entry ${index + 1}: ${problem}`;
};

/** Parses the text of `repositories.yml`. A missing or empty file has no entries. */
export const parseRegistry = (text: string | undefined): RegistryContents => {
  const document = parseDocument(text ?? "");
  const [error] = document.errors;
  if (error !== undefined) {
    return { kind: "invalid", reason: error.message };
  }
  const root: unknown = document.toJS();
  if (root === null || root === undefined) {
    return { kind: "loaded", entries: [] };
  }
  const repositories = isRecord(root) ? root["repositories"] : undefined;
  if (repositories === null || repositories === undefined) {
    return isRecord(root)
      ? { kind: "loaded", entries: [] }
      : { kind: "invalid", reason: "Expected a `repositories` list." };
  }
  if (!Array.isArray(repositories)) {
    return { kind: "invalid", reason: "`repositories` must be a list." };
  }
  const entries: RepositoryEntry[] = [];
  for (const [index, item] of repositories.entries()) {
    const entry = toEntry(item, index);
    if (typeof entry === "string") {
      return { kind: "invalid", reason: entry };
    }
    entries.push(entry);
  }
  return { kind: "loaded", entries };
};

/** Finds the entry for a remote. URLs are matched exactly, without normalisation. */
export const findEntry = (
  entries: readonly RepositoryEntry[],
  remote: string,
): RepositoryEntry | undefined => entries.find((entry) => entry.remote === remote);

/** Adds an entry to the text of `repositories.yml`, keeping existing entries and comments. */
const appendEntry = (text: string | undefined, entry: RepositoryEntry): string => {
  const document = parseDocument(text ?? "");
  const repositories = document.get("repositories");
  if (!isMap(document.contents) || !isSeq(repositories)) {
    return stringify({ repositories: [entry] });
  }
  repositories.flow = false;
  repositories.add(document.createNode(entry));
  return document.toString();
};

/** `~/.spec-plans/repositories.yml`, which maps git remotes to repository folders. */
export class RepositoryRegistry {
  readonly file: string;

  constructor(
    private readonly files: FileSystem,
    readonly home: string,
  ) {
    this.file = join(home, REGISTRY_FILE);
  }

  async read(): Promise<RegistryContents> {
    return parseRegistry(await this.files.readText(this.file));
  }

  /** Maps a remote to a folder. A remote that is already registered keeps its folder. */
  async register(entry: RepositoryEntry): Promise<RegisterResult> {
    const problem = folderNameProblem(entry.path);
    if (problem !== undefined) {
      return { kind: "invalid-folder", reason: problem };
    }
    const text = await this.files.readText(this.file);
    const contents = parseRegistry(text);
    if (contents.kind === "invalid") {
      return { kind: "invalid-registry", reason: contents.reason };
    }
    const existing = findEntry(contents.entries, entry.remote);
    if (existing !== undefined) {
      return { kind: "already-registered", entry: existing };
    }
    await this.files.writeText(this.file, appendEntry(text, entry));
    return { kind: "registered", entry };
  }
}
