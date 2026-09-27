import { execFile } from "node:child_process";

import type { Git, GitResult } from "../core/repositories/git";

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const exitCodeOf = (error: Error): number | undefined =>
  "code" in error && typeof error.code === "number" ? error.code : undefined;

/** Runs the `git` executable found on the PATH. */
export class ProcessGit implements Git {
  run(cwd: string, args: readonly string[]): Promise<GitResult> {
    return new Promise((resolve) => {
      execFile(
        "git",
        args,
        { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ kind: "succeeded", stdout });
            return;
          }
          const message = stderr.trim() === "" ? error.message : stderr.trim();
          resolve({ kind: "failed", exitCode: exitCodeOf(error), message });
        },
      );
    });
  }
}
