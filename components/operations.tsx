"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, CalendarDays, ChevronDown, ChevronRight, CircleHelp, Clapperboard, Clock3, FileVideo, Globe, HardDrive, Monitor, Plug, Radio, Server, Smartphone } from "./icons";
import { Fragment, useState } from "react";
import { isSimulationRun, phones, runLabels, type Settings as SettingsData } from "@/lib/demo";
import { updateDemo, useDemo } from "@/lib/store";
import { cancelDeviceRun, useDeviceRuns } from "@/lib/device-runs-client";
import { Button, Details, Empty, Frame, PageHeading, PanelHeading, SelectField, Status } from "./ui";

const runTones = { success: "green", error: "red", running: "blue", cancelled: "neutral" } as const;
const stepLabels = { success: "Выполнен", error: "Ошибка", running: "В работе" } as const;

export function Overview() {
  const state = useDemo();
  const failed = state.runs.filter((run) => run.status === "error");
  const review = state.clips.filter((clip) => clip.status === "review");
  const scheduled = state.publications.filter((post) => post.status === "scheduled");
  const [selected, setSelected] = useState("devices");
  const items = [
    { id: "devices", title: "Устройство без связи", icon: Smartphone, detail: "iPhone 13 · MacBook", route: "/", tone: "red", value: 1 },
    { id: "runs", title: "Запуски с ошибкой", icon: Activity, detail: failed[0]?.workflow ?? "Ошибок в журнале нет", route: failed.length ? "/runs?run=" + failed[0].id : "/runs", tone: "red", value: failed.length },
    { id: "content", title: "Материалы на проверке", icon: Clapperboard, detail: review[0]?.title ?? "Все ролики проверены", route: "/content", tone: "amber", value: review.length },
    { id: "publications", title: "В очереди публикаций", icon: CalendarDays, detail: scheduled[0]?.channel ?? "Очередь пуста", route: "/publications", tone: "blue", value: scheduled.length },
  ] as const;
  const current = items.find((item) => item.id === selected) ?? items[0];
  const CurrentIcon = current.icon;

  return <Frame inspector={<><PanelHeading title={current.title} icon={<CurrentIcon size={18} />} /><div className="panel-block"><p>{current.detail}</p><Link className="button button-outline" href={current.route}>Открыть раздел <ArrowUpRight size={14} /></Link></div></>}>
    <PageHeading title="Обзор" description="Состояние стенда и задачи, требующие внимания" />
    <div className="overview-grid">{items.map((item) => <button key={item.id} type="button" className={`overview-item ${selected === item.id ? "corner-frame" : ""}`} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>
      <item.icon size={17} className={`tone-${item.tone}`} /><strong>{item.value}</strong><span>{item.title}</span>
    </button>)}</div>
    <div className="section-head"><h2>Последние запуски</h2><Link href="/runs" className="inline-link">Все запуски <ChevronRight size={14} /></Link></div>
    <div className="flat-list">{state.runs.slice(0, 5).map((run) => <Link href={"/runs?run=" + run.id} className="command-row" key={run.id}><span><strong>{run.workflow}</strong><small>{run.started} · {run.device}</small></span><Status tone={runTones[run.status]}>{runLabels[run.status]}</Status></Link>)}</div>
  </Frame>;
}

