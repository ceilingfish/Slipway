import {
  commands,
  EventEmitter,
  window,
  workspace,
  type Disposable,
  type Event,
  type LogOutputChannel,
} from "vscode";

import type { Git } from "../core/repositories/git";
import type { RepositoryRegistry } from "../core/repositories/registry";
import { resolveRepository, type RepositoryResolution } from "../core/repositories/resolve";
import { chooseFolder, register } from "./registration";
import type { SpecPlansViews } from "./views";

/** The workspace's repository, or `no-workspace` when no folder is open. */
export type WorkspaceRepository = RepositoryResolution | { readonly kind: "no-workspace" };

/** Context key used by `viewsWelcome` in package.json. */
const STATE_CONTEXT_KEY = "specPlans.repositoryState";

const OPEN_REGISTRY = "Open repositories.yml";

export interface RepositoryControllerDependencies {
  readonly git: Git;
  readonly registry: RepositoryRegistry;
  readonly views: SpecPlansViews;
  readonly log: LogOutputChannel;
}

/** Keeps track of which repository folder the open workspace maps to. */
export class RepositoryController implements Disposable {
  private current: WorkspaceRepository = { kind: "no-workspace" };
  private generation = 0;
  private readonly changed = new EventEmitter<WorkspaceRepository>();

  readonly onDidChange: Event<WorkspaceRepository> = this.changed.event;

  constructor(private readonly deps: RepositoryControllerDependencies) {}

  get repository(): WorkspaceRepository {
    return this.current;
  }

  /** Resolves the first workspace folder again. With `prompt`, offers to fix what's missing. */
  async refresh(prompt: boolean): Promise<void> {
    const generation = ++this.generation;
    const resolved = await this.resolve();
    if (generation !== this.generation) {
      return;
    }
    this.current = resolved;
    this.deps.log.info(`Repository: ${describe(resolved)}`);
    await this.show(resolved);
    this.changed.fire(resolved);
    if (prompt) {
      await this.promptFor(resolved);
    }
  }

  /** Offers to register the workspace's repository, or explains why it can't be. */
  async promptFor(repository: WorkspaceRepository): Promise<void> {
    switch (repository.kind) {
      case "unregistered":
        await this.offerRegistration(repository.remote, repository.suggestedFolder);
        return;
      case "no-origin":
        await this.explainNoOrigin(repository.mainWorktree);
        return;
      case "invalid-registry":
        await this.offerToOpenRegistry(`repositories.yml can't be read: ${repository.reason}`);
        return;
      case "registered":
      case "not-a-repository":
      case "no-workspace":
        return;
    }
  }

  dispose(): void {
    this.changed.dispose();
  }

  private async resolve(): Promise<WorkspaceRepository> {
    const [folder, ...others] = workspace.workspaceFolders ?? [];
    if (folder === undefined) {
      return { kind: "no-workspace" };
    }
    if (others.length > 0) {
      this.deps.log.info(`Using the first workspace folder, ${folder.uri.fsPath}`);
    }
    return resolveRepository(this.deps.git, this.deps.registry, folder.uri.fsPath);
  }

  private async show(repository: WorkspaceRepository): Promise<void> {
    const folder = repository.kind === "registered" ? repository.folder : "";
    this.deps.views.specifications.description = folder;
    this.deps.views.criteria.description = folder;
    await commands.executeCommand("setContext", STATE_CONTEXT_KEY, repository.kind);
  }

  private async offerRegistration(remote: string, suggested: string | undefined): Promise<void> {
    const folder = await chooseFolder(remote, suggested);
    if (
      folder !== undefined &&
      (await register(this.deps.registry, remote, folder, this.deps.log))
    ) {
      await this.refresh(false);
    }
  }

  private async explainNoOrigin(mainWorktree: string): Promise<void> {
    await this.offerToOpenRegistry(
      `${mainWorktree} has no origin remote, so Spec Plans can't map it to a folder automatically. ` +
        "Add an origin remote, or register it by hand in repositories.yml.",
    );
  }

  private async offerToOpenRegistry(message: string): Promise<void> {
    const choice = await window.showWarningMessage(message, OPEN_REGISTRY);
    if (choice === OPEN_REGISTRY) {
      await commands.executeCommand("specPlans.openRepositories");
    }
  }
}

const describe = (repository: WorkspaceRepository): string => {
  let text: string;
  switch (repository.kind) {
    case "no-workspace":
      text = "no workspace folder is open";
      break;
    case "not-a-repository":
      text = `${repository.directory} isn't in a git repository (${repository.reason})`;
      break;
    case "no-origin":
      text = `${repository.mainWorktree} has no origin remote`;
      break;
    case "invalid-registry":
      text = `${repository.remote}: repositories.yml can't be read (${repository.reason})`;
      break;
    case "unregistered":
      text = `${repository.remote} (${repository.mainWorktree}) isn't registered`;
      break;
    case "registered":
      text = `${repository.remote} (${repository.mainWorktree}) -> ${repository.folderPath}`;
      break;
  }
  return text;
};
