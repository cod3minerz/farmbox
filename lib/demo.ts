import type { LogTone, NodeLogic } from "./workflow-logic";
import type { Edge, Node } from "@xyflow/react";

export type DeviceState = "ready" | "busy" | "offline";
export type Phone = {
  id: string;
  name: string;
  os: string;
  host: string;
  group: string;
  state: DeviceState;
  battery: number;
  screen: "home" | "clips" | "gallery" | "studio" | "settings";
};

export const phones: Phone[] = [
  { id: "USB-01", name: "Redmi Note 12", os: "Android 14", host: "Studio PC", group: "Стенд A", state: "ready", battery: 78, screen: "home" },
  { id: "USB-02", name: "Google Pixel 7", os: "Android 15", host: "Studio PC", group: "Стенд A", state: "busy", battery: 64, screen: "clips" },
  { id: "USB-03", name: "Galaxy A54", os: "Android 14", host: "Studio PC", group: "Стенд A", state: "ready", battery: 91, screen: "gallery" },
  { id: "USB-04", name: "iPhone 14", os: "iOS 18", host: "MacBook", group: "Стенд B", state: "ready", battery: 83, screen: "studio" },
  { id: "USB-05", name: "Redmi 10", os: "Android 12", host: "Studio PC", group: "Стенд B", state: "ready", battery: 47, screen: "settings" },
  { id: "USB-06", name: "iPhone 13", os: "iOS 18", host: "MacBook", group: "Стенд B", state: "offline", battery: 0, screen: "home" },
];

export const nodeCatalog = {
  start: { label: "Ручной запуск", group: "Триггер", tone: "green", parameter: "", description: "Точка входа в сценарий." },
  schedule: { label: "Расписание", group: "Триггер", tone: "green", parameter: "09:00", description: "Время запуска по расписанию." },
  open: { label: "Открыть приложение", group: "Устройство", tone: "blue", parameter: "Камера", description: "Приложение на выбранном телефоне." },
  tap: { label: "Тап", group: "Устройство", tone: "blue", parameter: "540, 960", description: "Координаты на экране устройства." },
  doubleTap: { label: "Двойной тап", group: "Устройство", tone: "blue", parameter: "", description: "Два касания в одной точке с настраиваемым интервалом." },
  swipe: { label: "Свайп", group: "Устройство", tone: "blue", parameter: "Вверх", description: "Направление жеста." },
  input: { label: "Ввод текста", group: "Устройство", tone: "blue", parameter: "Пример", description: "Текст для активного поля." },
  screenshot: { label: "Скриншот", group: "Устройство", tone: "blue", parameter: "screen.png", description: "Название артефакта." },
  delay: { label: "Задержка", group: "Время", tone: "amber", parameter: "1200", description: "Длительность ожидания в миллисекундах." },
  randomDelay: { label: "Случайная пауза", group: "Время", tone: "amber", parameter: "", description: "Каждый проход выбирает новое время в заданном диапазоне." },
  call: { label: "Вызвать сценарий", group: "Логика", tone: "purple", parameter: "", description: "Выполняет сохранённый сценарий на текущем экране и возвращается к следующей ноде." },
  stop: { label: "Остановить сценарий", group: "Логика", tone: "red", parameter: "", description: "Завершает текущий запуск, включая повтор с начала." },
  loop: { label: "Повтор", group: "Логика", tone: "purple", parameter: "", description: "Соедините выход «Тело» с первым шагом цикла, а последний шаг верните в эту ноду." },
  home: { label: "Домой", group: "Устройство", tone: "blue", parameter: "", description: "Возврат на главный экран." },
  wake: { label: "Включить экран", group: "Устройство", tone: "blue", parameter: "", description: "Будит основной экран телефона. Если телефон заблокирован, система сохраняет блокировку." },
  back: { label: "Назад", group: "Устройство", tone: "blue", parameter: "", description: "Системная кнопка «Назад»." },
  wait: { label: "Дождаться элемента", group: "Время", tone: "amber", parameter: "Кнопка записи", description: "Имя или селектор элемента." },
  setVariable: { label: "Задать переменную", group: "Логика", tone: "purple", parameter: "0", description: "Записывает число, текст или логическое значение." },
  randomNumber: { label: "Случайное число", group: "Логика", tone: "purple", parameter: "", description: "Генерирует целое число или процент при каждом прохождении ноды." },
  adjustVariable: { label: "Изменить число", group: "Логика", tone: "purple", parameter: "1", description: "Прибавляет число к существующей переменной. Отрицательное число уменьшает её." },
  condition: { label: "Условие", group: "Логика", tone: "purple", parameter: "true", description: "Выбирает ветку по постоянному значению или по результату сравнения переменной." },
  request: { label: "HTTP-запрос", group: "Интеграции", tone: "purple", parameter: "GET /clips", description: "Метод и адрес. Симуляция использует модельный ответ." },
  narezai: { label: "Ролик из Narezai", group: "Контент", tone: "purple", parameter: "Готовые клипы", description: "Источник подготовленного ролика." },
  validate: { label: "Проверить видео", group: "Контент", tone: "purple", parameter: "9:16 · MP4", description: "Ожидаемый формат файла." },
  publish: { label: "В очередь публикаций", group: "Контент", tone: "green", parameter: "YouTube Shorts", description: "Канал для подготовленной публикации." },
  log: { label: "Запись в журнал", group: "Диагностика", tone: "gray", parameter: "Сценарий завершён", description: "Сообщение для хронологии запуска." },
} as const;

