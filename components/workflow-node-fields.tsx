"use client";

import { nodeCatalog, type FlowNode, type NodeSettings } from "@/lib/demo";
import { nodeSettings } from "@/lib/workflow-steps";
import { Button } from "./ui";

type Props = {
  node: FlowNode["data"];
  change: (patch: Partial<FlowNode["data"]>) => void;
  pick?: () => void;
};

export function WorkflowNodeFields({ node, change, pick }: Props) {
  const values = nodeSettings(node);
  const { kind } = node;
  function field(label: string, key: keyof NodeSettings, min: number, max: number, step = 1) {
    return <label className="field" key={key}>{label}<input className="control" type="number" min={min} max={max} step={step}
      value={Number.isFinite(values[key]) ? values[key] : ""} onChange={(event) => change({ settings: { ...node.settings, [key]: event.target.valueAsNumber } })} /></label>;
  }
  function preset(settings: NodeSettings) {
    change({ settings: { ...node.settings, ...settings } });
  }
  if (kind === "randomDelay") return <div className="node-field-grid">
    {field("От, секунд", "minSeconds", .01, 600, .01)}{field("До, секунд", "maxSeconds", .01, 600, .01)}
  </div>;
  if (kind === "loop") return <>{field("Число повторов", "count", 1, 100)}<p className="muted">«Тело» ведёт к первому шагу. Последний шаг возвращается сюда. «Выход» срабатывает после всех проходов.</p></>;
  if (kind === "tap" || kind === "doubleTap" || kind === "swipe") return <>
    {kind === "swipe" && <div className="gesture-presets" aria-label="Направление свайпа">
      <Button onClick={() => preset({ x: 50, y: 75, toX: 50, toY: 25 })}>Вверх</Button>
      <Button onClick={() => preset({ x: 50, y: 25, toX: 50, toY: 75 })}>Вниз</Button>
      <Button onClick={() => preset({ x: 75, y: 50, toX: 25, toY: 50 })}>Влево</Button>
      <Button onClick={() => preset({ x: 25, y: 50, toX: 75, toY: 50 })}>Вправо</Button>
    </div>}
    <div className="node-field-grid">
      {field(kind === "swipe" ? "Начало X, %" : "X, %", "x", 0, 100, .1)}
      {field(kind === "swipe" ? "Начало Y, %" : "Y, %", "y", 0, 100, .1)}
      {kind === "swipe" && <>{field("Конец X, %", "toX", 0, 100, .1)}{field("Конец Y, %", "toY", 0, 100, .1)}</>}
    </div>
    {kind === "swipe" && field("Длительность, мс", "duration", 100, 2000)}
    {kind === "doubleTap" && field("Интервал, мс", "gap", 25, 450)}
    {pick && <Button onClick={pick}>Задать на экране телефона</Button>}
  </>;
  if (nodeCatalog[kind].group === "Триггер" && kind !== "schedule" || kind === "stop" || kind === "home" || kind === "back" || kind === "screenshot") return null;
  return <label className="field">{kind === "delay" ? "Задержка, мс" : kind === "open" ? "Пакет Android" : "Значение"}
    <input className="control" value={node.parameter} placeholder={kind === "open" ? "com.android.settings" : undefined}
      onChange={(event) => change({ parameter: event.target.value })} />
  </label>;
}
