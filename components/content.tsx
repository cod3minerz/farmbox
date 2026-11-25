"use client";

import Link from "next/link";
import { CalendarDays, Check, Clapperboard, FileVideo, List, Plus, Search, Send, Upload, Video } from "./icons";
import { useRef, useState, type ChangeEvent } from "react";
import { createId, publishLabels, type Clip, type Publication } from "@/lib/demo";
import { updateDemo, useDemo } from "@/lib/store";
import { Button, Details, Empty, Frame, Modal, PageHeading, PanelHeading, SelectField, Status } from "./ui";
import { DateTimeField } from "./date-time-field";

const channels = ["YouTube Shorts", "Instagram Reels", "TikTok"];
const publicationTones = { draft: "neutral", scheduled: "blue", published: "green", cancelled: "red" } as const;
const previews = new Map<string, string>();

function readableDate(value: string) {
  if (!value) return "—";
  const [date, time] = value.split("T");
  return date.split("-").reverse().join(".") + (time ? " · " + time : "");
}

export function Content() {
  const state = useDemo();
  const [id, setId] = useState(state.clips[0]?.id);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = state.clips.find((clip) => clip.id === id) ?? state.clips[0];
  const visible = state.clips.filter((clip) => (filter === "all" || clip.status === filter) && clip.title.toLowerCase().includes(query.trim().toLowerCase()));
  const related = state.publications.filter((publication) => publication.clip === selected.id);
  const preview = previews.get(selected.id);

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov)$/i.test(file.name)) { setNotice("Выберите видеофайл."); return; }
    const clip: Clip = {
      id: createId("CLP"), title: file.name.replace(/\.[^.]+$/, ""), source: "Локальный импорт",
      size: new Intl.NumberFormat("ru", { maximumFractionDigits: 1 }).format(file.size / 1024 / 1024) + " МБ", duration: "—", status: "review",
    };
    previews.set(clip.id, URL.createObjectURL(file));
    updateDemo((current) => ({ ...current, clips: [clip, ...current.clips] }));
    setId(clip.id);
    setFilter("all");
    setQuery("");
    setNotice("Ролик добавлен на проверку.");
  }

  return <Frame inspector={<>
    <PanelHeading title={selected.title} description={selected.id} icon={<FileVideo size={18} />} />
    <div className="panel-block">
      {preview ? <video className="media-preview" src={preview} controls preload="metadata" onLoadedMetadata={(event) => {
        const seconds = Math.floor(event.currentTarget.duration);
        if (!Number.isFinite(seconds)) return;
        const duration = Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
        updateDemo((current) => ({ ...current, clips: current.clips.map((item) => item.id === selected.id ? { ...item, duration } : item) }));
      }} /> : <div className="media-placeholder"><Clapperboard size={25} /><span>{selected.source === "Локальный импорт" ? "Файл доступен в исходной вкладке" : "Материал без локального файла"}</span></div>}
      <Details entries={[["Источник", selected.source], ["Длительность", selected.duration], ["Размер", selected.size]]} />
    </div>
    <div className="panel-block"><h3>Согласование</h3>
      {selected.status === "approved" ? <Status tone="green">Согласован</Status> : <Button variant="primary" onClick={() => {
        updateDemo((current) => ({ ...current, clips: current.clips.map((clip) => clip.id === selected.id ? { ...clip, status: "approved" } : clip) }));
        setNotice("Ролик согласован.");
      }}><Check size={15} /> Согласовать ролик</Button>}
      {selected.status === "approved" && <Link className="button button-outline" href={"/publications?clip=" + selected.id}><Send size={14} /> Создать публикацию</Link>}
    </div>
    <div className="panel-block"><h3>Публикации</h3>
      {related.length ? related.map((publication) => <Link className="inline-link" key={publication.id} href={"/publications?post=" + publication.id}>{publication.channel}</Link>) : <p className="muted">Для этого ролика ещё нет публикаций.</p>}
    </div>
  </>}>
    <PageHeading title="Контент" description="Медиатека, проверка и согласование роликов" actions={<Button variant="primary" onClick={() => fileInput.current?.click()}><Upload size={15} /> Добавить видео</Button>} />
    <input ref={fileInput} type="file" accept="video/*,.mp4,.webm,.mov" hidden onChange={importFile} />
    <div className="work-toolbar">
      <label className="search-control"><Search size={15} /><input aria-label="Поиск ролика" placeholder="Поиск ролика" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <SelectField label="Статус согласования" value={filter} onChange={setFilter} options={[{ value: "all", label: "Все материалы" }, { value: "review", label: "На проверке" }, { value: "approved", label: "Согласованы" }]} />
    </div>
    {notice && <p className="notice" role="status">{notice}</p>}
    {visible.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Ролик</th><th scope="col">Источник</th><th scope="col">Длина</th><th scope="col">Статус</th></tr></thead><tbody>
      {visible.map((clip) => <tr key={clip.id} className={selected.id === clip.id ? "table-selected" : ""}>
        <td><button type="button" className="link-button" onClick={() => setId(clip.id)}><Video size={14} />{clip.title}</button><small className="cell-meta">{clip.id}</small></td>
        <td>{clip.source}</td><td>{clip.duration}</td><td><Status tone={clip.status === "approved" ? "green" : "amber"}>{clip.status === "approved" ? "Согласован" : "На проверке"}</Status></td>
      </tr>)}
    </tbody></table></div> : <Empty title="Материалы не найдены" detail="Измените фильтр или загрузите видео." />}
  </Frame>;
}

