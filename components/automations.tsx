"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { addEdge, Background, Handle, MarkerType, Panel, Position, ReactFlow, useEdgesState, useNodesState, useReactFlow, type Connection, type Edge, type NodeProps, type OnSelectionChangeParams, type Viewport } from "@xyflow/react";
import { Braces, Camera, Check, ChevronRight, Clock3, FitCanvas, GitBranch, Globe, ListChecks, Maximize, Minimize, Minus, MoreHorizontal, MousePointer2, Play, Plus, Radio, Save, ScanLine, Search, Smartphone, Terminal, Trash2, Video } from "./icons";
import { useCallback, useEffect, useState } from "react";
import { createId, gestureTemplate, makeNode, nodeCatalog, phones, runLabels, simulate, type FlowNode, type NodeKind, type Run, type Workflow } from "@/lib/demo";
import { updateDemo, useDemo, useDemoReady } from "@/lib/store";
import { beginDeviceRun, cancelDeviceRun, useDeviceRuns } from "@/lib/device-runs-client";
import { nodeSettings, realNodes, summarizeNode, validateDeviceGraph } from "@/lib/workflow-steps";
import type { AndroidTarget } from "@/lib/engine/contracts";
import { screenLabel, useAndroidInventory } from "./android-devices";
import { AndroidVideo } from "./android-video";
import { GestureRecorder, type RecordedTap } from "./gesture-recorder";
import { WorkflowSchedules } from "./workflow-schedules";
import { WorkflowNodeFields } from "./workflow-node-fields";
import { useRunPlayback, WorkflowTransition, type ExecutionEdge } from "./workflow-run-preview";
import { Button, Details, Empty, Frame, Modal, PageHeading, PanelHeading, SelectField, Status } from "./ui";

const groups = { Триггер: Radio, Устройство: Smartphone, Время: Clock3, Логика: GitBranch, Интеграции: Globe, Контент: Video, Диагностика: Terminal };
const overrides = { tap: MousePointer2, screenshot: Camera, wait: ScanLine, condition: Braces, publish: ListChecks };

function NodeSymbol({ kind }: { kind: NodeKind }) {
  const config = nodeCatalog[kind];
  const Icon = overrides[kind as keyof typeof overrides] ?? groups[config.group];
  return <span className={`node-symbol tone-${config.tone}`}><Icon size={16} /></span>;
}

function ActionNode({ data, selected }: NodeProps<FlowNode>) {
  const config = nodeCatalog[data.kind];
  const isTrigger = config.group === "Триггер";
  return <div className={`flow-node ${selected ? "corner-frame" : ""}`}>
    {!isTrigger && <Handle type="target" position={Position.Left} />}
    <NodeSymbol kind={data.kind} />
    <div><strong>{config.label}</strong><small>{summarizeNode(data)}</small></div>
    {data.kind === "condition" ? <>
      <Handle id="yes" type="source" position={Position.Right} style={{ top: "34%" }} aria-label="Да" />
      <Handle id="no" type="source" position={Position.Right} style={{ top: "70%" }} aria-label="Нет" />
    </> : data.kind === "loop" ? <>
      <span className="flow-port-labels" aria-hidden="true"><span>Тело</span><span>Выход</span></span>
      <Handle id="body" type="source" position={Position.Right} style={{ top: "34%" }} aria-label="Тело" />
      <Handle id="done" type="source" position={Position.Right} style={{ top: "70%" }} aria-label="Выход" />
    </> : data.kind !== "stop" && <Handle type="source" position={Position.Right} />}
  </div>;
}

const nodeTypes = { action: ActionNode };
const edgeTypes = { smoothstep: WorkflowTransition };
const editorDrafts = new Map<string, {
  version: number; nodes: FlowNode[]; edges: Edge[]; selectedId: string; targets?: string[];
  viewport?: Viewport; expanded: boolean; runId: string; repeat: boolean;
}>();
const edgeDefaults = { type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } };

