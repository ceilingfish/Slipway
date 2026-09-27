#!/usr/bin/env bash
# PostToolUse (Edit|Write): format the edited file, auto-fix lint, and feed any
# remaining lint errors back to Claude (exit 2 surfaces stderr to the model).
set -uo pipefail

file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[[ -z "$file" || ! -f "$file" ]] && exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0
case "$file" in
  "$CLAUDE_PROJECT_DIR"/*) ;;
  *) exit 0 ;;
esac

case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.cjs)
    pnpm exec oxlint --fix "$file" >/dev/null 2>&1
    pnpm exec prettier --write --log-level=warn "$file" >/dev/null 2>&1
    if ! out=$(pnpm exec oxlint --deny-warnings --format=unix "$file" 2>&1); then
      echo "oxlint errors remain in $file:" >&2
      echo "$out" >&2
      exit 2
    fi
    ;;
  *)
    pnpm exec prettier --write --ignore-unknown --log-level=warn "$file" >/dev/null 2>&1
    ;;
esac
exit 0
