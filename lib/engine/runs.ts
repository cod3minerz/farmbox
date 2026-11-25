import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { doubleTapAndroid } from "./android-control";
import { engineErrors, type AndroidTarget } from "./contracts";
import { adb, androidDisplay, androidFrame, androidInputKey, claimAndroid, EngineError, listAndroid, sendAndroidInput } from "./android";
import { appTaskKey, appTasksByDisplay, launchAndroidApp, listAndroidApps } from "./android-apps";
import { getVirtualScreen, openVirtualScreen, virtualScreenFrame } from "./android-video";
import { nodeCatalog, type FlowNode, type Run, type Workflow } from "../demo";
import { nodeSettings, summarizeNode, validateDeviceGraph } from "../workflow-steps";

const folder = resolve(process.env.HASHPIX_ENGINE_DATA ?? ".engine-data");
const historyFile = resolve(folder, "runs.json");

function loadHistory(): Run[] {
  try {
    const records = JSON.parse(readFileSync(historyFile, "utf8")) as Run[];
    return records.map((run): Run => run.status === "running" ? {
      ...run, status: "error",
      steps: [...run.steps.filter((step) => step.status !== "running"), { status: "error", label: "Работа прервана", detail: "Сервер перезапустился. Запустите сценарий заново." }],
    } : run);
  } catch { return []; }
}

type ActiveExecution = { control: AbortController; graph: Workflow; target: AndroidTarget; done: Promise<void>; scheduleId?: string };
type RunOptions = { reservation?: symbol; scheduleId?: string; repeat?: boolean };
const globalRuns = globalThis as typeof globalThis & {
  hashpixRuns?: { records: Run[]; active: Map<string, ActiveExecution>; reservations: Map<string, symbol> };
};
const data = globalRuns.hashpixRuns ??= { records: loadHistory(), active: new Map(), reservations: new Map() };

function targetKey(target: AndroidTarget) {
  return target.serial + "/" + (target.screen ?? "main");
}

function persist() {
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temporary = historyFile + ".tmp";
    writeFileSync(temporary, JSON.stringify(data.records), { mode: 0o600 });
    renameSync(temporary, historyFile);
  } catch (error) {
    console.error("Hashpix could not persist its run journal", error);
  }
}

export function listDeviceRuns() {
  return data.records;
}

export function stopDeviceRun(id: string) {
  const active = data.active.get(id);
  if (!active) return false;
  active.control.abort(new Error("Запуск остановлен оператором."));
  return true;
}

export async function startDeviceRuns(graph: Workflow, targets: AndroidTarget[], options: RunOptions = {}) {
  const compiled = validateDeviceGraph(graph);
  const devices = await listAndroid();
  const prepared = await Promise.all(targets.map(async (target) => {
    const device = devices.find((item) => item.serial === target.serial);
    if (!device) throw new EngineError("DEVICE_NOT_FOUND");
    if (device.state !== "ready") throw new EngineError("DEVICE_UNAVAILABLE");
    const virtual = target.screen ? await getVirtualScreen(target.serial, target.screen) : undefined;
    if (virtual?.view.awaitingConfirmation) {
      const tasks = await appTasksByDisplay(target.serial);
      if (!tasks.get(virtual.display.id)?.has(appTaskKey(virtual.app))) throw new EngineError("CLONE_CONFIRMATION");
      virtual.view.awaitingConfirmation = false;
    }
    const screen = virtual ? virtual.view.label + (virtual.view.user === 999 ? " · копия" : virtual.view.user ? " · профиль " + virtual.view.user : "") : "Основной экран";
    return { target, device, virtual, screen, id: "LIVE-" + randomUUID() };
  }));
  const claims: (() => void)[] = [];
  try {
    for (const item of prepared) {
      const reserved = data.reservations.get(targetKey(item.target));
      if (reserved && reserved !== options.reservation) throw new EngineError("ENGINE_BUSY");
      claims.push(claimAndroid(androidInputKey(item.target.serial, item.virtual?.display), item.id));
    }
  } catch (error) {
    claims.forEach((release) => release());
    throw error;
  }
  const startedAt = Date.now();
  const runs = prepared.map(({ id, device, screen, target }): Run => ({
    id, workflow: graph.name, workflowId: graph.id, device: device.model, screen, target: targetKey(target), scheduleId: options.scheduleId, origin: "device",
    status: "running", startedAt, started: new Intl.DateTimeFormat("ru", { dateStyle: "short", timeStyle: "short" }).format(startedAt), steps: [],
  }));
  data.records = [...runs, ...data.records];
  trimHistory();
  runs.forEach((run, index) => {
    const control = new AbortController();
    const { target, virtual } = prepared[index];
    const done = execute(run, target, virtual, compiled, control, options.repeat ?? graph.repeat === true).finally(() => {
      claims[index]();
      data.active.delete(run.id);
      trimHistory();
      persist();
    });
    data.active.set(run.id, { control, graph, target, done, scheduleId: options.scheduleId });
  });
  persist();
  return runs;
}

