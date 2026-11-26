"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cancelDeviceRun, useDeviceRuns } from "@/lib/device-runs-client";
import { isSimulationRun, runLabels } from "@/lib/demo";
import { useDemo } from "@/lib/store";
import { ChevronDown } from "./icons";

const clock = new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LiveRunJournal() {
  const runs = useDeviceRuns();
  const simulation = useDemo().runs.find(isSimulationRun);
  const simulationId = simulation?.id;
  const journal = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState("");
  const active = runs.filter((run) => run.status === "running");
  const batches = new Set(active.map((run) => run.startedAt).filter((time) => time !== undefined));
  const recentDevices = active.length ? runs.filter((run) => run.status === "running" || (run.startedAt !== undefined && batches.has(run.startedAt))).slice(0, 12)
    : runs.filter((run) => run.startedAt === runs[0]?.startedAt).slice(0, 4);
  const recent = simulation ? [simulation, ...recentDevices] : recentDevices;
  useEffect(() => {
    if (simulationId && journal.current) journal.current.open = true;
  }, [simulationId]);

  if (!recent.length) return null;
  const latest = recent.flatMap((run) => run.steps.slice(-15).map((step, index) => ({ run, step, index })))
    .sort((a, b) => (b.step.at ?? 0) - (a.step.at ?? 0) || b.index - a.index).slice(0, 15);

  return <details ref={journal} className="panel-block live-journal" open={active.length > 0}>
    <summary>
      <span>Журнал запусков</span>
      {active.length > 0 && <small>{active.length} в работе</small>}
      <ChevronDown size={16} aria-hidden="true" />
    </summary>
    <div className="live-journal-screens">
      {recent.map((run) => <div key={run.id}>
        <Link href={"/runs?run=" + run.id} className="inline-link">{isSimulationRun(run) ? "Симуляция · " + run.workflow : run.screen ?? run.device}</Link>
        {run.status === "running" ? <button type="button" className="link-button journal-stop" onClick={() => {
          setError("");
          void cancelDeviceRun(run.id).catch((cause: Error) => setError(cause.message));
        }}>Остановить</button> : <span className="muted">{runLabels[run.status]}</span>}
      </div>)}
    </div>
    {error && <p role="alert">{error}</p>}
    <ol className="live-journal-events" aria-label="Последние события запуска">
      {latest.map(({ run, step, index }) => <li key={run.id + "/" + ((run.stepOffset ?? 0) + run.steps.length - Math.min(15, run.steps.length) + index)}>
        <small><span>{isSimulationRun(run) ? "Симуляция" : run.device + " · " + (run.screen ?? "Экран")}</span>
          {step.at && <time dateTime={new Date(step.at).toISOString()}>{clock.format(step.at)}</time>}</small>
        <strong className={`journal-step-${step.status}`}>{step.label}</strong>
        <span className={`run-step-detail ${step.logTone ? "tone-" + step.logTone : ""}`}>{step.subflow ? step.subflow + " · " : ""}{step.detail}</span>
      </li>)}
    </ol>
  </details>;
}
