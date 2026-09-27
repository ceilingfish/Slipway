import { Uri, window, workspace, type LogOutputChannel } from "vscode";

import { folderNameProblem } from "../core/repositories/folder-name";
import type { RepositoryRegistry } from "../core/repositories/registry";
import type { FileSystem } from "../core/storage/file-system";

const REGISTER = "Register";
const CHOOSE_NAME = "Choose Folder Name…";

const askForFolderName = async (suggested: string | undefined): Promise<string | undefined> =>
  window.showInputBox({
    title: "Register Repository",
    prompt: "Folder for this repository's specs, directly under ~/.spec-plans",
    value: suggested ?? "",
    validateInput: folderNameProblem,
  });

/** Asks which folder an unregistered remote should map to. `undefined` if the user declines. */
export const chooseFolder = async (
  remote: string,
  suggested: string | undefined,
): Promise<string | undefined> => {
  if (suggested === undefined) {
    return askForFolderName(undefined);
  }
  const choice = await window.showInformationMessage(
    `Register ${remote} with Spec Plans as "${suggested}"?`,
    REGISTER,
    CHOOSE_NAME,
  );
  if (choice === REGISTER) {
    return suggested;
  }
  return choice === CHOOSE_NAME ? askForFolderName(suggested) : undefined;
};

/** Registers a remote, reporting anything that stops it. Returns whether the registry changed. */
export const register = async (
  registry: RepositoryRegistry,
  remote: string,
  folder: string,
  log: LogOutputChannel,
): Promise<boolean> => {
  const result = await registry.register({ remote, path: folder });
  if (result.kind === "registered") {
    log.info(`Registered ${remote} as ${folder}`);
    return true;
  }
  if (result.kind === "already-registered") {
    log.info(`${remote} is already registered as ${result.entry.path}`);
    return false;
  }
  log.error(`Couldn't register ${remote}: ${result.reason}`);
  void window.showErrorMessage(`Couldn't register ${remote}: ${result.reason}`);
  return false;
};

/** Opens `repositories.yml` for editing by hand, creating an empty one if needed. */
export const openRegistryFile = async (
  registry: RepositoryRegistry,
  files: FileSystem,
): Promise<void> => {
  if ((await files.readText(registry.file)) === undefined) {
    await files.writeText(registry.file, "repositories:\n");
  }
  await window.showTextDocument(await workspace.openTextDocument(Uri.file(registry.file)));
};
