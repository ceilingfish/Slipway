1. ALways ensure that your changes comply to the linting and formatting rules defined in package.json
2. If you are unsure, always ask, never guess
3. You must test everything you can
4. Commit frequently, and don't be afraid of reverting if something isn't working out
5. Use lumberjack to manage git worktrees (create, list, remove); never call `git worktree` directly. All parallel work should be put into a worktree.
6. Install CLI tools through mise (add them to `mise.toml`); never install them globally with brew, npm -g, pip or similar.
