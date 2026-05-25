import * as fs from "node:fs";
import * as path from "node:path";
import { emit, maybeBlob } from "./events";

const CONTROL_DIR = path.resolve(process.cwd(), "control");

// Patterns we never want any agent running, no matter what permission mode is set.
// Tune this list as you observe what your agents try to do.
const DANGEROUS_BASH = [
  /\brm\s+-rf?\s+\/(?!tmp\b|var\/tmp\b)/, // rm -rf / (allow /tmp, /var/tmp)
  /\bsudo\b/,
  /\bgit\s+push[^|;]*--force/,
  /\bgit\s+reset\s+--hard\b.*\b(main|master|origin\/main|origin\/master)\b/,
  /\bgit\s+push\b[^|;]*\b(main|master)\b/, // explicit guard: never push directly to main/master (redundant with the allowlist below, kept for clarity)
  /\bgit\s+push\b[^|;]*\borigin\s+(?:[^|;\s]*:)?(?!task\/)[\w./-]+/, // engineers may only push to task/* branches on origin; trunk, feature/*, deletions, HEAD:other are denied. Tester lands trunk changes via `gh pr merge` (server-side), not `git push`.
  /\bgh\s+pr\s+merge\b[^|;]*--base\s+(main|master)\b/, // never auto-merge into real main/master via gh
  /\bgh\s+pr\s+merge\b[^|;]*--admin\b/, // never bypass branch protection
  /curl[^|]*\|\s*(bash|sh|zsh)/,
  /:\(\)\s*\{.*\};/, // fork bomb
  />\s*\/dev\/sd[a-z]/,
];

export function isPaused(agent_id: string): boolean {
  return fs.existsSync(path.join(CONTROL_DIR, `pause-${agent_id}`));
}

function isDangerousCommand(cmd: string): { dangerous: boolean; reason?: string } {
  for (const re of DANGEROUS_BASH) {
    if (re.test(cmd)) return { dangerous: true, reason: `matched ${re}` };
  }
  return { dangerous: false };
}

// Builds the hook bundle for one agent. Every tool call is logged to events/<agent>.jsonl,
// and a denylist filter blocks the most obviously destructive shell commands.
export function buildHooks(agent_id: string) {
  return {
    SessionStart: [
      {
        hooks: [
          async (input: any) => {
            emit(agent_id, {
              type: "session_start",
              session_id: input?.session_id,
              payload: { source: input?.source ?? "user" },
            });
            return {};
          },
        ],
      },
    ],
    PreToolUse: [
      {
        hooks: [
          async (input: any) => {
            const toolName = input?.tool_name ?? "unknown";
            const toolInput = input?.tool_input ?? {};

            if (toolName === "Bash") {
              const cmd = String(toolInput?.command ?? "");
              const check = isDangerousCommand(cmd);
              if (check.dangerous) {
                emit(agent_id, {
                  type: "decision",
                  session_id: input?.session_id,
                  payload: { kind: "safety_block", tool: toolName, command: cmd, reason: check.reason },
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "deny",
                    permissionDecisionReason: `safety hook: ${check.reason}`,
                  },
                };
              }
            }

            const { inline, blob_ref } = maybeBlob(toolInput);
            emit(agent_id, {
              type: "pre_tool_use",
              session_id: input?.session_id,
              payload: { tool_name: toolName, tool_input: inline ?? "[blob]" },
              blob_ref,
            });
            return {};
          },
        ],
      },
    ],
    PostToolUse: [
      {
        hooks: [
          async (input: any) => {
            const toolName = input?.tool_name ?? "unknown";
            const toolResponse = input?.tool_response ?? input?.tool_result ?? {};
            const { inline, blob_ref } = maybeBlob(toolResponse);
            const preview =
              typeof inline === "string"
                ? inline.slice(0, 240)
                : inline === undefined
                  ? "[blob]"
                  : JSON.stringify(inline).slice(0, 240);
            emit(agent_id, {
              type: "post_tool_use",
              session_id: input?.session_id,
              payload: { tool_name: toolName, preview },
              blob_ref,
            });
            return {};
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          async (input: any) => {
            emit(agent_id, {
              type: "stop",
              session_id: input?.session_id,
              payload: { stop_hook_active: input?.stop_hook_active ?? false },
            });
            return {};
          },
        ],
      },
    ],
  };
}