export type NodeKind = keyof typeof nodeCatalog;
export type NodeSettings = Partial<Record<"x" | "y" | "toX" | "toY" | "duration" | "gap" | "minSeconds" | "maxSeconds" | "count", number>>;
export type FlowNode = Node<{ kind: NodeKind; parameter: string; timeout: number; settings?: NodeSettings; logic?: NodeLogic; logTone?: LogTone }, "action">;
export type Workflow = { dependencies?: Workflow[]; targets?: string[]; repeat?: boolean; id: string; name: string; version: number; nodes: FlowNode[]; edges: Edge[] };
export type Run = {
  id: string; workflow: string; device: string; started: string;
  status: "success" | "error" | "running" | "cancelled";
  origin?: "device" | "simulation";
  workflowId?: string;
  target?: string;
  screen?: string;
  startedAt?: number;
  scheduleId?: string;
  stepOffset?: number;
  steps: { at?: number; nodeId?: string; edgeId?: string; subflow?: string; logTone?: LogTone; label: string; detail: string; status: "success" | "error" | "running" }[];
};
export type Clip = { id: string; title: string; source: string; duration: string; size: string; status: "review" | "approved" };
export type Publication = {
  id: string; clip: string; channel: string; account: string; caption: string; scheduled: string;
  status: "draft" | "scheduled" | "published" | "cancelled";
};
export type Settings = { profile: "balanced" | "sharp" | "economy"; parallel: number; timezone: string };
export type DemoState = {
  selectedWorkflowId?: string;
  workflows: Workflow[]; runs: Run[]; clips: Clip[]; publications: Publication[];
  settings: Settings;
};

export function makeNode(kind: NodeKind, id: string, x: number, y: number): FlowNode {
  return { id, type: "action", position: { x, y }, data: { kind, parameter: nodeCatalog[kind].parameter, timeout: kind === "randomDelay" ? 20000 : 10000 } };
}

function connect(source: string, target: string, label?: string, sourceHandle?: string): Edge {
  return { id: source + "-" + target, source, target, sourceHandle, label, type: "smoothstep" };
}

export function gestureTemplate(): Workflow {
  return {
    id: createId("FLOW"), name: "Свайп, пауза и двойной тап", version: 1,
    nodes: [makeNode("start", "start", 0, 0), makeNode("loop", "loop", 256, 0), makeNode("swipe", "swipe", 512, 0),
      makeNode("randomDelay", "wait", 768, 0), makeNode("doubleTap", "double", 768, 192), makeNode("log", "end", 256, 240)],
    edges: [connect("start", "loop"), connect("loop", "swipe", "Тело", "body"), connect("swipe", "wait"),
      connect("wait", "double"), connect("double", "loop"), connect("loop", "end", "Выход", "done")],
  };
}

export const initial: DemoState = {
  workflows: [
    {
      id: "check-phone", name: "Проверка телефона", version: 1,
      nodes: [makeNode("start", "start", 0, 0), makeNode("open", "open", 256, 0), makeNode("delay", "delay", 512, 0), makeNode("screenshot", "shot", 768, 0), makeNode("log", "log", 1024, 0)],
      edges: [connect("start", "open"), connect("open", "delay"), connect("delay", "shot"), connect("shot", "log")],
    },
    {
      id: "prepare-clip", name: "Подготовка ролика", version: 1,
      nodes: [makeNode("start", "start", 0, 0), makeNode("narezai", "fetch", 256, 0), makeNode("validate", "validate", 512, 0), makeNode("condition", "check", 768, 0), makeNode("publish", "publish", 1024, 0), makeNode("log", "error", 1024, 176)],
      edges: [connect("start", "fetch"), connect("fetch", "validate"), connect("validate", "check"), connect("check", "publish", "Да", "yes"), connect("check", "error", "Нет", "no")],
    },
  ],
  runs: [
    { id: "RUN-028", workflow: "Подготовка ролика", device: "Без устройства", started: "Сегодня, 10:18", status: "success", steps: [{ label: "Проверить видео", detail: "MP4 · 1080 × 1920", status: "success" }, { label: "В очередь публикаций", detail: "Черновик подготовлен", status: "success" }] },
    { id: "RUN-027", workflow: "Проверка телефона", device: "Google Pixel 7", started: "Сегодня, 10:12", status: "running", steps: [{ label: "Открыть приложение", detail: "Камера", status: "success" }, { label: "Дождаться элемента", detail: "Ожидание кнопки записи", status: "running" }] },
    { id: "RUN-026", workflow: "Проверка телефона", device: "iPhone 13", started: "Сегодня, 09:46", status: "error", steps: [{ label: "Скриншот", detail: "Устройство потеряло соединение по USB", status: "error" }] },
  ],
  clips: [
    { id: "CLP-014", title: "Выпуск 14 · Вертикальный монтаж", source: "Narezai · образец", duration: "00:38", size: "34,8 МБ", status: "approved" },
    { id: "CLP-013", title: "За кадром · Фрагмент 03", source: "Локальная папка · образец", duration: "00:24", size: "18,2 МБ", status: "review" },
    { id: "CLP-012", title: "Обзор недели · Тизер", source: "Narezai · образец", duration: "00:51", size: "42,5 МБ", status: "approved" },
  ],
  publications: [
    { id: "PUB-019", clip: "CLP-014", channel: "YouTube Shorts", account: "@hashpix", caption: "Новый выпуск", scheduled: "2026-11-26T18:00", status: "scheduled" },
    { id: "PUB-018", clip: "CLP-014", channel: "Instagram Reels", account: "@hashpix", caption: "За кадром выпуска", scheduled: "", status: "draft" },
    { id: "PUB-017", clip: "CLP-012", channel: "TikTok", account: "@hashpix", caption: "Обзор недели", scheduled: "", status: "published" },
  ],
  settings: { profile: "balanced", parallel: 2, timezone: "Europe/Moscow" },
};

