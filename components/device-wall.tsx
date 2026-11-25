"use client";

import { BatteryMedium, Camera, ChevronDown, Clapperboard, GalleryHorizontal, Play, Settings2, Unplug, Wifi } from "./icons";
import { deviceLabels, phones, type DeviceState, type Phone, type Run } from "@/lib/demo";
import { useDemo } from "@/lib/store";
import { Checkbox, Empty, Status } from "./ui";

const tones = { ready: "green", busy: "blue", offline: "red" } as const;
const screenIcons = [Camera, Clapperboard, GalleryHorizontal, Settings2];

export function DeviceStatus({ state }: { state: DeviceState }) {
  return <Status tone={tones[state]}>{deviceLabels[state]}</Status>;
}

export function PhoneScreen({ phone, screen = phone.screen }: { phone: Phone; screen?: Phone["screen"] }) {
  if (phone.state === "offline") return <span className="phone-screen screen-offline" aria-hidden="true"><Unplug /><span>Нет сигнала</span></span>;
  return <span className={`phone-screen screen-${screen}`} aria-hidden="true">
    <span className="phone-top"><span>10:24</span><span><Wifi /> <BatteryMedium /></span></span>
    {screen === "home" && <><span className="screen-orbit" /><span className="phone-clock"><strong>10:24</strong><span>Среда, 25 ноября</span></span><span className="phone-apps">{screenIcons.map((Icon, index) => <span key={index}><Icon /></span>)}</span></>}
    {screen === "clips" && <><strong className="phone-title">Клипы</strong><span className="clip-screen"><Play /><small>Новый выпуск</small></span><span className="phone-lines"><span /><span /><span /></span></>}
    {screen === "gallery" && <><strong className="phone-title">Галерея</strong><span className="phone-gallery">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</span></>}
    {screen === "studio" && <><strong className="phone-title">Студия</strong><span className="studio-screen"><Clapperboard /><span>Монтаж 014</span></span><span className="phone-lines"><span /><span /><span /></span></>}
    {screen === "settings" && <><strong className="phone-title">Настройки</strong><span className="phone-settings">{["Сеть", "Экран", "Хранилище", "Батарея"].map((label) => <span key={label}><i />{label}<ChevronDown /></span>)}</span></>}
    <i className="phone-home" />
  </span>;
}

export type WallFilters = { status: string; host: string; query: string };

export function getDevices(runs: Run[]): Phone[] {
  return phones.map((phone) => phone.state === "busy" && !runs.some((run) => run.status === "running" && run.device === phone.name)
    ? { ...phone, state: "ready" } : phone);
}

export function filterDevices(devices: Phone[], { status, host, query }: WallFilters) {
  return devices.filter((phone) => (status === "all" || phone.state === status) &&
    (host === "all" || phone.host === host) &&
    (phone.name + " " + phone.id + " " + phone.group + " " + phone.os).toLowerCase().includes(query.trim().toLowerCase()));
}

type WallSelection = { activeId: string; checked: string[]; select: (id: string) => void; toggle: (id: string) => void };

export function DeviceWall({ devices, profile, selection }: { devices: Phone[]; profile: string; selection?: WallSelection }) {
  return <div className={`device-grid profile-${profile}`}>{devices.map((phone) => {
    const current = selection?.activeId === phone.id;
    const contents = <>
      <span className={`wall-screen ${current ? "corner-frame" : ""}`}><PhoneScreen phone={phone} /></span>
      <span className="device-caption">
        <strong>{phone.name}</strong>
        <small>{phone.id} · {phone.os}</small>
        <DeviceStatus state={phone.state} />
      </span>
    </>;
    return <article key={phone.id} className="device-tile">
      {selection ? <>
        <button className="device-hit" type="button" aria-label={"Выбрать " + phone.name} aria-pressed={current} onClick={() => selection.select(phone.id)}>{contents}</button>
        <Checkbox className="tile-check" checked={selection.checked.includes(phone.id)} onChange={() => selection.toggle(phone.id)} label={"Добавить в выбор " + phone.name} />
      </> : <div className="device-hit">{contents}</div>}
    </article>;
  })}</div>;
}

export function StandaloneWall({ filters }: { filters: WallFilters }) {
  const demo = useDemo();
  const devices = filterDevices(getDevices(demo.runs), filters);
  return <main className="standalone-wall" aria-label="Стена устройств">
    {devices.length ? <DeviceWall devices={devices} profile={demo.settings.profile} />
      : <Empty title="Устройства не найдены" detail="Измените фильтры в основной вкладке и откройте стену заново." />}
  </main>;
}