export function Runs({ initialRun }: { initialRun?: string }) {
  const state = useDemo();
  const live = useDeviceRuns();
  const [commandError, setCommandError] = useState("");
  const [id, setId] = useState(initialRun);
  const [expandedId, setExpandedId] = useState(initialRun);
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(12);
  const [stepChoice, setStepChoice] = useState<{ runId: string; index: number } | null>(null);
  const visible = [...live, ...state.runs].filter((run) => filter === "all" || run.status === filter)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const selected = visible.find((run) => run.id === id) ?? visible[0];
  const stepIndex = selected && stepChoice?.runId === selected.id ? stepChoice.index : 0;
  const step = selected?.steps[stepIndex];
  const page = visible.slice(0, limit);
  const displayed = selected && !page.includes(selected) ? [...page.slice(0, -1), selected] : page;

  function stopRun() {
    if (!selected || selected.status !== "running") return;
    if (selected.origin === "device") {
      void cancelDeviceRun(selected.id).catch((error) => setCommandError(error.message));
      return;
    }
    updateDemo((current) => ({ ...current, runs: current.runs.map((run) => run.id === selected.id ? {
      ...run, status: "error",
      steps: run.steps.map((item) => item.status === "running" ? { ...item, status: "error", detail: "Симуляцию остановил оператор." } : item),
    } : run) }));
  }

  return <Frame inspector={<>
    <PanelHeading title={selected?.workflow ?? "Запуск"} description={selected?.id} icon={<Activity size={18} />} />
    {selected && <div className="panel-block"><Status tone={runTones[selected.status]}>{runLabels[selected.status]}</Status>
      <Details entries={[isSimulationRun(selected) ? ["Режим", "Симуляция"] : ["Устройство", selected.device], ...(selected.screen ? [["Экран", selected.screen] as [string, string]] : []), ["Старт", selected.started], ["Шагов", (selected.stepOffset ?? 0) + selected.steps.length]]} />
      {selected.status === "running" && <Button variant="danger" onClick={stopRun}>{selected.origin === "device" ? "Остановить запуск" : "Остановить симуляцию"}</Button>}
      {commandError && <p role="alert">{commandError}</p>}
    </div>}
    {step && <div className="panel-block"><h3>{step.label}</h3><Status tone={runTones[step.status]}>{stepLabels[step.status]}</Status><p className={`run-step-detail ${step.logTone && step.logTone !== "neutral" ? "tone-" + step.logTone : "muted"}`}>{step.subflow ? step.subflow + " · " : ""}{step.detail}</p></div>}
  </>}>
    <PageHeading title="Запуски" description="История выполнения сценариев" />
    <section className="run-history" aria-labelledby="run-history-title">
      <header className="run-history-header">
        <h2 id="run-history-title">История запусков</h2>
        <SelectField label="Статус запуска" value={filter} onChange={(value) => { setFilter(value); setLimit(12); }} options={[{ value: "all", label: "Все запуски" }, ...Object.entries(runLabels).map(([value, label]) => ({ value, label }))]} />
      </header>
      {visible.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Сценарий</th><th scope="col">Устройство</th><th scope="col">Время</th><th scope="col">Результат</th></tr></thead><tbody>
        {displayed.map((run) => {
          const expanded = expandedId === run.id;
          const traceId = "steps-" + run.id;
          const device = isSimulationRun(run) ? "Симуляция" : run.device;
          return <Fragment key={run.id}>
            <tr className={selected?.id === run.id ? "table-selected" : ""}>
              <td><button type="button" className="link-button run-expand" aria-expanded={expanded} aria-controls={expanded ? traceId : undefined}
                onClick={() => { setId(run.id); setExpandedId(expanded ? undefined : run.id); setStepChoice(null); }}>
                <ChevronDown size={14} /><span>{run.workflow}<small className="cell-meta run-id">{run.id}</small>
                  <small className="cell-meta run-mobile-meta">{device} · {run.started}</small></span></button></td>
              <td>{device}{run.screen && <small className="cell-meta">{run.screen}</small>}</td>
              <td>{run.started}</td><td><Status tone={runTones[run.status]}>{runLabels[run.status]}</Status></td>
            </tr>
            {expanded && <tr className="run-expanded-row"><td colSpan={4}>
              <section id={traceId} aria-label={"Шаги запуска " + run.id}>
                {run.steps.length ? <ol className="run-trace-list" role="list">
                  {run.steps.map((item, index) => <li key={(run.stepOffset ?? 0) + index}><button type="button" className="timeline-row"
                    aria-pressed={selected?.id === run.id && stepIndex === index}
                    onClick={() => { setId(run.id); setStepChoice({ runId: run.id, index }); }}>
                    <span className="step-number" aria-hidden="true">{String((run.stepOffset ?? 0) + index + 1).padStart(2, "0")}</span>
                    <span><strong>{item.label}</strong><small className={item.logTone ? "tone-" + item.logTone : undefined}>
                      {item.subflow ? item.subflow + " · " : ""}{item.detail}</small></span>
                    <Status tone={runTones[item.status]}>{stepLabels[item.status]}</Status>
                  </button></li>)}
                </ol> : <p className="muted run-empty-steps">Шагов пока нет.</p>}
              </section>
            </td></tr>}
          </Fragment>;
        })}
      </tbody></table></div> : <Empty title="В этой выборке запусков нет" detail="Измените фильтр или запустите сценарий в редакторе." />}
      {displayed.length < visible.length && <div className="history-more">
        <Button onClick={() => setLimit(displayed.length + 12)}>Показать ещё</Button>
        <span className="muted">{displayed.length} из {visible.length}</span>
      </div>}
    </section>

  </Frame>;
}

