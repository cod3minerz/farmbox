"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Home, LayoutGrid, List, Monitor, Plus, Smartphone } from "./icons";
import { Button, Details, Empty, Frame, Modal, PageHeading, PanelHeading, SelectField, Status } from "./ui";
import type { AndroidDevice, AndroidInput, AndroidInventory, AndroidScreen, AndroidTarget } from "@/lib/engine/contracts";
import { useDemo } from "@/lib/store";
import { AndroidVideo } from "./android-video";
import { AndroidAppPicker } from "./android-app-picker";

const root = "/api/engine/android";
const refreshEvent = "hashpix:android-changed";

function devicePath(serial: string) { return root + "/" + encodeURIComponent(serial); }

async function requestEngine(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(data?.message ?? "Не удалось связаться с локальным движком.");
  }
  return response;
}

export function useAndroidInventory() {
  const [inventory, setInventory] = useState<{ devices: AndroidDevice[]; screens: AndroidScreen[]; error: string; loaded: boolean }>({
    devices: [], screens: [], error: "", loaded: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request = 0;
    async function poll() {
      clearTimeout(timer);
      const attempt = ++request;
      if (!document.hidden) {
        try {
          const response = await requestEngine(root, { signal: controller.signal, cache: "no-store" });
          const data = await response.json() as AndroidInventory;
          if (!controller.signal.aborted && attempt === request) setInventory({ devices: data.devices, screens: data.screens ?? [], error: "", loaded: true });
        } catch (error) {
          if (!controller.signal.aborted && attempt === request) setInventory((old) => ({ ...old, error: error instanceof Error ? error.message : "Ошибка подключения.", loaded: true }));
        }
      }
      if (!controller.signal.aborted && attempt === request) timer = setTimeout(poll, 2200);
    }
    void poll();
    window.addEventListener(refreshEvent, poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener(refreshEvent, poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);
  return inventory;
}

const states = {
  ready: { label: "Подключён", tone: "green" },
  unauthorized: { label: "Разрешите отладку", tone: "amber" },
  offline: { label: "Нет связи", tone: "red" },
  unavailable: { label: "Недоступен", tone: "neutral" },
} as const;

export function screenLabel(screen: Pick<AndroidScreen, "label" | "user">) {
  return screen.label + (screen.user === 999 ? " · копия" : screen.user ? " · профиль " + screen.user : "");
}

function DeviceStatus({ device }: { device: AndroidDevice }) {
  return <Status tone={states[device.state].tone}>{states[device.state].label}</Status>;
}

function Screen({ device, send }: { device: AndroidDevice; send?: (input: AndroidInput) => void }) {
  if (device.state === "ready") return <AndroidVideo serial={device.serial} label={device.model} onGesture={send} />;
  return <span className="android-placeholder"><Smartphone size={22} /><span>{states[device.state].label}</span></span>;
}

function InventoryEmpty({ loaded, error }: { loaded: boolean; error: string }) {
  return <Empty title={error ? "Движок устройств недоступен" : loaded ? "Нет подключённых Android-устройств" : "Поиск устройств"}
    detail={error || (loaded ? "Подключите телефон по USB и разрешите отладку в настройках разработчика." : "Проверяем подключения через ADB.")} />;
}

function DeviceGrid({ devices, screens, current, open, add }: {
  devices: AndroidDevice[]; screens: AndroidScreen[]; current?: string; open: (target: AndroidTarget) => void; add?: () => void;
}) {
  const { settings } = useDemo();
  return <div className={"device-grid android-device-grid profile-" + settings.profile}>
    {devices.map((device) => <Fragment key={device.serial}>
      <article className="device-tile">
        <button className="device-hit" type="button" onClick={() => open({ serial: device.serial })} aria-label={"Управлять " + device.model}>
          <span className={current === device.serial ? "wall-screen corner-frame" : "wall-screen"}><Screen key={device.state} device={device} /></span>
          <span className="device-caption"><strong>{device.model}</strong><small>Основной экран</small><DeviceStatus device={device} /></span>
        </button>
      </article>
      {device.state === "ready" && screens.filter((screen) => screen.serial === device.serial).map((screen) => <article className="device-tile" key={screen.id}>
        <button className="device-hit" type="button" aria-label={"Управлять " + screenLabel(screen)} onClick={() => open({ serial: device.serial, screen: screen.id })}>
          <AndroidVideo serial={device.serial} screen={screen.id} label={screenLabel(screen)} />
          <span className="device-caption"><strong>{screenLabel(screen)}</strong><small>{screen.awaitingConfirmation ? "Подтвердите запуск копии" : device.model + " · виртуальный экран"}</small></span>
        </button>
      </article>)}
    </Fragment>)}
    {add && <button className="add-screen" type="button" onClick={add}><Plus size={28} /><span>Добавить экран</span></button>}
  </div>;
}

function ScreenControl({ target, device, screens, onSwitch, onClose }: {
  target: AndroidTarget; device?: AndroidDevice; screens: AndroidScreen[];
  onSwitch: (target: AndroidTarget) => void; onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const sending = useRef(false);
  const screen = target.screen ? screens.find((entry) => entry.id === target.screen && entry.serial === target.serial) : undefined;
  const available = device?.state === "ready" && (!target.screen || screen);
  const title = screen ? screenLabel(screen) : device?.model ?? "Экран телефона";

  async function send(input: AndroidInput) {
    if (!available || sending.current) return;
    sending.current = true;
    setError("");
    try {
      await requestEngine(devicePath(target.serial) + "/input" + (target.screen ? "?screen=" + target.screen : ""), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
    } catch (error) { setError(error instanceof Error ? error.message : "Команда не выполнена."); }
    finally { sending.current = false; }
  }

  async function changeVirtual(method: "PATCH" | "DELETE") {
    setChanging(true);
    setError("");
    try {
      await requestEngine(devicePath(target.serial) + "/screens/" + target.screen, { method });
      if (method === "DELETE") onClose();
      window.dispatchEvent(new Event(refreshEvent));
    } catch (error) { setError(error instanceof Error ? error.message : "Команда не выполнена."); }
    finally { setChanging(false); }
  }

  const options = [{ value: "main", label: "Основной экран" }, ...screens.filter((entry) => entry.serial === target.serial)
    .map((entry) => ({ value: entry.id, label: screenLabel(entry) }))];
  return <Modal title={title} onClose={onClose} className="device-control-dialog">
    {available ? <>
      {options.length > 1 && <div className="device-control-selector"><SelectField label="Активный экран" options={options}
        value={target.screen ?? "main"} onChange={(value) => onSwitch({ serial: target.serial, screen: value === "main" ? undefined : value })} /></div>}
      {screen?.awaitingConfirmation && <p className="device-control-note">Разблокируйте Redmi и, если MIUI покажет диалог, подтвердите запуск копии.</p>}
      <div className="android-control-screen"><AndroidVideo serial={target.serial} screen={target.screen} label={title} onGesture={(input) => void send(input)} /></div>
      {error && <p role="alert" className="muted">{error}</p>}
      <div className="device-control-actions">
        <Button onClick={() => void send({ kind: "key", key: "back" })}>Назад</Button>
        {screen ? <>
          <Button disabled={changing} onClick={() => void changeVirtual("PATCH")}>{screen.awaitingConfirmation ? "Повторить запуск" : "Открыть приложение"}</Button>
          <Button variant="danger" disabled={changing} onClick={() => void changeVirtual("DELETE")}>Закрыть экран</Button>
        </>
          : <><Button onClick={() => void send({ kind: "key", key: "home" })}><Home size={15} /> Домой</Button>
            <Button onClick={() => void send({ kind: "key", key: "wake" })}>Включить экран</Button></>}
      </div>
    </> : <Empty title={device ? "Экран недоступен" : "Ищем устройство"} detail={device ? "Подключите телефон или откройте виртуальный экран заново." : "Подключаемся через ADB."} />}
  </Modal>;
}

export function AndroidWall({ status = "all" }: { status?: string }) {
  const inventory = useAndroidInventory();
  const devices = inventory.devices.filter((device) => status === "all" || device.state === status);
  const [target, setTarget] = useState<AndroidTarget | null>(null);
  return <main className="standalone-wall" aria-label="Стена устройств">
    {devices.length ? <DeviceGrid devices={devices} screens={inventory.screens} open={setTarget} /> : <InventoryEmpty loaded={inventory.loaded} error={inventory.error} />}
    {target && <ScreenControl key={target.serial + "/" + (target.screen ?? "")} target={target} device={inventory.devices.find((item) => item.serial === target.serial)}
      screens={inventory.screens} onSwitch={setTarget} onClose={() => setTarget(null)} />}
  </main>;
}

let deviceWorkspace: { current: string; view: "wall" | "list"; filter: string; control: AndroidTarget | null } = {
  current: "", view: "wall", filter: "all", control: null,
};

export function AndroidDevices() {
  const inventory = useAndroidInventory();
  const [current, setCurrent] = useState(() => deviceWorkspace.current);
  const [view, setView] = useState(() => deviceWorkspace.view);
  const [filter, setFilter] = useState(() => deviceWorkspace.filter);
  const [control, setControl] = useState(() => deviceWorkspace.control);
  const [picker, setPicker] = useState(false);
  const visible = inventory.devices.filter((device) => filter === "all" || device.state === filter);
  const ready = inventory.devices.filter((device) => device.state === "ready");
  const selected = visible.find((item) => item.serial === current) ?? visible[0];

  useEffect(() => { deviceWorkspace = { current, view, filter, control }; }, [current, view, filter, control]);

  function open(target: AndroidTarget) {
    setCurrent(target.serial);
    setControl(target);
  }

  async function addScreen(serial: string, id: string) {
    await requestEngine(devicePath(serial) + "/screens/" + id, { method: "POST" });
    window.dispatchEvent(new Event(refreshEvent));
  }

  return <Frame inspector={selected ? <>
    <PanelHeading title={selected.model} description={selected.serial} icon={<Smartphone size={18} />} />
    <div className="panel-block"><DeviceStatus device={selected} /><Details entries={[
      ["Транспорт", { usb: "USB", network: "Сеть", emulator: "Эмулятор", unknown: "ADB" }[selected.transport]],
      ["Виртуальных экранов", inventory.screens.filter((screen) => screen.serial === selected.serial).length],
    ]} /></div>
    <div className="panel-block">
      <Button variant="primary" disabled={selected.state !== "ready"} onClick={() => open({ serial: selected.serial })}><Monitor size={15} /> Открыть основной экран</Button>
      {selected.state === "ready" && <Button onClick={() => setPicker(true)}><Plus size={15} /> Добавить экран</Button>}
      {selected.state === "unauthorized" && <p className="muted">Разблокируйте телефон и подтвердите запрос USB-отладки.</p>}
    </div>
  </> : <PanelHeading title="Подключение Android" icon={<Smartphone size={18} />} />}>
    <PageHeading title="Устройства" description="Подключение, просмотр и управление телефонами" actions={
      <Link className="button button-outline" href={filter === "all" ? "/wall" : "/wall?status=" + filter} target="_blank" rel="noopener"><ArrowUpRight size={15} /> Стена в новой вкладке</Link>
    } />
    {inventory.devices.length ? <>
      <div className="work-toolbar"><div className="segmented" aria-label="Вид устройств">
        <Button aria-pressed={view === "wall"} onClick={() => setView("wall")}><LayoutGrid size={15} /> Стена</Button>
        <Button aria-pressed={view === "list"} onClick={() => setView("list")}><List size={15} /> Список</Button>
      </div><SelectField label="Статус устройств" value={filter} onChange={setFilter}
        options={[{ value: "all", label: "Все статусы" }, ...Object.entries(states).map(([value, state]) => ({ value, label: state.label }))]} />
        {view === "list" && ready.length > 0 && <Button onClick={() => setPicker(true)}><Plus size={15} /> Добавить экран</Button>}
      </div>
      {!visible.length ? <Empty title="Устройства не найдены" detail="Измените фильтр состояния." /> :
        view === "wall" ? <DeviceGrid devices={visible} screens={inventory.screens} current={selected?.serial} open={open} add={ready.length ? () => setPicker(true) : undefined} />
        : <div className="table-wrap"><table><thead><tr><th scope="col">Экран</th><th scope="col">Устройство</th><th scope="col">Состояние</th></tr></thead>
          <tbody>{visible.map((device) => <Fragment key={device.serial}>
            <tr className={selected?.serial === device.serial ? "table-selected" : ""}>
              <td><button type="button" className="device-list-link" onClick={() => open({ serial: device.serial })}>
                <span className="device-list-preview android-list-preview"><Screen key={device.state} device={device} /></span><strong>Основной экран</strong>
              </button></td><td>{device.model}</td><td><DeviceStatus device={device} /></td>
            </tr>
            {inventory.screens.filter((screen) => screen.serial === device.serial && device.state === "ready").map((screen) => <tr key={screen.id}>
              <td><button type="button" className="device-list-link" onClick={() => open({ serial: screen.serial, screen: screen.id })}>
                <span className="device-list-preview android-list-preview"><AndroidVideo serial={screen.serial} screen={screen.id} label={screenLabel(screen)} /></span>
                <strong>{screenLabel(screen)}</strong>
              </button></td><td>{device.model}</td><td><Status tone={screen.awaitingConfirmation ? "amber" : "green"}>{screen.awaitingConfirmation ? "Ожидает подтверждения" : "Виртуальный экран"}</Status></td>
            </tr>)}
          </Fragment>)}</tbody></table></div>}
    </> : <InventoryEmpty loaded={inventory.loaded} error={inventory.error} />}
    {picker && <AndroidAppPicker devices={ready} screens={inventory.screens} initialSerial={selected?.serial} onOpen={addScreen} onClose={() => setPicker(false)} />}
    {control && <ScreenControl key={control.serial + "/" + (control.screen ?? "")} target={control} device={inventory.devices.find((item) => item.serial === control.serial)}
      screens={inventory.screens} onSwitch={open} onClose={() => setControl(null)} />}
  </Frame>;
}
