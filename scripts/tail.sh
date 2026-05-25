#!/usr/bin/env bash
# Live JSONL tail of all agent event streams. Pipes through jq for compact one-line view.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p events
for a in pm engineer reviewer tester; do touch "events/$a.jsonl"; done

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found — falling back to raw tail. Install jq for the formatted view." >&2
  exec tail -F events/*.jsonl
fi

tail -F events/pm.jsonl events/engineer.jsonl events/reviewer.jsonl events/tester.jsonl 2>/dev/null \
  | grep -v '^==>' \
  | grep -v '^$' \
  | jq -c '{ts, agent: .agent_id, type, tool: (.payload.tool_name // null), preview: (.payload.preview // .payload.kind // .payload.result_preview // null)}' 2>/dev/null
