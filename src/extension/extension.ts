import { homedir } from "node:os";
import {
  commands,
  RelativePattern,
  Uri,
  window,
  workspace,
  type ExtensionContext,
  type LogOutputChannel,
} from "vscode";

import { REGISTRY_FILE, RepositoryRegistry } from "../core/repositories/registry";
import { NodeFileSystem } from "../core/storage/node-file-system";
import { specPlansHome } from "../core/storage/spec-plans-home";
import { ProcessGit } from "../execution/git";
import { openRegistryFile } from "./registration";
import { RepositoryController } from "./repository-controller";
import { createViews } from "./views";

const reportFailure =
  (log: LogOutputChannel, action: string) =>
  (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`${action} failed: ${message}`);
    void window.showErrorMessage(`Spec Plans: ${action} failed. ${message}`);
  };

export const activate = (context: ExtensionContext): void => {
  const log = window.createOutputChannel("Spec Plans", { log: true });
  const files = new NodeFileSystem();
  const home = specPlansHome(process.env, homedir());
  const registry = new RepositoryRegistry(files, home);
  const repositories = new RepositoryController({
    git: new ProcessGit(),
    registry,
    views: createViews(context),
    log,
  });
  const watcher = workspace.createFileSystemWatcher(
    new RelativePattern(Uri.file(home), REGISTRY_FILE),
  );
  const refresh = (prompt: boolean): void => {
    repositories.refresh(prompt).catch(reportFailure(log, "Resolving the repository"));
  };

  context.subscriptions.push(
    log,
    repositories,
    watcher,
    watcher.onDidCreate(() => refresh(false)),
    watcher.onDidChange(() => refresh(false)),
    watcher.onDidDelete(() => refresh(false)),
    workspace.onDidChangeWorkspaceFolders(() => refresh(true)),
    commands.registerCommand("specPlans.registerRepository", async () =>
      repositories.promptFor(repositories.repository),
    ),
    commands.registerCommand("specPlans.openRepositories", async () =>
      openRegistryFile(registry, files),
    ),
  );
  log.info(`Spec Plans activated, storing data in ${home}`);
  refresh(true);
};

export const deactivate = (): void => {
  // Everything is disposed through context.subscriptions.
};
