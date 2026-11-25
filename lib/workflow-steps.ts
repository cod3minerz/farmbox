import type { Edge } from "@xyflow/react";
import { nodeCatalog, type FlowNode, type NodeKind, type Workflow } from "./demo";

export const realNodes = new Set<NodeKind>(["start", "open", "tap", "doubleTap", "swipe", "home", "back", "screenshot", "delay", "randomDelay", "condition", "loop", "stop", "log"]);
export const executionDefaults = { x: 50, y: 50, toX: 50, toY: 25, duration: 360, gap: 120, minSeconds: 5, maxSeconds: 15, count: 3 };

export function nodeSettings(node: FlowNode["data"]) {
  const legacy = node.kind === "swipe" ? ({ "Вниз": { y: 25, toY: 75 }, "Влево": { x: 75, y: 50, toX: 25, toY: 50 }, "Вправо": { x: 25, y: 50, toX: 75, toY: 50 } }[node.parameter] ?? { y: 75 }) : {};
  return { ...executionDefaults, ...legacy, ...node.settings };
}

export function summarizeNode(node: FlowNode["data"]): string {
  const s = nodeSettings(node);
  switch (node.kind) {
    case "tap": case "doubleTap": return `${s.x}% · ${s.y}%`;
    case "swipe": return `${s.x},${s.y} → ${s.toX},${s.toY}% · ${s.duration} мс`;
    case "randomDelay": return `${s.minSeconds}–${s.maxSeconds} с`;
    case "loop": return `${s.count} повторов`;
    default: return node.parameter ? node.parameter + (node.kind === "delay" ? " мс" : "") : nodeCatalog[node.kind].group;
  }
}

export function validateDeviceGraph(workflow: Workflow) {
  if (!workflow || typeof workflow.name !== "string" || !workflow.name.trim() || workflow.name.length > 100 ||
      !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || workflow.nodes.length > 80 || workflow.edges.length > 160) {
    throw new Error("Некорректный сценарий.");
  }
  const nodes = new Map<string, FlowNode>();
  let triggers = 0;
  for (const node of workflow.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || node.id.length > 100 || nodes.has(node.id) || !node.data || !realNodes.has(node.data.kind)) {
      throw new Error("В графе есть нода без поддерживаемой операции Android.");
    }
    const { kind, parameter, timeout } = node.data;
    if (typeof parameter !== "string" || parameter.length > 500 || !inBounds(timeout, 1, 610000)) throw new Error("Проверьте настройки ноды " + nodeCatalog[kind].label + ".");
    const s = nodeSettings(node.data);
    if (kind === "start") triggers++;
    if (["tap", "doubleTap", "swipe"].includes(kind) && ![s.x, s.y, s.toX, s.toY].every((n) => inBounds(n, 0, 100))) throw new Error("Координаты жеста должны быть от 0 до 100%.");
    if (kind === "swipe" && !inBounds(s.duration, 100, 2000)) throw new Error("Длительность свайпа должна быть от 100 до 2000 мс.");
    if (kind === "doubleTap" && !inBounds(s.gap, 25, 450)) throw new Error("Интервал двойного тапа должен быть от 25 до 450 мс.");
    if (kind === "delay" && (!parameter.trim() || !inBounds(Number(parameter), 1, Math.min(600000, timeout)))) throw new Error("Укажите паузу в миллисекундах, меньше тайм-аута шага.");
    if (kind === "randomDelay" && (!inBounds(s.minSeconds, 0.01, 600) || !inBounds(s.maxSeconds, s.minSeconds, Math.min(600, timeout / 1000)))) throw new Error("Проверьте диапазон паузы и тайм-аут.");
    if (kind === "loop" && (!inBounds(s.count, 1, 100) || !Number.isInteger(s.count))) throw new Error("Укажите от 1 до 100 проходов.");
    if (kind === "condition" && !/^(true|false)$/i.test(parameter.trim())) throw new Error("Для условия укажите true или false.");
    if (kind === "open" && !/^([A-Za-z][A-Za-z0-9_]*\.)+[A-Za-z][A-Za-z0-9_]*$/.test(parameter)) throw new Error("Укажите идентификатор пакета Android, например com.android.settings.");
    nodes.set(node.id, node);
  }
  if (triggers !== 1) throw new Error("Нужна одна нода «Ручной запуск».");
  const links = new Map<string, Map<string, Edge>>();
  for (const edge of workflow.edges) {
    if (!edge || !nodes.has(edge.source) || !nodes.has(edge.target) || nodes.get(edge.target)?.data.kind === "start") throw new Error("В графе есть некорректное соединение.");
    const kind = nodes.get(edge.source)?.data.kind;
    const name = edge.sourceHandle ?? "";
    const allowed = kind === "loop" ? ["body", "done"] : kind === "condition" ? ["yes", "no"] : kind === "stop" ? [] : [""];
    const ports = links.get(edge.source) ?? new Map<string, Edge>();
    if (!allowed.includes(name) || ports.has(name)) throw new Error("У каждого выхода может быть одно соединение.");
    ports.set(name, edge);
    links.set(edge.source, ports);
  }
  for (const node of nodes.values()) {
    if (node.data.kind === "loop" && !links.get(node.id)?.has("body")) throw new Error("Подключите выход «Тело» у ноды «Повтор».");
  }
  const start = workflow.nodes.find((node) => node.data.kind === "start")!;
  const pending = [start.id];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of links.get(id)?.values() ?? []) pending.push(edge.target);
  }
  if (visited.size !== nodes.size) throw new Error("Соедините все ноды с точкой запуска.");
  return buildPath(nodes, links, start.id);
}

function buildPath(nodes: Map<string, FlowNode>, links: Map<string, Map<string, Edge>>, start: string) {
  const iterations = new Map<string, number>();
  const visited = new Set<string>();
  const steps: { node: FlowNode; detail?: string; edgeId?: string }[] = [];
  let edgeId: string | undefined;
  let id: string | undefined = start;
  while (id) {
    const state = id + JSON.stringify([...iterations].sort());
    if (visited.has(state) || visited.size >= 2000) throw new Error("Обнаружен переход без продвижения цикла или достигнут предел шагов.");
    visited.add(state);
    const node = nodes.get(id)!;
    let outgoing = "";
    let detail: string | undefined;
    if (node.data.kind === "loop") {
      const settings = nodeSettings(node.data);
      const count = (iterations.get(id) ?? 0) + 1;
      if (count <= settings.count) {
        iterations.set(id, count);
        outgoing = "body";
        detail = `${count} из ${settings.count}`;
      } else {
        iterations.delete(id);
        outgoing = "done";
        detail = "Все проходы выполнены";
      }
    } else if (node.data.kind === "condition") {
      outgoing = node.data.parameter.trim().toLowerCase() === "true" ? "yes" : "no";
      if (!links.get(id)?.has(outgoing)) throw new Error("Нет перехода для выбранной ветки условия.");
    }
    steps.push({ node, detail, edgeId });
    if (node.data.kind === "stop") return steps;
    const next: Edge | undefined = links.get(id)?.get(outgoing);
    edgeId = next?.id;
    id = next?.target;
  }
  if (iterations.size) throw new Error("Тело цикла закончилось без перехода обратно в ноду «Повтор».");
  return steps;
}

function inBounds(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
