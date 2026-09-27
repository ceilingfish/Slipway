---
name: implement-plan-task
description: Implement one numbered task from docs/PLAN.md end to end - read the PRD sections it depends on, build it inside the layer boundaries, test it, verify its "Done when" criterion, and review the diff. Use when asked to build, start or continue a PLAN.md task (e.g. "do task 3", "implement the planning editor").
---

# Implement a PLAN.md task

## 1. Understand the task

1. Read the task in `docs/PLAN.md`, including its **Done when** line. Check that the tasks it depends on (from the flowchart) are done. If one isn't, stop and tell the user.
2. Read every section of `docs/PRD.md` the task touches. The PRD is the source of truth for file layouts, formats (review format, planner output), naming and UI text. For UI work, check the designs in `docs/plugin-design.zip`.
3. Read the existing code in the areas you'll change. Reuse what's there before adding anything new.
4. If the PRD is ambiguous or contradicts the plan, ask the user. Don't guess.

## 2. Plan the change

Decide which layer each piece belongs in (see CLAUDE.md):

- Rules, formats, resolution logic, state transitions → `src/core/`
- Running processes, streaming agent output → `src/execution/`
- Views, commands, editors, webviews, `package.json` contribution points → `src/extension/`

`src/extension/` should be thin: it adapts VS Code events to `core` calls and renders `core` state. If extension code starts making decisions, move that logic into `core`.

## 3. Build it test-first where you can

- Write Vitest tests alongside `core` and `execution` code (`*.test.ts`). Cover the edge cases the PRD calls out: missing files, worktrees vs the main repo, disabled criteria, started vs pending tasks.
- Use temp directories (`fs.mkdtemp`) for anything that touches disk or git. Never touch the real `~/.spec-plans`.
- Keep commits small and focused. Each one should pass `pnpm check`.

## 4. Verify

1. `pnpm check` passes.
2. Check the task's **Done when** criterion directly. For UI behaviour, launch the extension (the `run` skill), and don't claim it works unless you've seen it.
3. Run `/simplify` on the diff, then `/code-review`, and fix what they find.

## 5. Report

Tell the user what was built, how **Done when** was verified (or what couldn't be verified and why), and anything in the PRD that turned out to be underspecified. If the implementation departed from the PRD, say so and suggest the PRD edit. Don't edit the PRD silently.
