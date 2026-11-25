"use client";

import { useRef, useState } from "react";
import type { AndroidInput, AndroidTarget } from "@/lib/engine/contracts";
import { AndroidVideo } from "./android-video";
import { Trash2 } from "./icons";
import { Button, Modal, SelectField } from "./ui";

export type RecordedTap = { id: number; x: number; y: number; waitMs: number };
export type RecorderTarget = AndroidTarget & { key: string; label: string; device: string };

export function GestureRecorder({ targets, onInsert, onClose, maxNodes }: {
  targets: RecorderTarget[]; onInsert: (points: RecordedTap[]) => void; onClose: () => void; maxNodes: number;
}) {
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const target = targets.find((item) => item.key === targetKey);
  const [points, setPoints] = useState<RecordedTap[]>([]);
  const [live, setLive] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const last = useRef<number | null>(null);
  const nextId = useRef(0);
  const pending = useRef(false);
  const nodeCount = points.length + points.filter((point) => point.waitMs > 0).length;

  async function capture(gesture: Extract<AndroidInput, { kind: "tap" | "swipe" }>) {
    if (gesture.kind !== "tap" || !target || pending.current) return;
    const at = performance.now();
    const waitMs = last.current === null ? 0 : Math.min(600000, Math.round((at - last.current) / 100) * 100);
    if (points.length >= 30 || nodeCount + (waitMs ? 2 : 1) > maxNodes) {
      setError("Достигнут предел нод сценария.");
      return;
    }
    setError("");
    if (live) {
      pending.current = true;
      setSending(true);
      try {
        const path = "/api/engine/android/" + encodeURIComponent(target.serial) + "/input"
          + (target.screen ? "?screen=" + encodeURIComponent(target.screen) : "");
        const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(gesture) });
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(data?.message ?? "Касание не отправлено.");
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Касание не отправлено.");
        return;
      } finally {
        pending.current = false;
        setSending(false);
      }
    }
    last.current = at;
    const point = { id: nextId.current++, x: Math.round(gesture.x * 1000) / 10, y: Math.round(gesture.y * 1000) / 10, waitMs };
    setPoints((current) => [...current, point]);
  }

  return <Modal title="Запись касаний" className="gesture-recorder" onClose={onClose}>
    {target ? <div className="recorder-layout">
      <div className="recorder-preview">
        <AndroidVideo key={target.key} serial={target.serial} screen={target.screen} label={target.label} onGesture={(gesture) => void capture(gesture)}
          overlay={points.map((point, index) => <span key={point.id} className="recorder-marker" aria-hidden="true"
            style={{ left: point.x + "%", top: point.y + "%" }}>{index + 1}</span>)} />
      </div>
      <div className="recorder-editor">
        <SelectField label="Экран для записи" value={targetKey} disabled={points.length > 0 || sending}
          options={targets.map((item) => ({ value: item.key, label: item.device + " · " + item.label }))} onChange={setTargetKey} />
        <p className="muted">Нажимайте на превью, чтобы поставить точки. Задержку перед каждым касанием можно изменить.</p>
        <label className="record-live"><input type="checkbox" checked={live} disabled={sending}
          onChange={(event) => setLive(event.target.checked)} /> Отправлять касания на телефон</label>
        {error && <p role="alert">{error}</p>}
        <ol className="recorded-points" aria-label="Точки касаний">
          {points.map((point, index) => <li key={point.id}>
            <strong>{index + 1}</strong><span>{point.x}% · {point.y}%</span>
            <label><span>Пауза, с</span><input className="control" type="number" min={0} max={600} step={0.1}
              aria-label={`Пауза перед касанием ${index + 1}, секунды`} value={point.waitMs / 1000}
              onChange={(event) => {
                const seconds = Math.max(0, Math.min(600, Number(event.target.value) || 0));
                setPoints((current) => current.map((item) => item.id === point.id ? { ...item, waitMs: Math.round(seconds * 1000) } : item));
              }} /></label>
            <Button className="icon-button" aria-label={`Удалить касание ${index + 1}`} onClick={() => {
              if (points.length === 1) last.current = null;
              setPoints((current) => current.filter((item) => item.id !== point.id));
            }}><Trash2 size={15} /></Button>
          </li>)}
        </ol>
        <div className="dialog-actions"><Button variant="primary" disabled={!points.length || sending || nodeCount > maxNodes} onClick={() => onInsert(points)}>Вставить в граф</Button></div>
      </div>
    </div> : <p className="muted">Выбранный экран недоступен.</p>}
  </Modal>;
}