export async function runScheduledWorkflow(graph: Workflow, targets: AndroidTarget[], scheduleId: string, preempt: boolean) {
  const keys = new Set(targets.map(targetKey));
  if ([...keys].some((key) => data.reservations.has(key))) throw new EngineError("ENGINE_BUSY");
  const reservation = Symbol(scheduleId);
  for (const key of keys) data.reservations.set(key, reservation);
  try {
    await Promise.all(targets.map(async ({ serial, screen }) => {
      if (screen) {
        await openVirtualScreen(serial, screen);
        const virtual = await getVirtualScreen(serial, screen);
        if (virtual.view.awaitingConfirmation) {
          const tasks = await appTasksByDisplay(serial);
          if (!tasks.get(virtual.display.id)?.has(appTaskKey(virtual.app))) throw new EngineError("CLONE_CONFIRMATION");
          virtual.view.awaitingConfirmation = false;
        }
      }
    }));
    const interrupted = [...data.active.values()].filter((run) => keys.has(targetKey(run.target)) && !run.control.signal.aborted);
    if (interrupted.some((run) => !preempt || run.scheduleId)) throw new EngineError("ENGINE_BUSY");
    for (const run of interrupted) run.control.abort(new Error("Прервано для запуска по расписанию."));
    await Promise.all(interrupted.map((run) => run.done));
    let scheduled: Run[];
    try {
      scheduled = await startDeviceRuns(graph, targets, { reservation, scheduleId, repeat: false });
    } catch (error) {
      await Promise.allSettled(interrupted.map((run) => startDeviceRuns(run.graph, [run.target], { reservation })));
      throw error;
    }
    await Promise.all(scheduled.map((run) => data.active.get(run.id)?.done));
    const failure = scheduled.find((run) => run.status !== "success");
    if (failure) throw new Error(failure.steps.at(-1)?.detail ?? "Запуск по расписанию прерван.");
    const restarted = await Promise.allSettled(interrupted.map((run) => startDeviceRuns(run.graph, [run.target], { reservation })));
    const failed = restarted.filter((item) => item.status === "rejected").length;
    if (failed) throw new Error(`Сценарий по расписанию выполнен. Не удалось перезапустить основной на ${failed} экранах.`);
    return { screens: scheduled.length, restarted: restarted.length };
  } finally {
    for (const key of keys) data.reservations.delete(key);
  }
}

function trimHistory() {
  const finished = data.records.filter((run) => run.status !== "running").slice(0, 100);
  const keep = new Set([...finished, ...data.records.filter((run) => run.status === "running")]);
  data.records = data.records.filter((run) => keep.has(run));
}

type RunningScreen = Awaited<ReturnType<typeof getVirtualScreen>> | undefined;

