#!/usr/bin/env bash
# Color-coded JSONL tail. One line per event, color by agent, fixed-width columns.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p events
for a in pm engineer reviewer tester; do touch "events/$a.jsonl"; done

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for tail-pretty. Install with: brew install jq  (or your package manager)" >&2
  exit 1
fi

RESET='\033[0m'
PM='\033[35m'      # magenta
ENG='\033[36m'     # cyan
REV='\033[33m'     # yellow
TEST='\033[32m'    # green
DIM='\033[2m'

tail -F events/pm.jsonl events/engineer.jsonl events/reviewer.jsonl events/tester.jsonl 2>/dev/null \
  | grep -v '^==>' \
  | grep -v '^$' \
  | while IFS= read -r line; do
      agent=$(echo "$line" | jq -r '.agent_id // "?"' 2>/dev/null || echo "?")
      ts=$(echo "$line" | jq -r '.ts // "?"' 2>/dev/null | cut -c12-19)
      type=$(echo "$line" | jq -r '.type // "?"' 2>/dev/null)
      tool=$(echo "$line" | jq -r '.payload.tool_name // ""' 2>/dev/null)
      preview=$(echo "$line" | jq -r '(.payload.preview // .payload.kind // .payload.result_preview // .payload.message // "") | tostring' 2>/dev/null | tr -d '\n' | cut -c1-100)
      case "$agent" in
        pm) color="$PM" ;;
        engineer) color="$ENG" ;;
        reviewer) color="$REV" ;;
        tester) color="$TEST" ;;
        *) color="$RESET" ;;
      esac
      printf "${DIM}%s${RESET} ${color}%-8s${RESET} %-16s %-14s ${DIM}%s${RESET}\n" "$ts" "$agent" "$type" "$tool" "$preview"
    done