const connections = [
  { name: "Narezai", icon: Clapperboard, role: "Источник медиа", detail: "Получение подготовленных роликов и метаданных", route: "Контракт API остаётся на этапе планирования." },
  { name: "HTTP API", icon: Globe, role: "Подключение для нод", detail: "Запросы и обработка ответов", route: "В симуляции используются модельные ответы, сетевые запросы не отправляются." },
  { name: "YouTube Shorts", icon: FileVideo, role: "Публикация", detail: "Загрузка, очередь и подтверждение", route: "Доступно ручное подтверждение публикации." },
  { name: "Instagram Reels", icon: Radio, role: "Публикация", detail: "Видео и статус обработки", route: "Для реальной работы требуется подключение профессионального аккаунта." },
  { name: "TikTok", icon: Plug, role: "Ручное завершение", detail: "Подготовка ролика и данных для оператора", route: "Задачу можно подтвердить вручную." },
];

export function Integrations() {
  const [index, setIndex] = useState(0);
  const selected = connections[index];
  const Icon = selected.icon;
  return <Frame inspector={<>
    <PanelHeading title={selected.name} description={selected.role} icon={<Icon size={18} />} />
    <div className="panel-block"><Status>Не подключено</Status><p className="muted">{selected.route}</p>
      <Details entries={[["Роль", selected.role]]} />
    </div>
  </>}>
    <PageHeading title="Интеграции" description="Источники контента, API и каналы публикации" />
    <div className="flat-list integration-list">{connections.map((entry, i) => <button className={`command-row integration-row ${i === index ? "corner-frame" : ""}`} type="button" key={entry.name} aria-pressed={i === index} onClick={() => setIndex(i)}>
      <span className="integration-name"><span className="panel-icon"><entry.icon size={17} /></span><span><strong>{entry.name}</strong><small>{entry.detail}</small></span></span>
      <Status>Не подключено</Status>
    </button>)}</div>
  </Frame>;
}

export function Settings() {
  const state = useDemo();
  const [host, setHost] = useState("Studio PC");
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [saved, setSaved] = useState(false);
  const form = draft ?? state.settings;

  function setValue<T extends keyof SettingsData>(key: T, value: SettingsData[T]) {
    setDraft((previous) => ({ ...(previous ?? state.settings), [key]: value }));
    setSaved(false);
  }

  return <Frame inspector={<>
    <PanelHeading title={host} description="Пример хоста" icon={<Server size={18} />} />
    <div className="panel-block"><Details entries={[["Система", host === "Studio PC" ? "Windows" : "macOS"], ["Устройств", phones.filter((phone) => phone.host === host).length], ["Подключение", "Модельные данные"]]} /></div>
    <div className="panel-block"><h3>Хранение</h3><p className="muted">Графы и история сохраняются локально в этом браузере.</p></div>
  </>}>
    <PageHeading title="Настройки" description="Хосты, просмотр и локальные параметры стенда" />
    <div className="section-head"><h2>Хосты</h2></div>
    <div className="flat-list">{["Studio PC", "MacBook"].map((name) => <button type="button" key={name} className={`command-row integration-row ${host === name ? "corner-frame" : ""}`} aria-pressed={host === name} onClick={() => setHost(name)}>
      <span className="integration-name"><span className="panel-icon"><Monitor size={16} /></span><span><strong>{name}</strong><small>{name === "Studio PC" ? "Windows" : "macOS"}</small></span></span><Status>Пример</Status>
    </button>)}</div>
    <div className="section-head"><h2>Параметры</h2></div>
    <form className="settings-form" onSubmit={(event) => {
      event.preventDefault();
      updateDemo((current) => ({ ...current, settings: form }));
      setDraft(null);
      setSaved(true);
    }}>
      <div className="field"><span><Monitor size={15} /> Профиль просмотра</span><SelectField label="Профиль просмотра" value={form.profile} onChange={(value) => setValue("profile", value)} options={[
        { value: "balanced", label: "Сбалансированный" }, { value: "sharp", label: "Крупный" }, { value: "economy", label: "Компактный" },
      ]} /></div>
      <label className="field"><span><HardDrive size={15} /> Лимит пакета симуляций</span><input className="control" type="number" required min={1} max={12} value={form.parallel || ""} onChange={(event) => setValue("parallel", Number(event.target.value))} /></label>
      <div className="field"><span><Clock3 size={15} /> Часовой пояс</span><SelectField label="Часовой пояс" value={form.timezone} onChange={(value) => setValue("timezone", value)} options={["Europe/Moscow", "Europe/Berlin", "UTC"].map((value) => ({ value, label: value }))} /></div>
      <div className="panel-actions"><Button type="submit" variant="primary">Сохранить параметры</Button>{saved && <span role="status" className="muted">Сохранено</span>}</div>
      <p className="muted dialog-note"><CircleHelp size={15} /> Параметры сохраняются в этом браузере.</p>
    </form>
  </Frame>;
}
