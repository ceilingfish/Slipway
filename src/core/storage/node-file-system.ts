import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { FileSystem } from "./file-system";

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** {@link FileSystem} backed by the real disk. */
export class NodeFileSystem implements FileSystem {
  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}
