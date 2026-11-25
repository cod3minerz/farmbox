import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EngineError } from "./android";
import { engineErrors, type AndroidTarget } from "./contracts";
import { runScheduledWorkflow } from "./runs";
import { nextScheduleAt, type Schedule, type ScheduleTiming } from "../schedules";
import { validateDeviceGraph } from "../workflow-steps";
import type { Workflow } from "../demo";

type Entry = Schedule & { workflow: Workflow };
type Scheduler = { entries: Entry[]; inFlight: Set<string>; timer?: ReturnType<typeof setInterval> };
const folder = resolve(process.env.HASHPIX_ENGINE_DATA ?? ".engine-data");
const journal = resolve(folder, "schedules.json");
const globals = globalThis as typeof globalThis & { hashpixScheduler?: Scheduler };
const scheduler = globals.hashpixScheduler ??= { entries: readSchedules(), inFlight: new Set<string>() };

function readSchedules(): Entry[] {
  try {
    const rows = JSON.parse(readFileSync(journal, "utf8"));
    if (!Array.isArray(rows)) return [];
    return rows.map((row: Entry): Entry => row.last?.status === "running"
      ? { ...row, last: { ...row.last, status: "error", detail: "Сервер остановился во время запуска." } } : row);
  } catch {
    return [];
  }
}

function commit(entries: Entry[]) {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temporary = journal + ".tmp";
  writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
  renameSync(temporary, journal);
  scheduler.entries = entries;
}

function publicEntry(entry: Entry): Schedule {
  const { workflow, ...view } = entry;
  return { ...view, workflowId: workflow.id };
}

function updateEntry(entry: Entry) {
  commit(scheduler.entries.map((existing) => existing.id === entry.id ? entry : existing));
}

export function listSchedules() {
  return scheduler.entries.map(publicEntry);
}

export function parseTiming(value: unknown): ScheduleTiming {
  if (!value || typeof value !== "object") throw new EngineError("INVALID_REQUEST");
  const timing = value as Record<string, unknown>;
  if (timing.kind === "interval" && typeof timing.minutes === "number" && Number.isInteger(timing.minutes)
    && timing.minutes >= 1 && timing.minutes <= 10080) return { kind: "interval", minutes: timing.minutes };
  if (timing.kind === "daily" && typeof timing.time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timing.time)
    && typeof timing.timezone === "string" && timing.timezone.length <= 80) {
    try { new Intl.DateTimeFormat("en-GB", { timeZone: timing.timezone }); }
    catch { throw new EngineError("INVALID_REQUEST"); }
    return { kind: "daily", time: timing.time, timezone: timing.timezone };
  }
  throw new EngineError("INVALID_REQUEST");
}

export function addSchedule(workflow: Workflow, targets: AndroidTarget[], timing: ScheduleTiming, preempt: boolean) {
  if (!workflow || typeof workflow.id !== "string" || !workflow.id || workflow.id.length > 100
    || !Number.isInteger(workflow.version)) throw new EngineError("INVALID_REQUEST");
  validateDeviceGraph(workflow);
  if (scheduler.entries.length >= 100) throw new Error("Можно сохранить до 100 расписаний.");
  const entry: Entry = {
    id: randomUUID(), workflow, workflowId: workflow.id, version: workflow.version, name: workflow.name,
    targets, timing, preempt, enabled: true, nextAt: nextScheduleAt(timing, Date.now()),
  };
  commit([...scheduler.entries, entry]);
  return publicEntry(entry);
}

export function changeSchedule(id: string, enabled: boolean | null) {
  const entry = scheduler.entries.find((item) => item.id === id);
  if (!entry) return false;
  if (scheduler.inFlight.has(id)) throw new EngineError("ENGINE_BUSY");
  if (enabled === null) commit(scheduler.entries.filter((item) => item.id !== id));
  else updateEntry({ ...entry, enabled, nextAt: enabled ? nextScheduleAt(entry.timing, Date.now()) : entry.nextAt });
  return true;
}

export function removeWorkflowSchedules(workflowId: string) {
  const matches = scheduler.entries.filter((entry) => entry.workflow.id === workflowId);
  if (matches.some((entry) => scheduler.inFlight.has(entry.id))) throw new EngineError("ENGINE_BUSY");
  if (matches.length) commit(scheduler.entries.filter((entry) => entry.workflow.id !== workflowId));
}

function finish(entry: Entry, status: NonNullable<Schedule["last"]>["status"], detail: string) {
  const now = Date.now();
  updateEntry({
    ...entry, nextAt: entry.nextAt <= now ? nextScheduleAt(entry.timing, now, entry.nextAt) : entry.nextAt,
    last: { at: entry.last?.at ?? now, status, detail },
  });
}

async function dispatch(entry: Entry) {
  try {
    const result = await runScheduledWorkflow(entry.workflow, entry.targets, entry.id, entry.preempt);
    const restart = result.restarted ? ` Перезапусков основного сценария: ${result.restarted}.` : "";
    finish(entry, "success", `Выполнено на ${result.screens} экранах.${restart}`);
  } catch (error) {
    finish(entry, error instanceof EngineError && error.code === "ENGINE_BUSY" ? "skipped" : "error",
      error instanceof EngineError ? engineErrors[error.code] : error instanceof Error ? error.message : "Запуск завершился ошибкой.");
  }
}

function tick() {
  const now = Date.now();
  for (const entry of scheduler.entries) {
    if (!entry.enabled || entry.nextAt > now || scheduler.inFlight.has(entry.id)) continue;
    const next = { ...entry, nextAt: nextScheduleAt(entry.timing, now, entry.nextAt) };
    if (now - entry.nextAt > 10000) {
      updateEntry({ ...next, last: { at: entry.nextAt, status: "skipped", detail: "Сервер пропустил это время запуска." } });
      continue;
    }
    const current: Entry = { ...next, last: { at: entry.nextAt, status: "running", detail: "Запуск по расписанию." } };
    updateEntry(current);
    scheduler.inFlight.add(entry.id);
    void dispatch(current).catch((error) => console.error("Hashpix could not save schedule outcome", error))
      .finally(() => scheduler.inFlight.delete(entry.id));
  }
}

export function startScheduler() {
  if (scheduler.timer) return;
  scheduler.timer = setInterval(() => {
    try { tick(); }
    catch (error) { console.error("Hashpix scheduler could not advance", error); }
  }, 1000);
  scheduler.timer.unref();
}
