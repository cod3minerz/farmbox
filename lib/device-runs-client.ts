"use client";

import { useSyncExternalStore } from "react";
import type { Run, Workflow } from "./demo";
import type { AndroidTarget } from "./engine/contracts";

const endpoint = "/api/engine/runs";
const empty: Run[] = [];
let runs = empty;
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
const listeners = new Set<() => void>();

function emit(next: Run[]) {
  runs = next;
  listeners.forEach((listener) => listener());
}

async function poll() {
  if (!listeners.size || controller) return;
  clearTimeout(timer);
  const active = new AbortController();
  controller = active;
  try {
    const response = await fetch(endpoint, { signal: active.signal, cache: "no-store" });
    if (response.ok) {
      const data = await response.json() as { runs: Run[] };
      if (!active.signal.aborted) emit(data.runs);
    }
  } catch { /* The next poll will reconnect. */ }
  finally {
    if (controller === active) {
      controller = undefined;
      if (listeners.size) timer = setTimeout(poll, 700);
    }
  }
}

function visibility() { if (!document.hidden) void poll(); }

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void poll();
    document.addEventListener("visibilitychange", visibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    document.removeEventListener("visibilitychange", visibility);
    clearTimeout(timer);
    controller?.abort();
    controller = undefined;
  };
}

export function useDeviceRuns() {
  return useSyncExternalStore(subscribe, () => runs, () => empty);
}

export async function beginDeviceRun(workflow: Workflow, targets: AndroidTarget[]) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow, targets }) });
  const data = await response.json() as { message?: string; runs?: Run[] };
  if (!response.ok || !data.runs?.length) throw new Error(data.message ?? "Не удалось запустить сценарий.");
  controller?.abort();
  controller = undefined;
  const started = new Set(data.runs.map((run) => run.id));
  emit([...data.runs, ...runs.filter((run) => !started.has(run.id))]);
  void poll();
  return data.runs;
}

export async function cancelDeviceRun(id: string) {
  const response = await fetch(endpoint + "/" + encodeURIComponent(id), { method: "DELETE" });
  if (!response.ok) throw new Error("Не удалось остановить сценарий.");
  void poll();
}