async function execute(run: Run, target: AndroidTarget, virtual: RunningScreen, graph: ReturnType<typeof validateDeviceGraph>, control: AbortController, repeat: boolean) {
  const signal = repeat ? control.signal : AbortSignal.any([control.signal, AbortSignal.timeout(3600000)]);
  try {
    do {
      for (const { node, detail, edgeId } of graph) {
        signal.throwIfAborted();
        if (run.steps.length >= 500 && repeat) {
          run.steps.splice(0, 1);
          run.stepOffset = (run.stepOffset ?? 0) + 1;
        }
        const step: Run["steps"][number] = { at: Date.now(), nodeId: node.id, edgeId, label: nodeCatalog[node.data.kind].label, detail: detail ?? summarizeNode(node.data), status: "running" };
        run.steps.push(step);
        const stop = AbortSignal.any([signal, AbortSignal.timeout(Math.min(620000, node.data.timeout + 40))]);
        if (target.screen && (await getVirtualScreen(target.serial, target.screen)) !== virtual) throw new EngineError("SCREEN_UNAVAILABLE");
        await runStep(target, virtual, run, node, step, stop);
        stop.throwIfAborted();
        step.status = "success";
        if (node.data.kind === "stop") { run.status = "success"; return; }
      }
      if (repeat) await delay(350, undefined, { signal });
    } while (repeat);
    run.status = "success";
  } catch (error) {
    run.status = control.signal.aborted ? "cancelled" : "error";
    const cause = control.signal.aborted ? control.signal.reason : error;
    const detail = cause instanceof EngineError ? engineErrors[cause.code] : cause instanceof Error ? cause.message : "Шаг не выполнен.";
    const step = run.steps.at(-1);
    if (step?.status === "running") { step.status = "error"; step.detail = detail; }
    else run.steps.push({ at: Date.now(), label: "Выполнение", detail, status: "error" });
  }
}

async function runStep(target: AndroidTarget, virtual: RunningScreen, run: Run, node: FlowNode, step: Run["steps"][number], signal: AbortSignal) {
  const { serial } = target;
  const display = virtual?.display;
  const { kind, parameter } = node.data;
  const s = nodeSettings(node.data);
  if (kind === "delay" || kind === "randomDelay") {
    const low = Math.round(s.minSeconds * 1000), high = Math.round(s.maxSeconds * 1000);
    const time = kind === "delay" ? Number(parameter) : low + Math.floor(Math.random() * (high - low + 1));
    step.detail = (time / 1000).toFixed(2) + " с";
    await delay(time, undefined, { signal }).catch(() => signal.throwIfAborted());
  } else if (kind === "home" || kind === "back") {
    await sendAndroidInput(serial, { kind: "key", key: kind }, run.id, display);
  } else if (kind === "open" && virtual) {
    const app = (await listAndroidApps(serial)).find((entry) => entry.user === virtual.app.user && entry.package === parameter);
    if (!app) throw new EngineError("APP_UNAVAILABLE");
    if (app.package !== virtual.app.package) throw new Error("На виртуальном экране можно открыть закреплённое за ним приложение. Измените пакет в ноде или выберите другой экран.");
    await launchAndroidApp(serial, app, virtual.display.id);
  } else if (kind === "open") {
    await adb(["-s", serial, "shell", "monkey", "-p", parameter, "-c", "android.intent.category.LAUNCHER", "1"]).then((output) => {
      if (!output.toString().includes("Events injected: 1")) throw new Error("Android не открыл приложение. Проверьте пакет.");
    });
  } else if (kind === "screenshot") {
    const bytes = target.screen ? await virtualScreenFrame(serial, target.screen, signal) : (await androidFrame(serial, true)).bytes;
    const relative = run.id + "-" + ((run.stepOffset ?? 0) + run.steps.length) + ".png";
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(resolve(folder, relative), bytes, { mode: 0o600 });
    step.detail = relative;
  } else if (kind === "doubleTap") {
    await doubleTapAndroid(serial, s.x / 100, s.y / 100, s.gap, signal, display);
  } else if (kind === "tap" || kind === "swipe") {
    const dimensions = display ?? await androidDisplay(serial);
    signal.throwIfAborted();
    const point = { x: s.x / 100, y: s.y / 100, ...dimensions };
    if (kind === "swipe") {
      await sendAndroidInput(serial, { ...point, kind: "swipe", toX: s.toX / 100, toY: s.toY / 100, duration: Math.round(s.duration) }, run.id, display);
    } else {
      await sendAndroidInput(serial, { ...point, kind: "tap" }, run.id, display);
    }
  }
}
