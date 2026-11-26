"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Workflow } from "./demo";
import { updateDemo } from "./store";

const endpoint = "/api/engine/workflows";
const legacyKey = "hashpix-automation-demo-v1";
const migrationKey = "hashpix-workflows-migrated-v1";

type LibraryView = { revision: number; workflows: Workflow[] };
type Change = { action: "create"; workflows: Workflow[] } | { action: "delete"; id: string; version: number } |
  { action: "save"; id: string; version: number; workflow: Workflow };

async function request(payload?: Change | { action: "migrate"; workflows: Workflow[] | null }) {
  const response = await fetch(endpoint, payload ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  } : { cache: "no-store", signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message ?? "Не удалось открыть библиотеку сценариев.");
  return data as LibraryView;
}

function legacyWorkflows(): Workflow[] | null {
  try {
    const previous = JSON.parse(localStorage.getItem(legacyKey) ?? localStorage.getItem(migrationKey + "-backup") ?? "null");
    if (!Array.isArray(previous?.workflows)) return null;
    if (!localStorage.getItem(migrationKey + "-backup")) {
      try { localStorage.setItem(migrationKey + "-backup", JSON.stringify({ workflows: previous.workflows })); } catch { /* Keep the original cache. */ }
    }
    return previous.workflows;
  } catch { return null; }
}

export function useWorkflowLibrary(ready: boolean) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);

  const apply = useCallback((view: LibraryView, selectedWorkflowId?: string) => {
    if (view.revision < revision.current) return;
    revision.current = view.revision;
    updateDemo((state) => ({
      ...state, workflows: view.workflows,
      selectedWorkflowId: selectedWorkflowId ?? state.selectedWorkflowId,
    }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      let view = await request();
      let migrated = false;
      try { migrated = localStorage.getItem(migrationKey) === "1"; } catch { /* Storage is optional. */ }
      if (!migrated || view.revision === 0) {
        view = await request({ action: "migrate", workflows: legacyWorkflows() });
        try { localStorage.setItem(migrationKey, "1"); } catch { /* The server deduplicates migrations. */ }
      }
      apply(view);
      setLoaded(true);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось открыть библиотеку сценариев.");
    }
  }, [apply]);

  useEffect(() => {
    if (!ready) return;
    function onFocus() { void refresh(); }
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready, refresh]);

  async function change(payload: Change, selected?: string) {
    if (!loaded) throw new Error("Библиотека сценариев ещё не открыта.");
    apply(await request(payload), selected);
  }

  return { loaded, error, change, refresh };
}
