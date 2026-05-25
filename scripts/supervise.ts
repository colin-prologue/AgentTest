import { spawn, ChildProcess } from "node:child_process";
import * as path from "node:path";

const AGENTS = ["pm", "engineer", "reviewer", "tester"] as const;

const children: Record<string, ChildProcess | null> = {};

function start(agent: string) {
  const script = path.join("agents", `${agent}.ts`);
  console.log(`[supervisor] starting ${agent}`);
  const proc = spawn("npx", ["tsx", script], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, AGENT_ID: agent },
  });
  children[agent] = proc;
  proc.on("exit", (code, signal) => {
    children[agent] = null;
    if (signal === "SIGTERM" || signal === "SIGINT") return;
    console.error(`[supervisor] ${agent} exited code=${code}; restarting in 5s`);
    setTimeout(() => start(agent), 5000);
  });
}

function shutdown() {
  console.log("[supervisor] shutting down all agents");
  for (const agent of AGENTS) {
    const c = children[agent];
    if (c && !c.killed) c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[supervisor] starting all four agents");
AGENTS.forEach(start);
