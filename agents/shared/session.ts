import * as fs from "node:fs";
import * as path from "node:path";

const STATE_DIR = path.resolve(process.cwd(), "agents-state");

export function loadSessionId(agent_id: string): string | undefined {
  const f = path.join(STATE_DIR, `${agent_id}.session`);
  if (!fs.existsSync(f)) return undefined;
  const id = fs.readFileSync(f, "utf-8").trim();
  return id || undefined;
}

export function saveSessionId(agent_id: string, sessionId: string) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, `${agent_id}.session`), sessionId);
}

export function clearSessionId(agent_id: string) {
  const f = path.join(STATE_DIR, `${agent_id}.session`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
