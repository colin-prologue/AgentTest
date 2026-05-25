import { runAgent } from "./shared/runner";
import { PM_PROMPT, PM_TICK } from "./shared/prompts";

runAgent({
  agent_id: "pm",
  initial_prompt: PM_PROMPT,
  tick_prompt: PM_TICK,
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  poll_interval_ms: 60_000,
  permissionMode: "bypassPermissions",
}).catch((err) => {
  console.error("[pm] fatal:", err);
  process.exit(1);
});
