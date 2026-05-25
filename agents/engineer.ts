import { runAgent } from "./shared/runner";
import { ENGINEER_PROMPT, ENGINEER_TICK } from "./shared/prompts";

runAgent({
  agent_id: "engineer",
  initial_prompt: ENGINEER_PROMPT,
  tick_prompt: ENGINEER_TICK,
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  poll_interval_ms: 30_000,
  permissionMode: "bypassPermissions",
}).catch((err) => {
  console.error("[engineer] fatal:", err);
  process.exit(1);
});
