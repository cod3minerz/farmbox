import type { Edge } from "@xyflow/react";
import { readLogTone, workflowLogic, type WorkflowValue } from "./workflow-logic";
import { nodeCatalog, type FlowNode, type NodeKind, type Workflow } from "./demo";

export const realNodes = new Set<NodeKind>(["start", "open", "tap", "doubleTap", "swipe", "home", "wake", "back", "screenshot", "delay", "randomDelay", "condition", "setVariable", "randomNumber", "adjustVariable", "loop", "call", "stop", "log"]);
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
    case "setVariable": case "adjustVariable": return node.logic?.variable ? node.logic.variable + " · " + node.parameter : "Имя переменной";
    case "randomNumber": return node.logic?.variable ? node.logic.variable + (node.logic.randomMode === "percent" ? " · 0–99,99%" : " · целое число") : "Имя переменной";
    case "condition": return node.logic?.operator ? node.logic.variable || "Выберите переменную" : node.parameter;
    case "loop": return `${s.count} повторов`;
    default: return node.parameter ? node.parameter + (node.kind === "delay" ? " мс" : "") : nodeCatalog[node.kind].group;
  }
}

function validateGraph(workflow: Workflow, simulation: boolean) {
  if (!workflow || typeof workflow.name !== "string" || !workflow.name.trim() || workflow.name.length > 100 ||
      !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges) || workflow.nodes.length > 80 || workflow.edges.length > 160) {
    throw new Error("Некорректный сценарий.");
  }
  const nodes = new Map<string, FlowNode>();
  let triggers = 0;
  for (const node of workflow.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || node.id.length > 100 || nodes.has(node.id) || !node.data || !(simulation ? Object.hasOwn(nodeCatalog, node.data.kind) : realNodes.has(node.data.kind))) {
      throw new Error("В графе есть нода без поддерживаемой операции Android.");
    }
    const { kind, parameter, timeout } = node.data;
    if (typeof parameter !== "string" || parameter.length > (kind === "log" ? 4000 : 500) || !inBounds(timeout, 1, 610000)) throw new Error("Проверьте настройки ноды " + nodeCatalog[kind].label + ".");
    const s = nodeSettings(node.data);
    if (kind === "start" || (simulation && kind === "schedule")) triggers++;
    if (kind === "call" && !parameter) throw new Error("Выберите сценарий для вызова.");
    if (["tap", "doubleTap", "swipe"].includes(kind) && ![s.x, s.y, s.toX, s.toY].every((n) => inBounds(n, 0, 100))) throw new Error("Координаты жеста должны быть от 0 до 100%.");
    if (kind === "swipe" && !inBounds(s.duration, 100, 2000)) throw new Error("Длительность свайпа должна быть от 100 до 2000 мс.");
    if (kind === "doubleTap" && !inBounds(s.gap, 25, 450)) throw new Error("Интервал двойного тапа должен быть от 25 до 450 мс.");
    if (kind === "delay" && (!parameter.trim() || !inBounds(Number(parameter), 1, Math.min(600000, timeout)))) throw new Error("Укажите паузу в миллисекундах, меньше тайм-аута шага.");
    if (kind === "randomDelay" && (!inBounds(s.minSeconds, 0.01, 600) || !inBounds(s.maxSeconds, s.minSeconds, Math.min(600, timeout / 1000)))) throw new Error("Проверьте диапазон паузы и тайм-аут.");
    if (kind === "loop" && (!inBounds(s.count, 1, 100) || !Number.isInteger(s.count))) throw new Error("Укажите от 1 до 100 проходов.");
    workflowLogic(node.data);
    readLogTone(node.data.logTone);
    if (!simulation && kind === "open" && !/^([A-Za-z][A-Za-z0-9_]*\.)+[A-Za-z][A-Za-z0-9_]*$/.test(parameter)) throw new Error("Укажите идентификатор пакета Android, например com.android.settings.");
    nodes.set(node.id, node);
  }
  if (triggers !== 1) throw new Error("Нужна одна нода «Ручной запуск».");
  const links = new Map<string, Map<string, Edge>>();
  for (const edge of workflow.edges) {
    if (!edge || !nodes.has(edge.source) || !nodes.has(edge.target) || nodeCatalog[nodes.get(edge.target)!.data.kind].group === "Триггер") throw new Error("В графе есть некорректное соединение.");
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
    const branch = node.data.kind === "condition" ? workflowLogic(node.data).branch : undefined;
    if (branch && !links.get(node.id)?.has(branch)) throw new Error("Нет перехода для выбранной ветки условия.");
  }
  const start = workflow.nodes.find((node) => node.data.kind === "start" || (simulation && node.data.kind === "schedule"))!;
  const pending = [start.id];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of links.get(id)?.values() ?? []) pending.push(edge.target);
  }
  if (visited.size !== nodes.size) throw new Error("Соедините все ноды с точкой запуска.");
  const checking = new Set<string>();
  const checked = new Set<string>();
  function checkUnboundedCycle(id: string) {
    if (checking.has(id)) throw new Error("Для повторения подключите ноду «Повтор» или условие с переменной.");
    if (checked.has(id)) return;
    checking.add(id);
    const node = nodes.get(id)!;
    const branch = node.data.kind === "condition" ? workflowLogic(node.data).branch : "";
    const next = branch === undefined || node.data.kind === "loop" ? undefined : links.get(id)?.get(branch);
    if (next) checkUnboundedCycle(next.target);
    checking.delete(id);
    checked.add(id);
  }
  for (const id of nodes.keys()) checkUnboundedCycle(id);
  return { nodes, links, start: start.id };
}

