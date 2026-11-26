import { nodeCatalog, type FlowNode, type NodeKind, type NodeSettings, type Workflow } from "./demo";
import { readLogTone, readNodeLogic } from "./workflow-logic";
import { executionDefaults, linkWorkflowDependencies } from "./workflow-steps";

export const workflowFileMaxBytes = 256 * 1024;
const format = "hashpix.workflow";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const settingKeys = Object.keys(executionDefaults) as (keyof NodeSettings)[];

type PortableWorkflow = Pick<Workflow, "name" | "repeat" | "nodes" | "edges">;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная структура сценария.");
  return value as Record<string, unknown>;
}

function graphId(value: unknown) {
  if (typeof value !== "string" || !idPattern.test(value)) throw new Error("Некорректный идентификатор ноды или перехода.");
  return value;
}

function finiteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("В сценарии есть некорректное число.");
  return value;
}

function positionValue(value: unknown) {
  const coordinate = finiteNumber(value);
  if (Math.abs(coordinate) > 1_000_000) throw new Error("Нода находится за пределами холста.");
  return coordinate;
}

function nodeSettings(value: unknown): NodeSettings | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  const settings: NodeSettings = {};
  for (const key of settingKeys) {
    if (Object.hasOwn(raw, key)) settings[key] = finiteNumber(raw[key]);
  }
  return settings;
}

function handle(value: unknown): string | null | undefined {
  return value == null ? value : graphId(value);
}

export function portableWorkflow(value: unknown): PortableWorkflow {
  const { name, repeat, nodes, edges } = record(value);
  if (typeof name !== "string" || !name.trim() || name.length > 100 || (repeat !== undefined && typeof repeat !== "boolean")) {
    throw new Error("Проверьте название и настройки сценария.");
  }
  if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.length > 256 || edges.length > 512) {
    throw new Error("Некорректный граф сценария. Файл может содержать до 256 нод и 512 переходов.");
  }
  const nodeIds = new Set<string>();
  const cleanNodes = nodes.map((value): FlowNode => {
    const { id: rawId, position: rawPosition, data } = record(value);
    const id = graphId(rawId);
    if (nodeIds.has(id)) throw new Error("В сценарии есть ноды с одинаковыми идентификаторами.");
    nodeIds.add(id);
    const { x, y } = record(rawPosition);
    const { kind, parameter, timeout, settings, logic, logTone } = record(data);
    if (typeof kind !== "string" || !Object.hasOwn(nodeCatalog, kind)) throw new Error("Сценарий содержит неизвестный тип ноды.");
    if (typeof parameter !== "string") throw new Error("В сценарии есть некорректный параметр ноды.");
    return {
      id, type: "action", position: { x: positionValue(x), y: positionValue(y) },
      data: { kind: kind as NodeKind, parameter, timeout: finiteNumber(timeout), settings: nodeSettings(settings), logic: readNodeLogic(logic), logTone: readLogTone(logTone) },
    };
  });
  const edgeIds = new Set<string>();
  const cleanEdges = edges.map((value): Workflow["edges"][number] => {
    const { id: rawId, source: rawSource, target: rawTarget, sourceHandle, targetHandle, label } = record(value);
    const id = graphId(rawId), source = graphId(rawSource), target = graphId(rawTarget);
    if (edgeIds.has(id) || !nodeIds.has(source) || !nodeIds.has(target)) {
      throw new Error("Сценарий содержит дубликат перехода или ссылку на отсутствующую ноду.");
    }
    edgeIds.add(id);
    if (label !== undefined && typeof label !== "string") throw new Error("Некорректная подпись перехода.");
    return { id, source, target, sourceHandle: handle(sourceHandle), targetHandle: handle(targetHandle), label, type: "smoothstep" };
  });
  return { name: name.trim(), ...(repeat === undefined ? {} : { repeat }), nodes: cleanNodes, edges: cleanEdges };
}

function checkSize(bytes: number) {
  if (bytes > workflowFileMaxBytes) throw new Error("Файл сценария превышает 256 КБ.");
}

export function serializeWorkflowFile(workflow: PortableWorkflow & Pick<Workflow, "dependencies">) {
  const dependencies = workflow.dependencies?.map((entry) => ({ id: graphId(entry.id), ...portableWorkflow(entry) }));
  const rich = Boolean(dependencies?.length || workflow.nodes.some(({ data }) => data.logic || data.logTone));
  const contents = JSON.stringify({
    format, version: rich ? 2 : 1, workflow: portableWorkflow(workflow),
    ...(rich ? { dependencies: dependencies ?? [] } : {}),
  }, null, 2);
  checkSize(new TextEncoder().encode(contents).byteLength);
  return contents;
}

export function parseWorkflowFile(contents: string) {
  checkSize(new TextEncoder().encode(contents).byteLength);
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch { throw new Error("Файл .hpx повреждён или имеет неверный формат."); }
  const envelope = record(value);
  if (envelope.format !== format) throw new Error("Выберите файл сценария Farmbox (.hpx).");
  if (envelope.version !== 1 && envelope.version !== 2) throw new Error("Эта версия .hpx не поддерживается.");
  const imported: Workflow = { ...portableWorkflow(envelope.workflow), id: newWorkflowId(), version: 1, targets: [] };
  const definitions = new Map<string, Workflow>();
  if (envelope.version === 2) {
    if (!Array.isArray(envelope.dependencies) || envelope.dependencies.length > 32) throw new Error("Некорректные зависимости в файле .hpx.");
    for (const value of envelope.dependencies) {
      const id = graphId(record(value).id);
      if (definitions.has(id)) throw new Error("Файл содержит дубликат связанного сценария.");
      definitions.set(id, { ...portableWorkflow(value), id, version: 1, targets: [] });
    }
  }
  const linked = linkWorkflowDependencies(imported, [...definitions.values()]);
  if ((linked.dependencies?.length ?? 0) !== definitions.size) throw new Error("Файл содержит сценарии, на которые нет ссылок.");
  const ids = new Map([...definitions.keys()].map((id) => [id, newWorkflowId()]));
  function remap(workflow: Workflow): Workflow {
    return { ...workflow, id: ids.get(workflow.id) ?? workflow.id, nodes: workflow.nodes.map((node) => node.data.kind === "call"
      ? { ...node, data: { ...node.data, parameter: ids.get(node.data.parameter)! } } : node) };
  }
  return { root: remap(imported), dependencies: [...definitions.values()].map(remap) };
}

function newWorkflowId() {
  return "FLOW-" + crypto.randomUUID();
}

export function workflowFileName(name: string) {
  const base = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/\.+$/, "").slice(0, 80);
  if (!base) return "scenario.hpx";
  return (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base) ? "_" : "") + base + ".hpx";
}