function CanvasControls({ reveal, autoFit, onView }: {
  reveal: { x: number; y: number } | null; autoFit: boolean; onView: (viewport?: Viewport) => void;
}) {
  const { zoomIn, zoomOut, fitView, setCenter, getZoom, getViewport } = useReactFlow();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!reveal) return;
    void setCenter(reveal.x + 104, reveal.y + 30, {
      zoom: Math.max(getZoom(), .65), duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140,
    }).then(() => onView(getViewport()));
  }, [reveal, getZoom, setCenter, getViewport, onView]);

  useEffect(() => {
    const canvas = panel?.closest(".flow-canvas");
    if (!canvas || !autoFit) return;
    let timer: ReturnType<typeof setTimeout>;
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void fitView({ maxZoom: 1.12, padding: 0.08 }), 90);
    });
    resize.observe(canvas);
    return () => { clearTimeout(timer); resize.disconnect(); };
  }, [panel, autoFit, fitView]);

  return <Panel position="bottom-left" className="canvas-controls">
    <div ref={setPanel} className="canvas-controls-stack">
      <Button className="icon-button" aria-label="Приблизить холст" onClick={() => void zoomIn().then(() => onView(getViewport()))}><Plus size={16} /></Button>
      <Button className="icon-button" aria-label="Отдалить холст" onClick={() => void zoomOut().then(() => onView(getViewport()))}><Minus size={16} /></Button>
      <Button className="icon-button" aria-label="Вписать граф" onClick={() => { onView(undefined); void fitView({ maxZoom: 1.12, padding: 0.08 }); }}><FitCanvas size={16} /></Button>
    </div>
  </Panel>;
}

export function Automations() {
  const state = useDemo();
  const ready = useDemoReady();
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [newDialog, setNewDialog] = useState(false);
  const [name, setName] = useState("");
  const workflow = state.workflows.find((item) => item.id === state.selectedWorkflowId) ?? state.workflows[0];

  function selectWorkflow(id: string) {
    updateDemo((previous) => ({ ...previous, selectedWorkflowId: id }));
  }

  async function removeWorkflow(id: string) {
    setRemoving(true);
    setRemoveError("");
    try {
      const response = await fetch("/api/engine/schedules?workflowId=" + encodeURIComponent(id), { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(data?.message ?? "Не удалось удалить расписание сценария.");
      }
      updateDemo((previous) => {
        const workflows = previous.workflows.filter((item) => item.id !== id);
        return { ...previous, workflows, selectedWorkflowId: workflows.find((item) => item.id === previous.selectedWorkflowId)?.id ?? workflows[0]?.id };
      });
      editorDrafts.delete(id);
      setDeleting(null);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "Не удалось удалить сценарий.");
    } finally {
      setRemoving(false);
    }
  }

  function closeRemoval() {
    if (removing) return;
    setRemoveError("");
    setDeleting(null);
  }

  function insertTemplate() {
    const template = gestureTemplate();
    updateDemo((previous) => ({ ...previous, workflows: [...previous.workflows, template], selectedWorkflowId: template.id }));
  }

  function createWorkflow() {
    if (!name.trim()) return;
    const created: Workflow = { id: createId("FLOW"), name: name.trim(), version: 1, nodes: [makeNode("start", "start", 0, 0)], edges: [] };
    updateDemo((current) => ({ ...current, workflows: [...current.workflows, created], selectedWorkflowId: created.id }));
    setName("");
    setNewDialog(false);
  }

  const createActions = <><Button onClick={() => setNewDialog(true)}><Plus size={15} /> Новый сценарий</Button><Button onClick={insertTemplate}>Шаблон жестов</Button></>;

  return <>
    {workflow ? <Editor key={workflow.id + (ready ? "-loaded" : "-initial")} workflow={workflow} picker={
      <><SelectField className="workflow-picker" label="Выбрать сценарий" value={workflow.id} onChange={selectWorkflow} options={state.workflows.map((item) => ({ value: item.id, label: item.name }))} />
        <Popover.Root>
          <Popover.Trigger asChild><Button className="icon-button workflow-menu-trigger" title="Действия со сценарием" aria-label="Действия со сценарием"><MoreHorizontal size={17} /></Button></Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="workflow-actions-popup" align="end" sideOffset={6} collisionPadding={8} aria-label="Действия со сценарием">
              <Popover.Close asChild><Button variant="ghost" onClick={() => setNewDialog(true)}><Plus size={15} /> Новый сценарий</Button></Popover.Close>
              <Popover.Close asChild><Button variant="ghost" onClick={insertTemplate}><GitBranch size={15} /> Шаблон жестов</Button></Popover.Close>
              <Popover.Close asChild><Button variant="danger" onClick={() => setDeleting(workflow)}><Trash2 size={15} /> Удалить сценарий</Button></Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </>
    } /> : <Frame inspector={null}><PageHeading title="Автоматизации" description="Сценарии и результаты запусков" actions={createActions} />
      <Empty title="Сценариев пока нет" detail="Создайте сценарий или добавьте шаблон жестов." />
    </Frame>}
    {deleting && <Modal title="Удалить сценарий?" onClose={closeRemoval}>
      <p className="dialog-note">«{deleting.name}» и его расписания будут удалены. История запусков сохранится.</p>
      {removeError && <p role="alert">{removeError}</p>}
      <div className="dialog-actions"><Button autoFocus onClick={closeRemoval} disabled={removing}>Отмена</Button><Button variant="danger" disabled={removing} onClick={() => void removeWorkflow(deleting.id)}>Удалить сценарий</Button></div>
    </Modal>}
    {newDialog && <Modal title="Новый сценарий" onClose={() => setNewDialog(false)}>
      <form onSubmit={(event) => { event.preventDefault(); createWorkflow(); }}>
        <label className="field">Название<input className="control" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={64} required /></label>
        <div className="dialog-actions"><Button type="submit" variant="primary" disabled={!name.trim()}>Создать сценарий</Button></div>
      </form>
    </Modal>}
  </>;
}

