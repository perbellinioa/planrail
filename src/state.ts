import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import Database from "better-sqlite3";
import type { DagState, NodeState, PlanFile, ValidationResult } from "./types.js";
import { validatePlan } from "./validate.js";

export type ParseResult =
  | { ok: true; plan: PlanFile; validation: ValidationResult }
  | { ok: false; error: string };

export function safeParsePlan(yamlPath: string): ParseResult {
  let raw: string;
  try {
    raw = readFileSync(yamlPath, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read file: ${msg}` };
  }

  let plan: PlanFile;
  try {
    plan = parseYaml(raw) as PlanFile;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Invalid YAML: ${msg}` };
  }

  const validation = validatePlan(plan);
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join("; ") };
  }

  return { ok: true, plan, validation };
}

export function computePlanHash(plan: PlanFile): string {
  const content = JSON.stringify({
    plan_id: plan.plan_id,
    version: plan.version,
    nodes: plan.nodes.map((n) => ({ id: n.id, deps: n.deps })),
  });
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function initDagFromPlan(plan: PlanFile): DagState {
  const defaultRetries = plan.max_retries ?? 3;
  const nodes: Record<string, NodeState> = {};

  for (const node of plan.nodes) {
    nodes[node.id] = {
      id: node.id,
      task: node.task,
      deps: node.deps,
      verify: node.verify,
      type: node.type,
      status: "pending",
      output: null,
      max_retries: node.max_retries ?? defaultRetries,
      attempts: 0,
      last_error: null,
    };
  }

  return {
    plan_id: plan.plan_id,
    version: plan.version,
    plan_hash: computePlanHash(plan),
    nodes,
  };
}

// SQLite persistence

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function getDb(stateDir: string): Database.Database {
  ensureDir(stateDir);
  const dbPath = join(stateDir, "planrail.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS dag_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  return db;
}

export function saveDagState(dag: DagState, stateDir: string): void {
  const db = getDb(stateDir);
  try {
    const json = JSON.stringify(dag);
    db.prepare("INSERT OR REPLACE INTO dag_state (key, value) VALUES (?, ?)").run(
      "current",
      json,
    );
  } finally {
    db.close();
  }
}

export function loadDagState(stateDir: string): DagState | null {
  const dbPath = join(stateDir, "planrail.db");
  if (!existsSync(dbPath)) return null;

  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    const row = db.prepare("SELECT value FROM dag_state WHERE key = ?").get("current") as
      | { value: string }
      | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as DagState;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function clearDagState(stateDir: string): void {
  const dbPath = join(stateDir, "planrail.db");
  if (!existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    db.prepare("DELETE FROM dag_state WHERE key = ?").run("current");
  } finally {
    db.close();
  }
}
