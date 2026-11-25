"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { AndroidApp, AndroidDevice, AndroidScreen } from "@/lib/engine/contracts";
import { Plus, Search, Smartphone } from "./icons";
import { Button, Modal, SelectField } from "./ui";

export function AndroidAppPicker({ devices, screens, initialSerial, onOpen, onClose }: {
  devices: AndroidDevice[]; screens: AndroidScreen[]; initialSerial?: string;
  onOpen: (serial: string, id: string) => Promise<void>; onClose: () => void;
}) {
  const [serialChoice, setSerialChoice] = useState(initialSerial ?? "");
  const serial = devices.some((device) => device.serial === serialChoice) ? serialChoice : devices[0]?.serial ?? "";
  const [results, setResults] = useState<{ serial: string; apps: AndroidApp[]; error?: string }>();
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const current = results?.serial === serial ? results : undefined;
  const active = screens.filter((screen) => screen.serial === serial);
  const apps = current?.apps.filter((app) => (app.label + " " + app.package).toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  useEffect(() => {
    if (!serial) return;
    const stop = new AbortController();
    void fetch("/api/engine/android/" + encodeURIComponent(serial) + "/apps", { signal: stop.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json() as { apps?: AndroidApp[]; message?: string };
      if (!response.ok || !data.apps) throw new Error(data.message ?? "Каталог приложений недоступен.");
      if (!stop.signal.aborted) setResults({ serial, apps: data.apps });
    }).catch((reason) => {
      if (!stop.signal.aborted) setResults({ serial, apps: [], error: reason instanceof Error ? reason.message : "Каталог приложений недоступен." });
    });
    return () => stop.abort();
  }, [serial]);

  async function open(app: AndroidApp) {
    setOpening(app.id);
    setError("");
    try { await onOpen(serial, app.id); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Экран не открылся."); }
    finally { setOpening(""); }
  }

  return <Modal title="Добавить виртуальный экран" onClose={onClose} className="app-picker-dialog">
    <div className="app-picker-fields">
      <SelectField label="Телефон" value={serial} onChange={(value) => { setSerialChoice(value); setError(""); }} disabled={Boolean(opening)}
        options={devices.map((device) => ({ value: device.serial, label: device.model }))} />
      <label className="search-control"><Search size={15} /><input autoFocus aria-label="Поиск приложения" placeholder="Найти приложение" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    {error && <p className="notice" role="alert">{error}</p>}
    {active.length >= 3 && <p className="muted">На этом телефоне уже открыты три виртуальных экрана.</p>}
    {!serial ? <p className="muted">Подключите телефон.</p> : !current ? <p className="muted" role="status">Читаем список с телефона…</p> :
      current.error ? <p role="alert">{current.error}</p> : !apps.length ? <p className="muted">Приложения не найдены.</p> :
      <div className="app-picker-list">
        {apps.map((app) => {
          const opened = active.some((screen) => screen.appId === app.id);
          return <Button key={app.id} variant="ghost" className="app-picker-item" aria-label={app.label + (app.user === 999 ? " · копия" : app.user ? " · профиль " + app.user : "")}
            disabled={Boolean(opening) || opened || active.length >= 3} onClick={() => void open(app)}>
            {app.icon ? <Image src={app.icon} alt="" width={32} height={32} unoptimized /> : <span className="app-picker-fallback"><Smartphone size={17} /></span>}
            <span><strong>{app.label}{app.user === 999 && <span className="app-copy-label">Копия</span>}{app.user !== 0 && app.user !== 999 && <span className="app-copy-label">Профиль {app.user}</span>}</strong><small>{app.package}</small></span>
            <span className="app-picker-action">{opening === app.id ? "Открываем…" : opened ? "Открыто" : <Plus size={15} />}</span>
          </Button>;
        })}
      </div>}
  </Modal>;
}