export function Publications({ initialClip = "", initialPost }: { initialClip?: string; initialPost?: string }) {
  const state = useDemo();
  const [id, setId] = useState(initialPost ?? state.publications[0]?.id);
  const [filter, setFilter] = useState("all");
  const [mode, setMode] = useState<"queue" | "calendar">("queue");
  const [dialog, setDialog] = useState(initialClip ? "create" : "");
  const [clip, setClip] = useState(initialClip || state.clips.find((item) => item.status === "approved")?.id || "");
  const [channel, setChannel] = useState(channels[0]);
  const [account, setAccount] = useState("@hashpix");
  const [caption, setCaption] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [notice, setNotice] = useState("");
  const selected = state.publications.find((publication) => publication.id === id) ?? state.publications[0];
  const approved = state.clips.filter((item) => item.status === "approved");
  const selectedClip = state.clips.find((item) => item.id === selected.clip);
  const visible = state.publications.filter((item) => filter === "all" || item.status === filter);
  const upcoming = visible.filter((item) => item.status === "scheduled" && item.scheduled).sort((a, b) => a.scheduled.localeCompare(b.scheduled));
  const dateSize = new Set(upcoming.map((item) => item.scheduled.split("T")[0]));

  function updateSelected(patch: Partial<Publication>, message: string) {
    updateDemo((current) => ({ ...current, publications: current.publications.map((item) => item.id === selected.id ? { ...item, ...patch } : item) }));
    setDialog("");
    setNotice(message);
  }

  function create() {
    if (!approved.some((item) => item.id === clip) || !account.trim()) return;
    const publication: Publication = { id: createId("PUB"), clip, channel, account: account.trim(), caption: caption.trim(), scheduled: "", status: "draft" };
    updateDemo((current) => ({ ...current, publications: [publication, ...current.publications] }));
    setId(publication.id);
    setMode("queue");
    setFilter("all");
    setDialog("");
    setCaption("");
    setNotice("Черновик публикации создан.");
  }

  return <Frame inspector={<>
    <PanelHeading title={selected.channel} description={selected.id + " · " + selected.account} icon={<Send size={18} />} />
    <div className="panel-block"><Status tone={publicationTones[selected.status]}>{publishLabels[selected.status]}</Status>
      <Details entries={[["Ролик", selectedClip?.title ?? selected.clip], ["Дата", readableDate(selected.scheduled)], ["Часовой пояс", state.settings.timezone], ["Подтверждение", "Вручную"]]} />
      {selected.caption && <p className="muted">{selected.caption}</p>}
    </div>
    <div className="panel-block"><h3>Действия</h3>
      {(selected.status === "draft" || selected.status === "scheduled") ? <div className="panel-actions">
        <Button variant="primary" onClick={() => { setScheduled(selected.scheduled); setDialog("schedule"); }}><CalendarDays size={15} /> {selected.status === "draft" ? "Запланировать" : "Перенести"}</Button>
        {selected.status === "scheduled" && <Button onClick={() => updateSelected({ status: "published" }, "Публикация отмечена вручную.")}><Check size={15} /> Отметить опубликованной</Button>}
        <Button variant="danger" onClick={() => setDialog("cancel")}>Отменить публикацию</Button>
      </div> : <p className="muted">Публикация закрыта.</p>}
    </div>
  </>}>
    <PageHeading title="Публикации" description="Очередь, календарь и результаты по каналам" actions={<Button variant="primary" disabled={!approved.length} onClick={() => { setClip(approved[0].id); setDialog("create"); }}><Plus size={15} /> Новая публикация</Button>} />
    <div className="work-toolbar"><div className="segmented">
      <Button aria-pressed={mode === "queue"} onClick={() => setMode("queue")}><List size={15} /> Очередь</Button><Button aria-pressed={mode === "calendar"} onClick={() => { setMode("calendar"); setFilter("all"); }}><CalendarDays size={15} /> Календарь</Button>
    </div>{mode === "queue" && <SelectField label="Статус публикации" value={filter} onChange={setFilter} options={[{ value: "all", label: "Все статусы" }, ...Object.entries(publishLabels).map(([value, label]) => ({ value, label }))]} />}</div>
    {notice && <p className="notice" role="status">{notice}</p>}
    {mode === "calendar" ? dateSize.size ? <div className="calendar-groups">{[...dateSize].map((day) => <section key={day} className="calendar-group"><h2>{readableDate(day)}</h2>
      {upcoming.filter((post) => post.scheduled.startsWith(day)).map((post) => <button className="command-row" type="button" key={post.id} onClick={() => setId(post.id)} aria-pressed={selected.id === post.id}><span>{post.scheduled.split("T")[1]} · {post.channel}</span><small>{post.account}</small></button>)}
    </section>)}</div> : <Empty title="Запланированных публикаций нет" detail="Добавьте дату в черновике, чтобы он появился в календаре." /> :
      visible.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Канал</th><th scope="col">Ролик</th><th scope="col">Дата</th><th scope="col">Статус</th></tr></thead><tbody>
        {visible.map((post) => <tr key={post.id} className={selected.id === post.id ? "table-selected" : ""}>
          <td><button type="button" className="link-button" onClick={() => setId(post.id)}>{post.channel}</button><small className="cell-meta">{post.account}</small></td><td>{state.clips.find((item) => item.id === post.clip)?.title ?? post.clip}</td>
          <td>{readableDate(post.scheduled)}</td><td><Status tone={publicationTones[post.status]}>{publishLabels[post.status]}</Status></td>
        </tr>)}</tbody></table></div> : <Empty title="Публикации не найдены" detail="Измените фильтр или создайте черновик." />}
    {dialog === "create" && <Modal title="Новая публикация" onClose={() => setDialog("")}>
      <form onSubmit={(event) => { event.preventDefault(); create(); }}>
        <div className="field"><span>Ролик</span><SelectField label="Ролик" value={clip} onChange={setClip} options={approved.map((item) => ({ value: item.id, label: item.title }))} /></div>
        <div className="field"><span>Канал</span><SelectField label="Канал" value={channel} onChange={setChannel} options={channels.map((name) => ({ value: name, label: name }))} /></div>
        <label className="field">Аккаунт<input className="control" value={account} onChange={(event) => setAccount(event.target.value)} required /></label>
        <label className="field">Подпись<textarea className="control" rows={3} value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
        <div className="dialog-actions"><Button type="submit" variant="primary" disabled={!approved.some((item) => item.id === clip) || !account.trim()}>Создать черновик</Button></div>
      </form>
    </Modal>}
    {dialog === "schedule" && <Modal title="Дата и время публикации" onClose={() => setDialog("")}>
      <form onSubmit={(event) => { event.preventDefault(); if (scheduled) updateSelected({ scheduled, status: "scheduled" }, "Публикация поставлена в очередь."); }}>
        <DateTimeField initialValue={scheduled} timezone={state.settings.timezone} onChange={setScheduled} />
        <div className="dialog-actions"><Button type="submit" variant="primary" disabled={!scheduled}>Сохранить расписание</Button></div>
      </form>
    </Modal>}
    {dialog === "cancel" && <Modal title="Отменить публикацию?" onClose={() => setDialog("")}>
      <p className="dialog-note">Задача будет удалена из очереди. Ролик останется в медиатеке.</p>
      <div className="dialog-actions"><Button onClick={() => setDialog("")}>Вернуться</Button><Button variant="danger" onClick={() => updateSelected({ status: "cancelled" }, "Публикация отменена.")}>Отменить публикацию</Button></div>
    </Modal>}
  </Frame>;
}
