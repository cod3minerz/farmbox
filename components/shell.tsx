"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AiRecordVideo, AiSandTimer, CalendarDays, ChevronRight, Command, GitBranch, LayoutDashboard, MirroringScreen, PanelLeft, Plug, Radio, Search, Settings2 } from "./icons";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import wordmark from "@/lib/hashpix-wordmark.json";
import { isSection, sections, type Section } from "@/lib/sections";
import { Button, HeaderActions, Modal, watchViewport } from "./ui";

const icons = { devices: MirroringScreen, overview: LayoutDashboard, automations: GitBranch, content: AiRecordVideo, publications: CalendarDays, runs: AiSandTimer, integrations: Plug, settings: Settings2 };
const groups: { title: string; links: Section[] }[] = [
  { title: "Рабочая область", links: ["devices", "overview", "automations", "runs"] },
  { title: "Производство", links: ["content", "publications"] },
  { title: "Система", links: ["integrations", "settings"] },
];

const wordmarkRows = wordmark.map((row) => row.replaceAll("|", " "));
const terminalLogo = [...wordmarkRows, ""].map((row, y) =>
  Array.from({ length: wordmarkRows[0].length + 1 }, (_, x) => row[x] === "#" ? "solid" :
    wordmarkRows[y - 1]?.[x - 1] === "#" ? "shadow" : "")
);

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const slug = pathname.split("/")[1];
  const section = isSection(slug) ? slug : "devices";
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  const [rail, setRail] = useState<"auto" | "open" | "closed">("auto");
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const wide = useSyncExternalStore(watchViewport, () => window.innerWidth >= 1280, () => true);
  const railExpanded = rail === "open" || (rail === "auto" && wide);
  const railAction = railExpanded ? "Свернуть навигацию" : "Развернуть навигацию";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearch(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <div className={`shell rail-${rail}`}>
    <a className="skip-link" href="#workspace">К рабочей области</a>
    <header className="topbar">
      <div className="brand">
        <Link href="/" aria-label="Hashpix Automation, устройства"><span className="brand-logo" aria-hidden="true">
          {terminalLogo.flatMap((row, y) => row.map((pixel, x) => pixel &&
            <span key={y * row.length + x} className={pixel} style={{ gridArea: `${y + 1} / ${x + 1}` }} />))}
        </span></Link>
        <Button variant="ghost" className="icon-button rail-toggle" title={railAction} aria-label={railAction} aria-expanded={railExpanded} aria-controls="workspace-navigation"
          onClick={() => setRail(railExpanded ? "closed" : "open")}><PanelLeft size={18} className={railExpanded ? undefined : "panel-arrow-reversed"} /></Button>
      </div>
      <div className="topbar-content"><div className="breadcrumbs"><span>Рабочая область</span><ChevronRight size={13} /><strong>{sections[section]}</strong></div><div className="topbar-actions" ref={setHeaderActions} /></div>
    </header>
    <div className="shell-body">
      <aside className="sidebar" id="workspace-navigation">
        <Button className="sidebar-search" onClick={() => setSearch(true)} aria-label="Поиск разделов"><Search size={15} /><span>Поиск разделов</span><kbd aria-hidden="true"><Command size={12} /> K</kbd></Button>
        <nav aria-label="Навигация платформы">
          {groups.map((group) => <div className="nav-group" key={group.title}>
            <div className="nav-label">{group.title}</div>
            {group.links.map((entry) => {
              const Icon = icons[entry];
              return <Link className={`nav-item ${section === entry ? "corner-frame" : ""}`} href={entry === "devices" ? "/" : "/" + entry}
                key={entry} title={sections[entry]} aria-label={sections[entry]} aria-current={section === entry ? "page" : undefined}
                onClick={() => { if (window.innerWidth < 1280 && rail === "open") setRail("auto"); }}>
                <Icon size={16} /><span>{sections[entry]}</span>
              </Link>;
            })}
          </div>)}
        </nav>
        <div className="sidebar-foot"><Radio size={15} /><span>Локальная среда</span></div>
      </aside>
      <HeaderActions value={headerActions}>{children}</HeaderActions>
    </div>
    {search && <Modal title="Перейти к разделу" onClose={() => { setSearch(false); setQuery(""); }}>
      <input autoFocus className="control search-input" aria-label="Название раздела" placeholder="Название раздела…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="command-results">{(Object.keys(sections) as Section[]).filter((id) => sections[id].toLowerCase().includes(query.trim().toLowerCase())).map((id) =>
        <Link className="command-row" key={id} href={id === "devices" ? "/" : "/" + id} onClick={() => { setSearch(false); setQuery(""); }}>{sections[id]} <ChevronRight size={14} /></Link>
      )}{!(Object.values(sections)).some((label) => label.toLowerCase().includes(query.trim().toLowerCase())) && <p className="muted">Разделы не найдены.</p>}</div>
    </Modal>}
  </div>;
}
