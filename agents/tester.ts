import { runAgent } from "./shared/runner";
import { TESTER_PROMPT, TESTER_TICK } from "./shared/prompts";

runAgent({
  agent_id: "tester",
  initial_prompt: TESTER_PROMPT,
  tick_prompt: TESTER_TICK,
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  poll_interval_ms: 90_000,
  permissionMode: "bypassPermissions",
}).catch((err) => {
  console.error("[tester] fatal:", err);
  process.exit(1);
});
