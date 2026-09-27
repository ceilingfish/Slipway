/** The file access that `core` needs, injected so tests can use temp directories or fakes. */
export interface FileSystem {
  /** Reads a UTF-8 file, or returns `undefined` if it doesn't exist. */
  readText(path: string): Promise<string | undefined>;
  /** Writes a UTF-8 file, creating its parent directories. */
  writeText(path: string, content: string): Promise<void>;
}
