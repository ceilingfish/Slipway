import { window, type ExtensionContext, type TreeView } from "vscode";

import { EmptyTree } from "./empty-tree";

/** View ids, matching `contributes.views` in package.json. */
export const VIEW_IDS = {
  specifications: "specPlans.specifications",
  maturity: "specPlans.maturity",
  criteria: "specPlans.criteria",
} as const;

export interface SpecPlansViews {
  readonly specifications: TreeView<never>;
  readonly maturity: TreeView<never>;
  readonly criteria: TreeView<never>;
}

export const createViews = (context: ExtensionContext): SpecPlansViews => {
  const create = (id: string): TreeView<never> => {
    const view = window.createTreeView(id, { treeDataProvider: new EmptyTree() });
    context.subscriptions.push(view);
    return view;
  };
  return {
    specifications: create(VIEW_IDS.specifications),
    maturity: create(VIEW_IDS.maturity),
    criteria: create(VIEW_IDS.criteria),
  };
};
