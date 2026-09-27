import type { TreeDataProvider, TreeItem } from "vscode";

/** A view with no rows yet. Later tasks replace these with real providers. */
export class EmptyTree implements TreeDataProvider<never> {
  getTreeItem(element: never): TreeItem {
    return element;
  }

  getChildren(): never[] {
    return [];
  }
}