function Editor({ workflow, picker }: { workflow: Workflow; picker: React.ReactNode }) {
  const state = useDemo();
  const [draft] = useState(() => {
    const stored = editorDrafts.get(workflow.id);
    return stored?.version === workflow.version ? stored : undefined;
  });
  const initialNode = draft?.selectedId ?? workflow.nodes[1]?.id ?? workflow.nodes[0]?.id ?? "";
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(draft?.nodes ?? workflow.nodes.map((node) => ({ ...node, selected: node.id === initialNode })));
  const [edges, setEdges, onEdgesChange] = useEdgesState(draft?.edges ?? workflow.edges);
  const [selectedId, setSelectedId] = useState(initialNode);
  const [catalog, setCatalog] = useState(false);
  const [reveal, setReveal] = useState<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState(draft?.viewport);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(draft?.expanded ?? false);
  const [picking, setPicking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showSchedules, setShowSchedules] = useState(false);
  const [repeat, setRepeat] = useState(draft?.repeat ?? workflow.repeat ?? false);
  const [configuredTargets, setConfiguredTargets] = useState(draft?.targets ?? workflow.targets);
  const [targetDialog, setTargetDialog] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"scenario" | "node">("scenario");
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState(draft?.runId ?? "");
  const [playRunId, setPlayRunId] = useState("");
  const [runError, setRunError] = useState("");
  const inventory = useAndroidInventory();
  const devices = inventory.devices.filter((device) => device.state === "ready");
  const targets = devices.flatMap((device) => [
    { key: device.serial + "/main", label: "Основной экран", device: device.model, serial: device.serial, screen: undefined },
    ...inventory.screens.filter((screen) => screen.serial === device.serial && !screen.awaitingConfirmation).map((screen) => ({
      key: device.serial + "/" + screen.id, label: screenLabel(screen), device: device.model, serial: device.serial, screen: screen.id,
    })),
  ]);
  const targetKeys = configuredTargets ?? targets.slice(0, 1).map((target) => target.key);
  const chosen = targets.filter((target) => targetKeys.includes(target.key));
  const unavailable = targetKeys.length - chosen.length;
  const captureTarget = chosen[0];
  const recordedRuns = useDeviceRuns();
  const workflowRuns = recordedRuns.filter((entry) => entry.workflowId === workflow.id || (!entry.workflowId && entry.workflow === workflow.name));
  const activeRun = workflowRuns.find((entry) => entry.status === "running");
  const lockedTargets = new Set(recordedRuns.filter((entry) => entry.status === "running").map((entry) => entry.target));
  const blocked = chosen.some((target) => lockedTargets.has(target.key));
  const requestedRun = runId ? recordedRuns.find((entry) => entry.id === runId) ?? state.runs.find((entry) => entry.id === runId) : undefined;
  const runResult = requestedRun && (requestedRun.origin !== "device" || requestedRun.status === "running") ? requestedRun
    : activeRun ?? requestedRun ?? (!playRunId ? workflowRuns[0] ?? state.runs.find((entry) => entry.workflowId === workflow.id) : undefined);
  const playback = useRunPlayback(runResult, playRunId);

  useEffect(() => {
    editorDrafts.set(workflow.id, { version: workflow.version, nodes, edges, selectedId, targets: configuredTargets, viewport, expanded, runId, repeat });
  }, [workflow.id, workflow.version, nodes, edges, selectedId, configuredTargets, viewport, expanded, runId, repeat]);

  const onSelectionChange = useCallback(({ nodes: selection }: OnSelectionChangeParams<FlowNode, Edge>) => {
    if (selection.length === 1) setSelectedId(selection[0].id);
  }, []);
  const selected = nodes.find((node) => node.id === selectedId);
  const config = selected ? nodeCatalog[selected.data.kind] : null;
  const recordAfter = selected ?? nodes.find((node) => node.data.kind === "start");
  const canRecord = Boolean(recordAfter && !["loop", "condition", "stop"].includes(recordAfter.data.kind) && chosen.length && nodes.length < 80);
  const outputs: AndroidTarget[] = chosen.map(({ serial, screen }) => ({ serial, screen }));
  const entries = (Object.keys(nodeCatalog) as NodeKind[]).filter((kind) => {
    const entry = nodeCatalog[kind];
    return (entry.label + " " + entry.group).toLowerCase().includes(search.toLowerCase().trim());
  });

  function addNode(kind: NodeKind) {
    const id = createId("NODE");
    const last = selected ?? nodes[nodes.length - 1];
    const attach = selected && selected.data.kind !== "loop" && selected.data.kind !== "condition" && selected.data.kind !== "stop" &&
      !edges.some((edge) => edge.source === selected.id) && nodeCatalog[kind].group !== "Триггер";
    const node = makeNode(kind, id, (last?.position.x ?? -256) + 256, (last?.position.y ?? 0) + (attach ? 0 : 112));
    if (attach && selected) setEdges((previous) => addEdge({ source: selected.id, target: id, sourceHandle: null, targetHandle: null }, previous));
    setReveal(node.position);
    setNodes((previous) => [...previous.map((entry) => ({ ...entry, selected: false })), { ...node, selected: true }]);
    setSelectedId(id);
    setInspectorTab("node");
    setCatalog(false);
    setSearch("");
    setNotice("");
  }

  function insertRecorded(points: RecordedTap[]) {
    if (!canRecord || !recordAfter || !points.length) return;
    const recorded: FlowNode[] = [];
    const anchorX = recordAfter.position.x;
    const baseY = Math.max(...nodes.map((item) => item.position.y)) + 128;
    function append(kind: "delay" | "tap", data: Partial<FlowNode["data"]>) {
      const index = recorded.length;
      const row = Math.floor(index / 4), column = index % 4;
      const node = makeNode(kind, createId("NODE"), anchorX + (row % 2 ? 3 - column : column) * 256, baseY + row * 112);
      node.data = { ...node.data, ...data };
      recorded.push(node);
    }
    for (const point of points) {
      if (point.waitMs) append("delay", { parameter: String(point.waitMs), timeout: point.waitMs + 1000 });
      append("tap", { settings: { x: point.x, y: point.y } });
    }
    if (nodes.length + recorded.length > 80) return;
    const previous = edges.find((edge) => edge.source === recordAfter.id);
    const sequence = [recordAfter.id, ...recorded.map((node) => node.id)];
    const links = sequence.slice(1).map((target, index) => ({ id: createId("EDGE"), source: sequence[index], target }));
    const outgoing = previous && { ...previous, id: createId("EDGE"), source: sequence.at(-1)!, sourceHandle: null };
    setEdges((current) => [...current.filter((edge) => edge.id !== previous?.id), ...links, ...(outgoing ? [outgoing] : [])]);
    const first = recorded[0];
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...recorded.map((node) => ({ ...node, selected: node.id === first.id }))]);
    setSelectedId(first.id);
    setInspectorTab("node");
    setReveal(first.position);
    setNotice("");
    setRecording(false);
  }

  function onConnect(connection: Connection) {
    const label = { yes: "Да", no: "Нет", body: "Тело", done: "Выход" }[connection.sourceHandle ?? ""];
    setEdges((previous) => addEdge({ ...connection, label }, previous));
    setNotice("");
  }

  function updateNode(patch: Partial<FlowNode["data"]>) {
    setNodes((previous) => previous.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node));
    setNotice("");
  }

  function save() {
    const cleanNodes = nodes.map(({ id, data, position, type }) => ({ id, data, position, type }));
    const cleanEdges = edges.map(({ id, source, target, sourceHandle, targetHandle, label, type }) => ({ id, source, target, sourceHandle, targetHandle, label, type }));
    updateDemo((state) => ({ ...state, workflows: state.workflows.map((entry) => entry.id === workflow.id ? { ...entry, version: entry.version + 1, nodes: cleanNodes, edges: cleanEdges, targets: targetKeys, repeat } : entry) }));
    setNotice("Версия сохранена.");
  }

  async function runOnPhone() {
    if (!chosen.length || busy || unavailable || blocked) return;
    setRunError("");
    setBusy(true);
    try {
      const [run] = await beginDeviceRun({ ...workflow, nodes, edges, repeat }, outputs);
      setRunId(run.id);
      setPlayRunId(run.id);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Запуск не выполнен.");
    } finally { setBusy(false); }
  }

  function run() {
    setRunError("");
    const graph = { ...workflow, nodes, edges };
    let result: Run;
    if (nodes.every((node) => realNodes.has(node.data.kind)) && nodes.some((node) => node.data.kind === "loop" || node.data.kind === "randomDelay")) {
      try {
        const steps = validateDeviceGraph(graph).map(({ node, detail, edgeId }) => {
          const setting = nodeSettings(node.data);
          const pause = (setting.minSeconds + Math.random() * (setting.maxSeconds - setting.minSeconds)).toFixed(2) + " с";
          return { nodeId: node.id, edgeId, label: nodeCatalog[node.data.kind].label, status: "success" as const,
            detail: detail ?? (node.data.kind === "randomDelay" ? pause : summarizeNode(node.data)) };
        });
        result = { id: createId("RUN"), workflow: workflow.name, workflowId: workflow.id, device: "Симуляция", started: "Сейчас", status: "success", steps };
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Проверьте граф.");
        return;
      }
    } else {
      result = simulate(graph, phones[0]);
    }
    updateDemo((state) => ({ ...state, runs: [result, ...state.runs] }));
    setRunId(result.id);
    setPlayRunId(result.id);
  }

  const inspector = <>
    <div className="editor-inspector-tabs segmented" aria-label="Настройки редактора">
      <Button aria-pressed={inspectorTab === "scenario"} onClick={() => setInspectorTab("scenario")}>Сценарий</Button>
      <Button aria-pressed={inspectorTab === "node"} disabled={!selected} onClick={() => setInspectorTab("node")}>Нода</Button>
    </div>
    {inspectorTab === "node" && selected && config ? <>
      <PanelHeading title={config.label} description={config.group} icon={<NodeSymbol kind={selected.data.kind} />} />
      <div className="panel-block"><h3>Параметры ноды</h3><p className="muted">{config.description}</p>
        {!realNodes.has(selected.data.kind) && <Status tone="amber">Только симуляция</Status>}
        <WorkflowNodeFields node={selected.data} change={updateNode} pick={captureTarget ? () => setPicking(true) : undefined} />
        <label className="field">Тайм-аут, мс<input className="control" type="number" min={1} value={selected.data.timeout || ""} onChange={(event) => updateNode({ timeout: Number(event.target.value) })} /></label>
      </div>
      <div className="panel-block"><h3>Переходы</h3><Details entries={[["Входов", edges.filter((edge) => edge.target === selected.id).length], ["Выходов", edges.filter((edge) => edge.source === selected.id).length]]} />
        <Button variant="danger" onClick={() => { setNodes((previous) => previous.filter((node) => node.id !== selected.id)); setEdges((previous) => previous.filter((edge) => edge.source !== selected.id && edge.target !== selected.id)); setSelectedId(""); setInspectorTab("scenario"); setNotice(""); }}><Trash2 size={14} /> Удалить ноду</Button>
      </div>
    </> : <>
      <PanelHeading title={workflow.name} description={`Версия ${workflow.version} · ${nodes.length} нод`} icon={<GitBranch size={18} />} />
      <div className="panel-block editor-scenario-actions">{picker}</div>
      <div className="panel-block">
        <h3>Запуск</h3>
        {chosen.length > 0 && <ul className="editor-target-summary">{chosen.map((item) => <li key={item.key}>{item.label}<small>{item.device}</small></li>)}</ul>}
        {unavailable > 0 && <p role="status">Выбранных экранов недоступно: {unavailable}.</p>}
        {blocked && <p className="muted">Один из выбранных экранов занят.</p>}
        <label className="record-live"><input type="checkbox" checked={repeat} onChange={(event) => { setRepeat(event.target.checked); setNotice(""); }} />
          Повторять с начала до остановки</label>
        <div className="editor-run-buttons">
          <Button variant="primary" disabled={!chosen.length || unavailable > 0 || busy || blocked} onClick={() => void runOnPhone()}><Play size={14} /> Запустить</Button>
          <Button onClick={run} disabled={busy}>Симуляция</Button>
        </div>
        <Button onClick={() => setShowSchedules(true)}><Clock3 size={15} /> Расписание</Button>
        {runError && <p role="alert">{runError}</p>}
        {runResult && <div className="run-preview" role="status">
          <Status tone={runResult.status === "running" || playback.presenting ? "blue" : runResult.status === "error" ? "red" : runResult.status === "success" ? "green" : "neutral"}>{playback.presenting ? "В работе" : runLabels[runResult.status]}</Status>
          {playback.current && <p className="run-preview-step">{playback.index}. {playback.current.label}</p>}
          {runResult.status === "running" && <Button variant="danger" onClick={() => void cancelDeviceRun(runResult.id).catch((error) => setRunError(error.message))}>Остановить</Button>}
          <Link className="inline-link" href={"/runs?run=" + runResult.id}>Открыть запуск <ChevronRight size={14} /></Link>
        </div>}
      </div>
    </>}
  </>;

  return <Frame initialInspectorWidth={360} className="flow-workbench" canvasFocus={expanded} inspector={inspector}>
    <div className="flow-canvas">
      <div className="editor-toolbar" role="group" aria-label="Инструменты холста">
        <div className="editor-toolbar-group">
          <Button onClick={() => setCatalog(true)} aria-label="Добавить ноду" title="Добавить ноду"><Plus size={15} /><span className="editor-toolbar-label">Добавить ноду</span></Button>
          <Button onClick={() => setTargetDialog(true)}><Smartphone size={15} /> Экраны{targetKeys.length ? ` · ${targetKeys.length}` : ""}</Button>
        </div>
        <div className="editor-toolbar-group">
          {notice && <span className="editor-save-note" role="status"><Check size={13} /> {notice}</span>}
          <Button onClick={save} aria-label="Сохранить" title="Сохранить"><Save size={14} /><span className="editor-toolbar-label">Сохранить</span></Button>
          <Button className="icon-button" onClick={() => setExpanded(!expanded)} aria-pressed={expanded}
            title={expanded ? "Свернуть холст" : "Развернуть холст"} aria-label={expanded ? "Свернуть холст" : "Развернуть холст"}>{expanded ? <Minimize size={17} /> : <Maximize size={17} />}</Button>
        </div>
      </div>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes.map((node) => {
          const status = playback.nodeStates.get(node.id);
          return status ? { ...node, className: "workflow-node-" + status } : node;
        })}
        edges={edges.map((edge): ExecutionEdge => {
          const pulse = playback.pulse?.edgeId === edge.id ? playback.pulse.key : undefined;
          return { ...edge, type: "smoothstep", className: playback.traversed.has(edge.id) ? "workflow-edge-traversed" : undefined, data: pulse ? { pulse } : undefined };
        })} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultEdgeOptions={edgeDefaults} proOptions={{ hideAttribution: true }}
        onNodesChange={(changes) => { onNodesChange(changes); if (changes.some((change) => change.type !== "select" && change.type !== "dimensions")) setNotice(""); }}
        onEdgesChange={(changes) => { onEdgesChange(changes); if (changes.some((change) => change.type !== "select")) setNotice(""); }}
        onConnect={onConnect} onNodeClick={(_, node) => { setSelectedId(node.id); setInspectorTab("node"); }} onPaneClick={() => { setSelectedId(""); setInspectorTab("scenario"); }}
        onSelectionChange={onSelectionChange}
        isValidConnection={(edge) => edge.source !== edge.target && nodes.find((node) => node.id === edge.source)?.data.kind !== "stop" &&
          nodes.find((node) => node.id === edge.target)?.data.kind !== "start" && !edges.some((entry) => entry.source === edge.source && (entry.sourceHandle ?? null) === (edge.sourceHandle ?? null))}
        defaultViewport={draft?.viewport} onMoveEnd={(event, next) => { if (event) setViewport(next); }} fitView={!draft?.viewport} fitViewOptions={{ maxZoom: 1.12, padding: 0.08 }} minZoom={0.2} panOnScroll zoomOnScroll={false} colorMode="dark" snapToGrid snapGrid={[16, 16]}>
        <Background gap={16} size={1} color="#303035" /><CanvasControls reveal={reveal} autoFit={viewport === undefined} onView={setViewport} />
      </ReactFlow>
    </div>
    {showSchedules && <WorkflowSchedules workflow={{ ...workflow, nodes, edges, repeat }} targets={unavailable ? [] : outputs}
      labels={chosen.map((item) => item.device + " · " + item.label)} timezone={state.settings.timezone} onClose={() => setShowSchedules(false)} />}
    {recording && <GestureRecorder targets={chosen} maxNodes={80 - nodes.length} onInsert={insertRecorded} onClose={() => setRecording(false)} />}
    {targetDialog && <Modal title="Экраны для запуска" onClose={() => setTargetDialog(false)}>
      {targets.length ? <>
        <div className="target-selection-actions"><Button onClick={() => setConfiguredTargets(targets.map((target) => target.key))}>Выбрать все</Button>
          <Button onClick={() => setConfiguredTargets([])}>Снять выбор</Button></div>
        <div className="target-picker-list">{targets.map((target) => {
          const checked = targetKeys.includes(target.key);
          return <button type="button" className="command-row" key={target.key} role="checkbox" aria-checked={checked}
            onClick={() => setConfiguredTargets(checked ? targetKeys.filter((key) => key !== target.key) : [...targetKeys, target.key])}>
            <span><strong>{target.label}</strong><small>{target.device}</small></span>{checked && <Check size={15} />}
          </button>;
        })}</div>
      </> : <p className="muted">Нет доступных экранов Android.</p>}
      {unavailable > 0 && <Button onClick={() => setConfiguredTargets(chosen.map((target) => target.key))}>Убрать недоступные из выбора</Button>}
      <div className="dialog-actions"><Button variant="primary" onClick={() => setTargetDialog(false)}>Готово</Button></div>
    </Modal>}
    {picking && captureTarget && selected && <Modal title="Задать жест по экрану" onClose={() => setPicking(false)}>
      <p className="muted dialog-note">{selected.data.kind === "swipe" ? "Проведите по превью в нужном направлении." : "Нажмите на нужную точку превью."} Жест запишется в ноду.</p>
      <div className="android-control-screen"><AndroidVideo key={captureTarget.key} serial={captureTarget.serial} screen={captureTarget.screen} label={captureTarget.label} onGesture={(gesture) => {
        if ((selected.data.kind === "swipe") !== (gesture.kind === "swipe")) return;
        const percent = (value: number) => Math.round(value * 1000) / 10;
        updateNode({ settings: { ...selected.data.settings, x: percent(gesture.x), y: percent(gesture.y),
          ...(gesture.kind === "swipe" ? { toX: percent(gesture.toX), toY: percent(gesture.toY), duration: gesture.duration } : {}) } });
        setPicking(false);
      }} /></div>
    </Modal>}
    {catalog && <Modal title="Каталог нод" onClose={() => { setCatalog(false); setSearch(""); }}>
      <label className="search-control catalog-search"><Search size={15} /><input aria-label="Найти ноду" placeholder="Найти ноду…" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      {selected && selected.data.kind !== "loop" && selected.data.kind !== "condition" && selected.data.kind !== "stop" && !edges.some((edge) => edge.source === selected.id) &&
        <p className="muted dialog-note">Новая нода подключится после «{nodeCatalog[selected.data.kind].label}».</p>}
      <Button className="catalog-record" disabled={!canRecord} onClick={() => { setCatalog(false); setSearch(""); setRecording(true); }}>
        <MousePointer2 size={16} /> Записать касания
      </Button>
      {!canRecord && <p className="muted dialog-note">Для записи выберите доступный экран и ноду с одним выходом.</p>}
      <div className="catalog-list">{entries.length ? entries.map((kind) => <button className="catalog-item" type="button" key={kind} onClick={() => addNode(kind)}>
        <NodeSymbol kind={kind} /><span><strong>{nodeCatalog[kind].label}</strong><small>{nodeCatalog[kind].group}</small></span><Plus size={15} />
      </button>) : <p className="muted">Ноды не найдены.</p>}</div>
    </Modal>}
  </Frame>;
}
