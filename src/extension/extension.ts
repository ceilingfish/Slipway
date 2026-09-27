import { window, type ExtensionContext } from "vscode";

import { createViews } from "./views";

export const activate = (context: ExtensionContext): void => {
  const log = window.createOutputChannel("Spec Plans", { log: true });
  context.subscriptions.push(log);
  createViews(context);
  log.info("Spec Plans activated");
};

export const deactivate = (): void => {
  // Everything is disposed through context.subscriptions.
};
