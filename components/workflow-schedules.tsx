"use client";

import { useEffect, useState } from "react";
import type { AndroidTarget } from "@/lib/engine/contracts";
import type { Workflow } from "@/lib/demo";
import type { Schedule, ScheduleTiming } from "@/lib/schedules";
import { Button, Modal, SelectField, Status } from "./ui";
import { Trash2 } from "./icons";

const endpoint = "/api/engine/schedules";
const lastStatus = { running: ["blue", "В работе"], success: ["green", "Выполнено"], error: ["red", "Ошибка"], skipped: ["amber", "Пропущено"] } as const;

async function scheduleRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "Не удалось обновить расписание.");
  return data;
}

export function WorkflowSchedules({ workflow, targets, labels, timezone, onClose }: {
  workflow: Workflow; targets: AndroidTarget[]; labels: string[]; timezone: string; onClose: () => void;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [kind, setKind] = useState<ScheduleTiming["kind"]>("interval");
  const [minutes, setMinutes] = useState("60");
  const [time, setTime] = useState("09:00");
  const [preempt, setPreempt] = useState<"skip" | "restart">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    async function refresh() {
      try {
        const data = await scheduleRequest(endpoint, { signal: control.signal, cache: "no-store" }) as { schedules: Schedule[] };
        if (!control.signal.aborted) { setSchedules(data.schedules); setLoaded(true); }
      } catch (cause) {
        if (!control.signal.aborted) setError(cause instanceof Error ? cause.message : "Расписание недоступно.");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { control.abort(); clearInterval(timer); };
  }, []);

  async function change(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить расписание."); }
    finally { setBusy(false); }
  }

  function create() {
    const timing: ScheduleTiming = kind === "interval" ? { kind, minutes: Number(minutes) } : { kind, time, timezone };
    void change(async () => {
      const data = await scheduleRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow, targets, timing, preempt: preempt === "restart" }) }) as { schedule: Schedule };
      setSchedules((previous) => [...previous.filter((item) => item.id !== data.schedule.id), data.schedule]);
    });
  }

  function update(item: Schedule, remove = false) {
    void change(async () => {
      await scheduleRequest(endpoint + "/" + item.id, remove ? { method: "DELETE" } :
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !item.enabled }) });
      const data = await scheduleRequest(endpoint) as { schedules: Schedule[] };
      setSchedules(data.schedules);
    });
  }

  const entries = schedules.filter((item) => item.workflowId === workflow.id);
  return <Modal title="Расписание сценария" onClose={onClose} className="schedule-modal">
    <form onSubmit={(event) => { event.preventDefault(); create(); }}>
      <p className="schedule-targets"><strong>{workflow.name}</strong><span>{labels.length ? labels.join(", ") : "Выберите экраны для запуска на холсте."}</span></p>
      <div className="schedule-time-row">
        <div className="field"><span>Повтор</span><SelectField label="Периодичность" value={kind} onChange={setKind}
          options={[{ value: "interval", label: "Через интервал" }, { value: "daily", label: "Каждый день" }]} /></div>
        {kind === "interval" ? <label className="field">Минут<input className="control" type="number" min={1} max={10080} required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
          : <label className="field">Время · {timezone}<input className="control" type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label>}
      </div>
      <div className="field"><span>Если экран занят</span><SelectField label="Если экран занят" value={preempt} onChange={setPreempt}
        options={[{ value: "skip", label: "Пропустить запуск" }, { value: "restart", label: "Прервать и затем запустить основной с начала" }]} /></div>
      <p className="muted">Расписание запоминает текущий граф и выбранные экраны.</p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy || !targets.length}>Добавить расписание</Button>
    </form>
    {entries.length > 0 && <ul className="schedule-list" aria-label="Сохранённые расписания">
      {entries.map((item) => <li key={item.id}>
        <div><strong>{item.timing.kind === "interval" ? `Каждые ${item.timing.minutes} мин` : `Ежедневно в ${item.timing.time} · ${item.timing.timezone}`}</strong>
          <small>{item.enabled ? "Следующий запуск " + new Date(item.nextAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: timezone }) : "Отключено"}</small></div>
        <div className="schedule-actions">
          <Button disabled={busy || item.last?.status === "running"} onClick={() => update(item)}>{item.enabled ? "Отключить" : "Включить"}</Button>
          <Button disabled={busy || item.last?.status === "running"} className="icon-button" variant="danger"
            aria-label="Удалить расписание" onClick={() => update(item, true)}><Trash2 size={16} /></Button>
        </div>
        {item.last && <div className="schedule-outcome"><Status tone={lastStatus[item.last.status][0]}>{lastStatus[item.last.status][1]}</Status><span>{item.last.detail}</span></div>}
      </li>)}
    </ul>}
    {!loaded && !error && <small className="muted" role="status">Загружаем расписания…</small>}
  </Modal>;
}
