import { runAgent } from "./shared/runner";
import { REVIEWER_PROMPT, REVIEWER_TICK } from "./shared/prompts";

runAgent({
  agent_id: "reviewer",
  initial_prompt: REVIEWER_PROMPT,
  tick_prompt: REVIEWER_TICK,
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  poll_interval_ms: 45_000,
  permissionMode: "bypassPermissions",
}).catch((err) => {
  console.error("[reviewer] fatal:", err);
  process.exit(1);
});