export const deviceLabels = { ready: "Готово", busy: "Занято", offline: "Нет связи" } as const;
export const publishLabels = { draft: "Черновик", scheduled: "В очереди", published: "Подтверждено", cancelled: "Отменено" } as const;
export const runLabels = { success: "Завершён", error: "Ошибка", running: "В работе", cancelled: "Остановлен" } as const;

export function isSimulationRun(run: Run) {
  // Older local simulations used createId("RUN"); the seeded examples have short numeric IDs.
  return run.origin === "simulation" || (run.origin === undefined && /^RUN-[0-9A-F]{8}$/.test(run.id));
}

export function createId(prefix: string) {
  const value = crypto.getRandomValues(new Uint32Array(1))[0];
  return prefix + "-" + value.toString(16).toUpperCase().padStart(8, "0");
}

export function simulate(workflow: Workflow, device?: Phone): Run {
  const run: Run = {
    id: createId("RUN"), workflow: workflow.name, workflowId: workflow.id, device: device?.name ?? "Без устройства",
    started: new Intl.DateTimeFormat("ru", { dateStyle: "short", timeStyle: "short" }).format(new Date()),
    status: "success", steps: [],
  };
  const start = workflow.nodes.filter((node) => node.data.kind === "start" || node.data.kind === "schedule");
  if (start.length !== 1) {
    return { ...run, status: "error", steps: [{ label: "Проверка графа", detail: "Нужна ровно одна нода запуска.", status: "error" }] };
  }
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  const pending = [start[0].id];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...workflow.edges.filter((edge) => edge.source === id && byId.has(edge.target)).map((edge) => edge.target));
  }
  if (reachable.size !== workflow.nodes.length) {
    return { ...run, status: "error", steps: [{ label: "Проверка графа", detail: "Соедините все ноды с точкой запуска.", status: "error" }] };
  }
  const visited = new Set<string>();
  let cursor: FlowNode | undefined = start[0];
  let edgeId: string | undefined;
  while (cursor) {
    const id: string = cursor.id;
    const kind: NodeKind = cursor.data.kind;
    const parameter: string = cursor.data.parameter;
    const timeout = cursor.data.timeout;
    const config = nodeCatalog[kind];
    const failure = visited.has(id) ? "Обнаружен цикл без ограничения." :
      !Number.isFinite(timeout) || timeout < 1 ? "Укажите положительный тайм-аут." :
      config.group === "Устройство" && device?.state !== "ready" ? "Выберите доступный телефон для этого шага." :
      kind === "delay" && (!parameter.trim() || !Number.isFinite(Number(parameter)) || Number(parameter) < 0) ? "Укажите задержку в миллисекундах." :
      kind === "delay" && Number(parameter) > timeout ? "Задержка превышает тайм-аут." :
      kind === "condition" && !/^(true|false)$/i.test(parameter.trim()) ? "Укажите true или false для примера." : null;
    run.steps.push({ nodeId: id, edgeId, logTone: cursor.data.logTone, label: config.label, detail: failure ?? (parameter || "Шаг выполнен в симуляции"), status: failure ? "error" : "success" });
    if (failure) return { ...run, status: "error" };
    visited.add(id);
    const branch: "yes" | "no" | null = kind === "condition" ? (parameter.trim().toLowerCase() === "true" ? "yes" : "no") : null;
    const next: Edge | undefined = workflow.edges.find((edge) => edge.source === id && (!branch || edge.sourceHandle === branch));
    if (branch && !next) return { ...run, status: "error", steps: [...run.steps, { label: "Переход", detail: "У выбранной ветки нет следующего шага.", status: "error" }] };
    edgeId = next?.id;
    cursor = next ? byId.get(next.target) : undefined;
  }
  return run;
}