type CompiledStep = {
  node: FlowNode;
  canvasNodeId: string;
  edgeId?: string;
  detail?: string;
  subflow?: string;
  stopRun: boolean;
};

export function validateDeviceGraph(workflow: Workflow, simulation = false) {
  const root = validateGraph(workflow, simulation);
  const definitions = new Map<string, Workflow>();
  const dependencies = workflow.dependencies ?? [];
  if (!Array.isArray(dependencies) || dependencies.length > 32) throw new Error("Сценарий может включать до 32 связанных сценариев.");
  for (const dependency of dependencies) {
    if (!dependency || typeof dependency.id !== "string" || !dependency.id || dependency.id.length > 100 ||
      dependency.id === workflow.id || definitions.has(dependency.id)) throw new Error("Некорректная зависимость сценария.");
    definitions.set(dependency.id, dependency);
  }
  const graphs = new Map<string, ReturnType<typeof validateGraph>>([[workflow.id, root]]);
  const stack = new Set<string>();
  const depths = new Map<string, number>();

  function validateCalls(definition: Workflow): number {
    if (stack.has(definition.id)) throw new Error("Рекурсивный вызов сценария: «" + definition.name + "».");
    const cached = depths.get(definition.id);
    if (cached !== undefined) return cached;
    if (stack.size >= 8) throw new Error("Превышена глубина вложенных сценариев (8).");
    const graph = graphs.get(definition.id) ?? validateGraph(definition, simulation);
    graphs.set(definition.id, graph);
    stack.add(definition.id);
    let depth = 1;
    for (const node of graph.nodes.values()) {
      if (node.data.kind !== "call") continue;
      if (node.data.parameter === workflow.id) throw new Error("Рекурсивный вызов сценария: «" + workflow.name + "».");
      const called = definitions.get(node.data.parameter);
      if (!called) throw new Error("Вложенный сценарий отсутствует. Выберите его снова в ноде вызова.");
      depth = Math.max(depth, 1 + validateCalls(called));
    }
    stack.delete(definition.id);
    depths.set(definition.id, depth);
    return depth;
  }
  if (validateCalls(workflow) > 8) throw new Error("Превышена глубина вложенных сценариев (8).");

  return function* steps(variables = new Map<string, WorkflowValue>()): Generator<CompiledStep> {
    let count = 0;
    let variableRevision = 0;

    function* invoke(definition: Workflow, canvasNodeId?: string): Generator<CompiledStep> {
      const { nodes, links, start } = graphs.get(definition.id)!;
      const iterations = new Map<string, number>();
      const visited = new Set<string>();
      let edgeId: string | undefined;
      let id: string | undefined = start;

      while (id) {
        const node: FlowNode = nodes.get(id)!;
        const state = JSON.stringify([id, [...iterations], variableRevision]);
        if (visited.has(state) || count >= 2000) throw new Error("Обнаружен переход без продвижения цикла или достигнут предел шагов.");
        visited.add(state);
        count++;
        const variable = node.data.logic?.variable;
        const previous = variable ? variables.get(variable) : undefined;
        const logic = workflowLogic(node.data, variables);
        if (variable && previous !== variables.get(variable)) variableRevision++;
        let outgoing = logic.branch ?? "";
        let detail = logic.detail;
        if (node.data.kind === "loop") {
          const settings = nodeSettings(node.data);
          const iteration = (iterations.get(id) ?? 0) + 1;
          if (iteration <= settings.count) {
            iterations.set(id, iteration);
            outgoing = "body";
            detail = `${iteration} из ${settings.count}`;
          } else {
            iterations.delete(id);
            outgoing = "done";
            detail = "Все проходы выполнены";
          }
        }
        const called = node.data.kind === "call" ? definitions.get(node.data.parameter) : undefined;
        yield {
          node, canvasNodeId: canvasNodeId ?? node.id, edgeId: canvasNodeId ? undefined : edgeId,
          detail: called?.name ?? detail, subflow: canvasNodeId ? definition.name : undefined,
          stopRun: node.data.kind === "stop" && canvasNodeId === undefined,
        };
        if (node.data.kind === "stop") return;
        if (called) yield* invoke(called, canvasNodeId ?? node.id);
        const next: Edge | undefined = links.get(id)?.get(outgoing);
        edgeId = next?.id;
        id = next?.target;
      }
      if (iterations.size) throw new Error("Тело цикла закончилось без перехода обратно в ноду «Повтор».");
    }

    yield* invoke(workflow);
  };
}

export function linkWorkflowDependencies(workflow: Workflow, available: readonly Workflow[]) {
  const byId = new Map(available.map((entry) => [entry.id, entry]));
  const stack = new Set([workflow.id]);
  const dependencies = new Map<string, Workflow>();

  function collect(current: Workflow) {
    for (const node of current.nodes) {
      if (node.data.kind !== "call") continue;
      const id = node.data.parameter;
      if (stack.has(id)) throw new Error("Сценарии ссылаются друг на друга. Удалите рекурсивный вызов.");
      if (dependencies.has(id)) continue;
      const next = byId.get(id);
      if (!next) throw new Error("Выберите доступный сценарий в ноде «Вызвать сценарий».");
      if (stack.size >= 8 || dependencies.size >= 32) throw new Error("Превышен предел вложенности или числа связанных сценариев.");
      const snapshot = { id: next.id, version: next.version, name: next.name, nodes: next.nodes, edges: next.edges };
      dependencies.set(id, snapshot);
      stack.add(id);
      collect(next);
      stack.delete(id);
    }
  }
  collect(workflow);
  return { ...workflow, dependencies: dependencies.size ? [...dependencies.values()] : undefined };
}

function inBounds(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
