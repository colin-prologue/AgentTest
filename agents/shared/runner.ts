import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildHooks, isPaused } from "./hooks";
import { loadSessionId, saveSessionId } from "./session";
import { emit } from "./events";

export type AgentConfig = {
  agent_id: string;
  initial_prompt: string;
  tick_prompt: string;
  allowedTools: string[];
  poll_interval_ms: number;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function runAgent(config: AgentConfig) {
  const {
    agent_id,
    initial_prompt,
    tick_prompt,
    allowedTools,
    poll_interval_ms,
    permissionMode = "bypassPermissions",
  } = config;

  console.log(`[${agent_id}] starting agent loop (poll ${poll_interval_ms}ms, permission=${permissionMode})`);

  // Graceful shutdown — flush an event so we can see it in the log.
  const onSignal = (sig: string) => {
    emit(agent_id, { type: "session_end", payload: { reason: `signal:${sig}` } });
    console.log(`[${agent_id}] shutting down on ${sig}`);
    process.exit(0);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  while (true) {
    if (isPaused(agent_id)) {
      // Quiet pause — emit once per minute at most so we don't fill the log.
      emit(agent_id, { type: "decision", payload: { kind: "paused", control_file: `control/pause-${agent_id}` } });
      await sleep(Math.max(poll_interval_ms, 30_000));
      continue;
    }

    let sessionId = loadSessionId(agent_id);
    const promptToSend = sessionId ? config.tick_prompt : config.initial_prompt;

    emit(agent_id, {
      type: "tick_start",
      session_id: sessionId,
      payload: { resuming: Boolean(sessionId), prompt_chars: promptToSend.length },
    });

    const tickStartedAt = Date.now();
    let resultPreview: string | undefined;
    let resultSubtype: string | undefined;

    try {
      const stream = query({
        prompt: promptToSend,
        options: {
          resume: sessionId,
          allowedTools,
          permissionMode,
          hooks: buildHooks(agent_id),
        } as any,
      });

      for await (const message of stream) {
        const m = message as any;
        if (m && typeof m === "object" && "session_id" in m && m.session_id) {
          sessionId = m.session_id as string;
          saveSessionId(agent_id, sessionId!);
        }
        if (m?.type === "result") {
          resultSubtype = m.subtype;
          const r = m.result;
          resultPreview = typeof r === "string" ? r : JSON.stringify(r ?? null);
        }
      }
    } catch (err: any) {
      emit(agent_id, {
        type: "error",
        session_id: sessionId,
        payload: { message: err?.message ?? String(err), stack: err?.stack?.slice(0, 2000) },
      });
      console.error(`[${agent_id}] error:`, err?.message ?? err);
    }

    emit(agent_id, {
      type: "tick_end",
      session_id: sessionId,
      payload: {
        duration_ms: Date.now() - tickStartedAt,
        result_subtype: resultSubtype,
        result_preview: resultPreview?.slice(0, 400),
      },
    });

    if (resultPreview) {
      console.log(`[${agent_id}] result (${resultSubtype}):`, resultPreview.slice(0, 240));
    }

    await sleep(poll_interval_ms);
  }
}
