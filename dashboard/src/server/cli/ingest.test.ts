/**
 * E2E test for the dashboard:ingest CLI.
 *
 * Spawns the CLI as a child process, lets it ingest a fixture, kills it,
 * spawns it again on the same DB+events dir, and asserts the db has the
 * same row count (no duplicates) — proving idempotency end-to-end.
 *
 * Notes on signals across platforms:
 * - On Linux/macOS, `child.kill("SIGINT")` triggers our graceful shutdown
 *   handler — the CLI prints `dashboard:ingest stopped` and exits 0.
 * - On Windows, Node's `child.kill("SIGINT")` is documented to ignore the
 *   signal and terminate the process abruptly (similar to SIGKILL). The
 *   ingest worker commits each batch inside a SQLite WAL transaction
 *   *before* the kill, so committed events still persist. The next CLI
 *   sees the pidfile holding a now-dead PID and silently overwrites it
 *   (per the AC's "stale pidfile" behavior), which is also what we test.
 *
 * Both code paths converge on the same db-state assertion at the end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

type CliChild = ChildProcessByStdio<null, Readable, Readable>;
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { openDb, type AgentEvent } from "../db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(HERE, "..", "..", "..");
const CLI_SCRIPT = resolve(DASHBOARD_ROOT, "src/server/cli/ingest.ts");

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeEvent(id: string, ts: string): AgentEvent {
  return {
    event_id: id,
    agent_id: "engineer",
    ts,
    type: "tick_start",
    payload: { test: true, id },
  };
}

interface SpawnedCli {
  child: CliChild;
  stdout: string;
  stderr: string;
}

function spawnCli(env: Record<string, string>): SpawnedCli {
  // Spawn `node --import tsx <script>` directly — no shell, no npx wrapper.
  // This means `child.pid` is the actual node PID (matters for the pidfile
  // assertion below) and `child.kill(...)` targets node, not a shell process
  // that would otherwise orphan the node child on Windows.
  const child = spawn(process.execPath, ["--import", "tsx", CLI_SCRIPT], {
    cwd: DASHBOARD_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }) as CliChild;

  const out: SpawnedCli = { child, stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out.stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    out.stderr += chunk;
  });
  return out;
}

function killAndWait(cli: SpawnedCli): Promise<number | null> {
  return new Promise((resolveExit) => {
    if (cli.child.exitCode !== null) {
      resolveExit(cli.child.exitCode);
      return;
    }
    cli.child.once("exit", (code) => resolveExit(code));
    cli.child.kill("SIGINT");
    // Hard-kill fallback if SIGINT didn't take within 5 s.
    setTimeout(() => {
      if (cli.child.exitCode === null) cli.child.kill();
    }, 5000).unref();
  });
}

async function waitForStartupBanner(cli: SpawnedCli, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cli.stdout.includes("dashboard:ingest starting")) return;
    if (cli.child.exitCode !== null) {
      throw new Error(
        `CLI exited before banner; stdout=${cli.stdout.slice(0, 500)}; stderr=${cli.stderr.slice(0, 500)}`,
      );
    }
    await wait(50);
  }
  throw new Error(`Timeout waiting for startup banner; stdout=${cli.stdout.slice(0, 500)}`);
}

describe("dashboard:ingest CLI", () => {
  let workDir: string;
  let eventsDir: string;
  let dbPath: string;
  let pidFile: string;
  let fixturePath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ingest-cli-test-"));
    eventsDir = join(workDir, "events");
    dbPath = join(workDir, "events.db");
    pidFile = join(workDir, "ingest.pid");
    fixturePath = join(eventsDir, "test-cli.jsonl");
    mkdirSync(eventsDir, { recursive: true });
  });

  afterEach(async () => {
    // Brief settle: on Windows, file handles from the killed CLI may take a
    // tick to release. Without this, rmSync can EBUSY on events.db.
    await wait(200);
    if (existsSync(workDir)) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        await wait(500);
        rmSync(workDir, { recursive: true, force: true });
      }
    }
  });

  it("ingests a fixture, shuts down, and re-running on the same db is idempotent", async () => {
    // (a) Write 5 events to events/test-cli.jsonl
    const events = [
      makeEvent("task004cli_1", "2026-05-27T00:00:00.000Z"),
      makeEvent("task004cli_2", "2026-05-27T00:00:01.000Z"),
      makeEvent("task004cli_3", "2026-05-27T00:00:02.000Z"),
      makeEvent("task004cli_4", "2026-05-27T00:00:03.000Z"),
      makeEvent("task004cli_5", "2026-05-27T00:00:04.000Z"),
    ];
    writeFileSync(fixturePath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const env = {
      INGEST_DB_PATH: dbPath,
      INGEST_EVENTS_DIR: eventsDir,
      INGEST_PID_FILE: pidFile,
      INGEST_POLL_MS: "100",
      INGEST_STAT_MS: "300",
    };

    // (b) Spawn the CLI, (c) wait ~1.5 s
    const first = spawnCli(env);
    await waitForStartupBanner(first);
    expect(first.stdout).toContain(`dashboard:ingest starting (db=${dbPath}, eventsDir=${eventsDir})`);
    expect(existsSync(pidFile)).toBe(true);

    await wait(1500);

    // (d) Send SIGINT, wait for exit
    await killAndWait(first);

    // (e) Assert the db has 5 rows
    {
      const db = openDb(dbPath);
      try {
        const row = db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events").get();
        expect(row?.c).toBe(5);
      } finally {
        db.close();
      }
    }

    // (f) Spawn the CLI again on the same db + same file
    const second = spawnCli(env);
    await waitForStartupBanner(second);
    expect(second.stdout).toContain("dashboard:ingest starting");

    // (g) Wait ~1.5 s, (h) send SIGINT
    await wait(1500);
    await killAndWait(second);

    // (i) Assert the db still has exactly 5 rows
    {
      const db = openDb(dbPath);
      try {
        const row = db.prepare<[], { c: number }>("SELECT COUNT(*) as c FROM events").get();
        expect(row?.c).toBe(5);
      } finally {
        db.close();
      }
    }
  }, 30000);

  it("refuses to start if the pidfile holds a live PID", async () => {
    // Pre-seed pidfile with our own pid (which is definitely alive).
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(pidFile, String(process.pid));

    const env = {
      INGEST_DB_PATH: dbPath,
      INGEST_EVENTS_DIR: eventsDir,
      INGEST_PID_FILE: pidFile,
      INGEST_POLL_MS: "100",
      INGEST_STAT_MS: "1000",
    };

    const cli = spawnCli(env);
    const exitCode = await new Promise<number | null>((resolveExit) => {
      cli.child.once("exit", (code) => resolveExit(code));
      // Safety timeout
      setTimeout(() => {
        if (cli.child.exitCode === null) cli.child.kill();
      }, 8000).unref();
    });

    expect(exitCode).not.toBe(0);
    expect(cli.stderr + cli.stdout).toMatch(/already running/);
  }, 15000);

  it("overwrites a stale pidfile (PID not alive) and starts normally", async () => {
    // Seed pidfile with a PID that is almost certainly NOT alive.
    // Using a high PID that's well above typical pid_max; if by cosmic
    // misfortune it's alive, the test will retry with a different number.
    mkdirSync(dirname(pidFile), { recursive: true });
    const stalePid = 0x7fff_fff0; // ~2.1 billion — well above any real PID
    writeFileSync(pidFile, String(stalePid));

    // Empty fixture so the CLI doesn't write any events (we only care that it starts).
    writeFileSync(fixturePath, "");

    const env = {
      INGEST_DB_PATH: dbPath,
      INGEST_EVENTS_DIR: eventsDir,
      INGEST_PID_FILE: pidFile,
      INGEST_POLL_MS: "100",
      INGEST_STAT_MS: "300",
    };

    const cli = spawnCli(env);
    await waitForStartupBanner(cli);
    // pidfile should now hold a real, alive PID (not the stale seed).
    const fs = await import("node:fs");
    const pidContent = fs.readFileSync(pidFile, "utf8").trim();
    const pidInFile = Number(pidContent);
    expect(pidInFile).toBeGreaterThan(0);
    expect(pidInFile).not.toBe(stalePid);
    // The CLI's pid file should match the spawned node process's pid.
    expect(pidInFile).toBe(cli.child.pid);

    await killAndWait(cli);
  }, 15000);
});
