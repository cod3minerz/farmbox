import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initial, type Workflow } from "../demo";
import { portableWorkflow } from "../workflow-file";
import { EngineError } from "./android";
import { removeWorkflowSchedules } from "./scheduler";

const folder = resolve(process.env.HASHPIX_ENGINE_DATA ?? ".engine-data");
let connection: DatabaseSync | undefined;

function database() {
  if (!connection) {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(resolve(folder, "workflows.sqlite"));
    db.exec(`
      PRAGMA busy_timeout = 100;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS workflow (id TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_workflow (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
    `);
    connection = db;
  }
  return connection;
}

function clean(workflow: unknown): Workflow {
  if (!workflow || typeof workflow !== "object") throw new EngineError("INVALID_REQUEST");
  const { id, version, targets } = workflow as Record<string, unknown>;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(id) ||
    typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER ||
    (targets !== undefined && (!Array.isArray(targets) || targets.length > 64 || targets.some((target) => typeof target !== "string" || target.length > 200)))) {
    throw new EngineError("INVALID_REQUEST");
  }
  return { ...portableWorkflow(workflow), id, version, targets: targets as string[] | undefined };
}

export function readWorkflowLibrary() {
  const row = database().prepare(`
    SELECT COALESCE((SELECT revision FROM library WHERE id = 1), 0) AS revision,
      (SELECT json_group_array(json(body)) FROM (SELECT body FROM workflow ORDER BY rowid)) AS workflows
  `).get()!;
  return { revision: Number(row.revision), workflows: JSON.parse(String(row.workflows)) as Workflow[] };
}

export class WorkflowConflict extends Error {}

function migrateWorkflows(db: DatabaseSync, source: unknown[]) {
  const get = db.prepare("SELECT body FROM workflow WHERE id = ?");
  const put = db.prepare("INSERT OR IGNORE INTO workflow (id, body) VALUES (?, ?)");
  const deleted = db.prepare("SELECT 1 FROM deleted_workflow WHERE id = ?");
  const workflows = source.map(clean).filter((entry) => !deleted.get(entry.id));
  const copies = new Map<string, string>();
  const newRows = new Set(workflows.filter((entry) => !get.get(entry.id)).map((entry) => entry.id));

  function asCopy(workflow: Workflow) {
    const digest = createHash("sha256").update(JSON.stringify(workflow)).digest("hex").slice(0, 32);
    copies.set(workflow.id, "RECOVERED-" + digest);
  }

  for (const workflow of workflows) {
    const existing = get.get(workflow.id);
    if (!existing) continue;
    const canonical = JSON.parse(String(existing.body)) as Workflow;
    if (JSON.stringify({ ...canonical, version: workflow.version }) === JSON.stringify(workflow)) continue;
    const starter = initial.workflows.find((entry) => entry.id === workflow.id);
    if (starter && JSON.stringify(clean(starter)) === String(existing.body)) {
      db.prepare("UPDATE workflow SET body = ? WHERE id = ?").run(JSON.stringify(workflow), workflow.id);
    } else {
      asCopy(workflow);
    }
  }

  // If a recovered child has a new ID, preserve the legacy caller with those same references.
  for (let changed = true; changed;) {
    changed = false;
    for (const workflow of workflows) {
      if (!newRows.has(workflow.id) && !copies.has(workflow.id) &&
        workflow.nodes.some((node) => node.data.kind === "call" && copies.has(node.data.parameter))) {
        asCopy(workflow);
        changed = true;
      }
    }
  }
  for (const workflow of workflows) {
    const copyId = copies.get(workflow.id);
    if (!copyId && !newRows.has(workflow.id)) continue;
    const id = copyId ?? workflow.id;
    if (deleted.get(id)) continue;
    const nodes = workflow.nodes.map((node) => {
      const target = node.data.kind === "call" ? copies.get(node.data.parameter) : undefined;
      return target ? { ...node, data: { ...node.data, parameter: target } } : node;
    });
    put.run(id, JSON.stringify({ ...workflow, id, name: copyId ? workflow.name.slice(0, 76) + " · копия из браузера" : workflow.name, nodes }));
  }
}

export function updateWorkflowLibrary(input: unknown) {
  if (!input || typeof input !== "object") throw new EngineError("INVALID_REQUEST");
  const change = input as Record<string, unknown>;
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT revision FROM library WHERE id = 1").get();
    const insert = db.prepare("INSERT OR IGNORE INTO workflow (id, body) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM deleted_workflow WHERE id = ?)");
    if (change.action === "migrate" || (change.action === "create" && existing)) {
      const source = change.workflows === null && change.action === "migrate" ? existing ? [] : initial.workflows : change.workflows;
      if (!Array.isArray(source) || source.length > 512) throw new EngineError("INVALID_REQUEST");
      if (change.action === "migrate") migrateWorkflows(db, source);
      else for (const raw of source) {
        const workflow = clean(raw);
        const result = insert.run(workflow.id, JSON.stringify(workflow), workflow.id);
        if (!result.changes) throw new WorkflowConflict("Сценарий с таким идентификатором уже есть.");
      }
    } else if (existing && (change.action === "save" || change.action === "delete")) {
      if (typeof change.id !== "string" || !Number.isSafeInteger(change.version)) throw new EngineError("INVALID_REQUEST");
      const stored = db.prepare("SELECT body FROM workflow WHERE id = ?").get(change.id);
      if (!stored || (JSON.parse(String(stored.body)) as Workflow).version !== change.version) {
        throw new WorkflowConflict("Сценарий изменился или был удалён в другой вкладке. Экспортируйте свои правки в .hpx, чтобы сохранить копию.");
      }
      if (change.action === "save") {
        const updated = clean(change.workflow);
        if (updated.id !== change.id || updated.version !== Number(change.version) + 1) throw new EngineError("INVALID_REQUEST");
        db.prepare("UPDATE workflow SET body = ? WHERE id = ?").run(JSON.stringify(updated), updated.id);
      } else {
        removeWorkflowSchedules(change.id);
        db.prepare("INSERT INTO deleted_workflow (id) VALUES (?)").run(change.id);
        db.prepare("DELETE FROM workflow WHERE id = ?").run(change.id);
      }
    } else throw new EngineError("INVALID_REQUEST");
    db.exec(`INSERT INTO library (id, revision) VALUES (1, 1)
      ON CONFLICT(id) DO UPDATE SET revision = revision + 1`);
    const view = readWorkflowLibrary();
    db.exec("COMMIT");
    return view;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
