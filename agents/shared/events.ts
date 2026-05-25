import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type EventType =
  | "session_start"
  | "session_end"
  | "pre_tool_use"
  | "post_tool_use"
  | "stop"
  | "tick_start"
  | "tick_end"
  | "decision"
  | "handoff"
  | "blocker"
  | "error";

export type AgentEvent = {
  event_id: string;
  parent_event_id?: string;
  agent_id: string;
  session_id?: string;
  task_id?: string;
  ts: string;
  type: EventType;
  payload: Record<string, unknown>;
  blob_ref?: string;
};

const REPO_ROOT = path.resolve(process.cwd());
const EVENTS_DIR = path.join(REPO_ROOT, "events");
const BLOBS_DIR = path.join(EVENTS_DIR, "blobs");

const BLOB_THRESHOLD = 4096;

function ensureDirs() {
  fs.mkdirSync(EVENTS_DIR, { recursive: true });
  fs.mkdirSync(BLOBS_DIR, { recursive: true });
}

function newEventId(): string {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function writeBlob(content: string): string {
  ensureDirs();
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  const blobPath = path.join(BLOBS_DIR, `${hash}.txt`);
  if (!fs.existsSync(blobPath)) fs.writeFileSync(blobPath, content);
  return hash;
}

export function maybeBlob(content: unknown): { inline?: unknown; blob_ref?: string } {
  const str = typeof content === "string" ? content : JSON.stringify(content ?? null);
  if (str.length > BLOB_THRESHOLD) return { blob_ref: writeBlob(str) };
  return { inline: content };
}

export type EmitInput = Omit<AgentEvent, "event_id" | "agent_id" | "ts">;

export function emit(agent_id: string, event: EmitInput): AgentEvent {
  ensureDirs();
  const full: AgentEvent = {
    event_id: newEventId(),
    agent_id,
    ts: new Date().toISOString(),
    ...event,
  };
  const filePath = path.join(EVENTS_DIR, `${agent_id}.jsonl`);
  fs.appendFileSync(filePath, JSON.stringify(full) + "\n");
  return full;
}
