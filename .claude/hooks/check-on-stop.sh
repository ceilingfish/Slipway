#!/usr/bin/env bash
# Stop: run the full check when the working tree has changes, and block Claude
# from finishing until it passes. Gives up after one retry to avoid a loop.
set -uo pipefail

input=$(cat)
cd "$CLAUDE_PROJECT_DIR" || exit 0

[[ -z "$(git status --porcelain)" ]] && exit 0

if out=$(pnpm check 2>&1); then
  exit 0
fi

tail_out=$(echo "$out" | tail -40)
if [[ "$(echo "$input" | jq -r '.stop_hook_active // false')" == "true" ]]; then
  jq -n --arg out "$tail_out" '{systemMessage: ("pnpm check is still failing:\n" + $out)}'
  exit 0
fi

jq -n --arg out "$tail_out" \
  '{decision: "block", reason: ("pnpm check failed. Fix the problems before finishing:\n" + $out)}'
