# Spec Plans

@AGENTS.md

A VS Code extension for authoring specs outside the repository, reviewing their maturity and dispatching agents to build them. What to build is in [docs/PRD.md](docs/PRD.md); the order to build it in is [docs/PLAN.md](docs/PLAN.md). Designs are in `docs/plugin-design.zip`.

## Commands

Use pnpm, never npm or yarn.

- `pnpm check` - typecheck, lint, format check and unit tests. Must pass before any work is called done.
- `pnpm lint:fix` / `pnpm format` - auto-fix what can be fixed
- `pnpm test` - unit tests (Vitest)

When packaging, the extension is bundled, so use `vsce package --no-dependencies`.

## Layout and boundaries

```
src/core/       pure domain logic: repositories, specs, criteria, reviews, planning, tasks
src/execution/  execution strategies (ClaudeCli) and anything that spawns processes
src/extension/  VS Code integration: activation, views, commands, editors, webview hosts
```

Dependencies point inwards: `extension` → `execution` → `core`. oxlint enforces this:

- `src/core/` must not import `vscode`, `child_process`, or anything from `execution/` or `extension/`
- `src/execution/` must not import `vscode` or anything from `extension/`
- Only `src/execution/` may import `child_process`

Keep `core` testable with plain Vitest, with no VS Code host. File system and git access in `core` goes through small interfaces that are injected, so tests can use temp directories or fakes.

## Code conventions

- Strict TypeScript: no `any`, no non-null assertions, no unchecked index access. Model states as discriminated unions and let `switch-exhaustiveness-check` catch missing cases.
- Named exports only. No `console`: log to the extension's output channel.
- Every promise is awaited or explicitly `void`ed. Every disposable is added to `context.subscriptions`.
- Size limits: 400 lines per file, 80 per function, complexity 15, 4 params. If you hit one, split the code; don't disable the rule.
- Unit tests sit next to the code as `*.test.ts`.
- Lint suppressions (`oxlint-disable`) need a comment explaining why. Unused suppressions fail the lint.

## Guardrails

- A PostToolUse hook formats every file Claude edits and reports any lint errors it can't auto-fix.
- A Stop hook runs `pnpm check` whenever the tree is dirty, and blocks finishing until it passes.
- A husky pre-commit hook runs lint-staged. Don't bypass it with `--no-verify`.
- To implement a task from PLAN.md, use the `implement-plan-task` skill.
