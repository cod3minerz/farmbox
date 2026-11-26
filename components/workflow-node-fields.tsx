"use client";

import { useId } from "react";
import { nodeCatalog, type FlowNode, type NodeSettings, type Workflow } from "@/lib/demo";
import { logTones, type LogTone, type NodeLogic } from "@/lib/workflow-logic";
import { nodeSettings } from "@/lib/workflow-steps";
import { Button, SelectField } from "./ui";

const logLabels: Record<LogTone, string> = { neutral: "Нейтральный", blue: "Синий", green: "Зелёный", amber: "Янтарный", red: "Красный" };
const valueTypes = [{ value: "number", label: "Число" }, { value: "text", label: "Текст" }, { value: "boolean", label: "Да или нет" }];
const operators = [
  { value: "eq", label: "Равно (=)" }, { value: "ne", label: "Не равно (≠)" },
  { value: "lt", label: "Меньше (<)" }, { value: "lte", label: "Меньше или равно (≤)" },
  { value: "gt", label: "Больше (>)" }, { value: "gte", label: "Больше или равно (≥)" },
  { value: "between", label: "Внутри диапазона (строго)" }, { value: "outside", label: "Вне открытого диапазона" },
];

const compareSymbols: Readonly<Record<string, string>> = { eq: "=", ne: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥" };
const parameterLabels = {
  schedule: "Время", open: "Пакет Android", input: "Текст", wait: "Элемент",
  call: "Сценарий", request: "Запрос", narezai: "Источник", validate: "Формат", publish: "Канал",
} as const;

type PreviewField = { label: string; value: string; multiline?: boolean };

function previewFields(node: FlowNode["data"]): PreviewField[] {
  const { kind, parameter, logic } = node;
  const settings = nodeSettings(node);
  const variable = logic?.variable || "Не задана";
  const valueType = valueTypes.find((type) => type.value === (logic?.valueType ?? "number"))?.label ?? "—";
  const format = (value: number, unit: string) => Number.isFinite(value) ? `${value}${unit}` : "—";
  const point = (x: number, y: number) => `${format(x, "%")} / ${format(y, "%")}`;

  switch (kind) {
    case "start": return [{ label: "Запуск", value: "По кнопке" }];
    case "stop": return [{ label: "Действие", value: "Завершить запуск" }];
    case "home": return [{ label: "Действие", value: "На главный экран" }];
    case "back": return [{ label: "Действие", value: "На предыдущий экран" }];
    case "wake": return [{ label: "Цель", value: "Основной экран" }];
    case "screenshot": return [{ label: "Формат", value: "PNG" }];
    case "delay": return [{ label: "Ждать", value: parameter.trim() ? parameter + " мс" : "Не задано" }];
    case "randomDelay": return [
      { label: "Минимум", value: format(settings.minSeconds, " с") },
      { label: "Максимум", value: format(settings.maxSeconds, " с") },
    ];
    case "tap": return [{ label: "X / Y", value: point(settings.x, settings.y) }];
    case "doubleTap": return [
      { label: "X / Y", value: point(settings.x, settings.y) },
      { label: "Интервал", value: format(settings.gap, " мс") },
    ];
    case "swipe": return [
      { label: "От X / Y", value: point(settings.x, settings.y) },
      { label: "До X / Y", value: point(settings.toX, settings.toY) },
      { label: "Время", value: format(settings.duration, " мс") },
    ];
    case "loop": return [{ label: "Проходов", value: format(settings.count, "") }];
    case "log": return [
      { label: "Сообщение", value: parameter || "Пусто", multiline: true },
      { label: "Цвет", value: logLabels[node.logTone ?? "neutral"] },
    ];
    case "setVariable": return [
      { label: "Переменная", value: variable }, { label: "Тип", value: valueType },
      { label: "Значение", value: parameter || (logic?.valueType === "text" ? "Пустой текст" : "Не задано"), multiline: logic?.valueType === "text" },
    ];
    case "adjustVariable": return [
      { label: "Переменная", value: variable }, { label: "Прибавить", value: parameter || "Не задано" },
    ];
    case "randomNumber": return [
      { label: "Переменная", value: variable },
      { label: "Диапазон", value: logic?.randomMode === "percent" ? "0–99,99%" : `${logic?.lower ?? "0"} … ${logic?.upper ?? "100"}` },
    ];
    case "condition": {
      if (!logic?.operator) return [{ label: "Значение", value: parameter === "false" ? "Нет" : "Да" }];
      const name = logic.variable || "…";
      const range = `${logic.lower || "…"} < ${name} < ${logic.upper || "…"}`;
      const expression = logic.operator === "between" ? range : logic.operator === "outside" ? `Вне (${range})`
        : `${name} ${compareSymbols[logic.operator] ?? "?"} ${logic.operand || "…"}`;
      return [{ label: "Проверка", value: expression, multiline: true },
        ...(["eq", "ne"].includes(logic.operator) ? [{ label: "Тип", value: valueType }] : [])];
    }
    default: return [{ label: parameterLabels[kind], value: parameter || "Не задано", multiline: kind === "input" || kind === "open" || kind === "request" }];
  }
}

export function WorkflowNodePreview({ node }: { node: FlowNode["data"] }) {
  const fields = previewFields(node);
  const defaultTimeout = node.kind === "randomDelay" ? 20000 : 10000;
  if (node.kind !== "call" && node.timeout !== defaultTimeout) {
    fields.push({ label: "Тайм-аут", value: node.timeout > 0 ? node.timeout + " мс" : "Не задан" });
  }
  return <dl className="flow-node-preview">{fields.map(({ label, value, multiline }) =>
    <div key={label} className={multiline ? "flow-node-preview-text" : undefined}>
      <dt>{label}</dt><dd title={value}>{value}</dd>
    </div>)}</dl>;
}

type Props = {
  node: FlowNode["data"];
  change: (patch: Partial<FlowNode["data"]>) => void;
  pick?: () => void;
  workflows: readonly Workflow[];
  variables: readonly string[];
};

export function WorkflowNodeFields({ node, change, pick, workflows, variables }: Props) {
  const values = nodeSettings(node);
  const { kind } = node;
  const variableList = useId();
  function field(label: string, key: keyof NodeSettings, min: number, max: number, step = 1) {
    return <label className="field" key={key}>{label}<input className="control" type="number" min={min} max={max} step={step}
      value={Number.isFinite(values[key]) ? values[key] : ""} onChange={(event) => change({ settings: { ...node.settings, [key]: event.target.valueAsNumber } })} /></label>;
  }
  function preset(settings: NodeSettings) {
    change({ settings: { ...node.settings, ...settings } });
  }
  const logic = node.logic ?? {};
  function patchLogic(patch: Partial<NodeLogic>) {
    change({ logic: { ...logic, ...patch } });
  }
  function logicField(label: string, key: keyof NodeLogic, placeholder?: string) {
    return <label className="field">{label}<input className="control" value={logic[key] ?? ""} placeholder={placeholder}
      list={key === "variable" ? variableList : undefined}
      maxLength={key === "variable" ? 40 : 500} onChange={(event) => patchLogic({ [key]: event.target.value })} />
      {key === "variable" && <datalist id={variableList}>{variables.map((name) => <option key={name} value={name} />)}</datalist>}</label>;
  }
  function parameterField(label: string) {
    return <label className="field">{label}<input className="control" value={node.parameter} maxLength={500}
      onChange={(event) => change({ parameter: event.target.value })} /></label>;
  }
  if (kind === "log") return <>
    <label className="field">Сообщение<textarea className="control log-message-input" aria-label="Сообщение" value={node.parameter} rows={4} maxLength={4000}
      onChange={(event) => change({ parameter: event.target.value })} /></label>
    <p className="muted">Для подстановки переменной используйте {"{{name}}"}.</p>
    <div className="field"><span>Цвет записи</span><SelectField label="Цвет записи" value={node.logTone ?? "neutral"}
      options={logTones.map((tone) => ({ value: tone, label: logLabels[tone] }))} onChange={(logTone) => change({ logTone })} /></div>
  </>;
  if (kind === "setVariable" || kind === "adjustVariable" || kind === "randomNumber") return <>
    {logicField("Имя переменной", "variable", "x")}
    {kind === "randomNumber" ? <>
      <div className="field"><span>Тип значения</span><SelectField label="Тип случайного значения" value={logic.randomMode ?? "integer"}
        options={[{ value: "integer", label: "Целое число" }, { value: "percent", label: "Процент (0–99,99%)" }]}
        onChange={(randomMode) => patchLogic({ randomMode })} /></div>
      {logic.randomMode !== "percent" && <div className="node-field-grid">
        {logicField("От", "lower", "0")}{logicField("До", "upper", "100")}</div>}
    </> : <>
      {kind === "setVariable" && <div className="field"><span>Тип значения</span><SelectField label="Тип значения переменной"
        value={logic.valueType ?? "number"} options={valueTypes} onChange={(valueType) => patchLogic({ valueType })} /></div>}
      {parameterField(kind === "adjustVariable" ? "Прибавить" : "Значение")}
    </>}
  </>;
  if (kind === "condition") {
    const operator = logic.operator;
    const range = operator === "between" || operator === "outside";
    return <>
      <div className="field"><span>Режим условия</span><SelectField label="Режим условия" value={operator ? "variable" : "constant"}
        options={[{ value: "constant", label: "Постоянное значение" }, { value: "variable", label: "Сравнить переменную" }]}
        onChange={(mode) => patchLogic({ operator: mode === "variable" ? operator ?? "between" : undefined })} /></div>
      {operator ? <>
        {logicField("Имя переменной", "variable", "x")}
        <div className="field"><span>Оператор</span><SelectField label="Оператор сравнения" value={operator} options={operators}
          onChange={(value) => patchLogic({ operator: value })} /></div>
        {(operator === "eq" || operator === "ne") && <div className="field"><span>Тип сравнения</span>
          <SelectField label="Тип сравнения" value={logic.valueType ?? "number"} options={valueTypes} onChange={(valueType) => patchLogic({ valueType })} /></div>}
        {range ? <div className="node-field-grid">{logicField("Нижняя граница", "lower", "40%")}{logicField("Верхняя граница", "upper", "47%")}</div>
          : logicField("Сравнить с", "operand")}
      </> : <SelectField label="Значение условия" value={node.parameter === "false" ? "false" : "true"}
        options={[{ value: "true", label: "Да (true)" }, { value: "false", label: "Нет (false)" }]} onChange={(parameter) => change({ parameter })} />}
    </>;
  }
  if (kind === "call") return workflows.length ? <SelectField label="Вложенный сценарий" placeholder="Выберите сценарий"
    value={workflows.some((workflow) => workflow.id === node.parameter) ? node.parameter : ""}
    options={workflows.map((workflow) => ({ value: workflow.id, label: workflow.name }))} onChange={(parameter) => change({ parameter })} />
    : <p className="muted">Создайте ещё один сценарий, чтобы вызвать его здесь.</p>;
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
  if (nodeCatalog[kind].group === "Триггер" && kind !== "schedule" || kind === "stop" || kind === "home" || kind === "wake" || kind === "back" || kind === "screenshot") return null;
  return <label className="field">{kind === "delay" ? "Задержка, мс" : kind === "open" ? "Пакет Android" : "Значение"}
    <input className="control" value={node.parameter} placeholder={kind === "open" ? "com.android.settings" : undefined}
      onChange={(event) => change({ parameter: event.target.value })} />
  </label>;
}
