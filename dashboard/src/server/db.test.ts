import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDb, insertEvent, getEventsSince, type AgentEvent, type Database } from "./db.js";

function makeEvent(overrides: Partial<AgentEvent> & Pick<AgentEvent, "event_id">): AgentEvent {
  return {
    agent_id: "engineer",
    ts: "2026-05-25T22:55:00.000Z",
    type: "tick_start",
    payload: { tick: 1 },
    ...overrides,
  };
}

describe("dashboard db", () => {
  let db: Database;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("inserts events and returns them via getEventsSince", () => {
    const e1 = makeEvent({ event_id: "evt_1", agent_id: "pm", task_id: "task-001", payload: { kind: "decision" } });
    const e2 = makeEvent({
      event_id: "evt_2",
      agent_id: "engineer",
      ts: "2026-05-25T22:55:01.000Z",
      type: "post_tool_use",
      payload: { tool_name: "Bash" },
      session_id: "sess_abc",
    });

    expect(insertEvent(db, e1)).toBe(true);
    expect(insertEvent(db, e2)).toBe(true);

    const all = getEventsSince(db);
    expect(all).toHaveLength(2);
    expect(all[0]?.event_id).toBe("evt_1");
    expect(all[0]?.task_id).toBe("task-001");
    expect(all[0]?.payload).toEqual({ kind: "decision" });
    expect(all[1]?.event_id).toBe("evt_2");
    expect(all[1]?.session_id).toBe("sess_abc");
    expect(all[1]?.task_id).toBeUndefined();
  });

  it("re-inserting the same event_id is a no-op", () => {
    const e1 = makeEvent({ event_id: "evt_dup" });
    expect(insertEvent(db, e1)).toBe(true);

    // Different payload but same event_id — should not overwrite, should not duplicate.
    const e1Again = makeEvent({ event_id: "evt_dup", payload: { tick: 999 } });
    expect(insertEvent(db, e1Again)).toBe(false);

    const all = getEventsSince(db);
    expect(all).toHaveLength(1);
    expect(all[0]?.payload).toEqual({ tick: 1 }); // original wins, no overwrite
  });

  it("getEventsSince filters by sinceEventId and agentId", () => {
    insertEvent(db, makeEvent({ event_id: "a1", agent_id: "pm" }));
    insertEvent(db, makeEvent({ event_id: "a2", agent_id: "engineer" }));
    insertEvent(db, makeEvent({ event_id: "a3", agent_id: "pm" }));

    const sinceA1 = getEventsSince(db, { sinceEventId: "a1" });
    expect(sinceA1.map((e) => e.event_id)).toEqual(["a2", "a3"]);

    const pmOnly = getEventsSince(db, { agentId: "pm" });
    expect(pmOnly.map((e) => e.event_id)).toEqual(["a1", "a3"]);

    const sincePmAfterA1 = getEventsSince(db, { sinceEventId: "a1", agentId: "pm" });
    expect(sincePmAfterA1.map((e) => e.event_id)).toEqual(["a3"]);
  });

  it("respects the limit option", () => {
    insertEvent(db, makeEvent({ event_id: "l1" }));
    insertEvent(db, makeEvent({ event_id: "l2" }));
    insertEvent(db, makeEvent({ event_id: "l3" }));

    const limited = getEventsSince(db, { limit: 2 });
    expect(limited.map((e) => e.event_id)).toEqual(["l1", "l2"]);
  });

  it("creates the ingest_offsets table on open (task-003 dependency)", () => {
    // Schema check — task-003 needs this table to exist after openDb runs migrations.
    const row = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ingest_offsets'")
      .get();
    expect(row?.name).toBe("ingest_offsets");
  });
});
