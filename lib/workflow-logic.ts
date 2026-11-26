export type WorkflowValue = number | string | boolean;
export type LogTone = "neutral" | "blue" | "green" | "amber" | "red";
export const logTones: readonly LogTone[] = ["neutral", "blue", "green", "amber", "red"];
export type ValueType = "number" | "text" | "boolean";
export type Operator = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "between" | "outside";
type LogicField = "variable" | "valueType" | "operator" | "operand" | "lower" | "upper" | "randomMode";
export type NodeLogic = Partial<Record<LogicField, string>>;
type LogicNode = { kind: string; parameter: string; logic?: NodeLogic };
type Variables = Map<string, WorkflowValue>;

const logicFields: readonly LogicField[] = ["variable", "valueType", "operator", "operand", "lower", "upper", "randomMode"];
const namePattern = /^[\p{L}_][\p{L}\p{N}_]{0,39}$/u;

export function readNodeLogic(value: unknown): NodeLogic | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные параметры логики.");
  const logic: NodeLogic = {};
  for (const key of logicFields) {
    const field = Object.getOwnPropertyDescriptor(value, key)?.value;
    if (field === undefined) continue;
    if (typeof field !== "string" || field.length > 500) throw new Error("Некорректные параметры логики.");
    logic[key] = field;
  }
  return logic;
}

export function readLogTone(tone: unknown): LogTone | undefined {
  if (tone === undefined) return undefined;
  if (!logTones.includes(tone as LogTone)) throw new Error("Некорректный цвет записи.");
  return tone as LogTone;
}

function number(value: string) {
  const raw = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)\s*%?$/.test(raw)) throw new Error("Укажите число или процент.");
  const parsed = Number(raw.replace(/\s*%$/, "").replace(",", "."));
  if (!Number.isFinite(parsed) || Math.abs(parsed) > 1_000_000_000) throw new Error("Число должно быть в пределах ±1 000 000 000.");
  return parsed;
}

function literal(type: string, raw: string): WorkflowValue {
  if (type === "number") return number(raw);
  if (type === "text") return raw;
  if (type === "boolean" && /^(true|false)$/i.test(raw.trim())) return raw.trim().toLowerCase() === "true";
  throw new Error("Для логического значения укажите true или false.");
}

function requireVariable(variables: Variables | undefined, key: string): WorkflowValue | undefined {
  if (!namePattern.test(key)) throw new Error("Имя переменной должно начинаться с буквы или _ и содержать до 40 символов.");
  if (!variables) return undefined;
  if (!variables.has(key)) throw new Error("Переменная «" + key + "» ещё не задана.");
  return variables.get(key);
}

export function workflowLogic(node: LogicNode, variables?: Variables): { detail?: string; branch?: "yes" | "no" } {
  const config = readNodeLogic(node.logic);
  const key = config?.variable ?? "";
  switch (node.kind) {
    case "setVariable": {
      requireVariable(undefined, key);
      const value = literal(config?.valueType ?? "number", node.parameter);
      variables?.set(key, value);
      return { detail: key + " = " + String(value) };
    }
    case "adjustVariable": {
      const value = requireVariable(variables, key);
      const delta = number(node.parameter);
      if (!variables) return {};
      if (typeof value !== "number") throw new Error("Переменная «" + key + "» должна быть числом.");
      const result = value + delta;
      if (!Number.isFinite(result) || Math.abs(result) > 1_000_000_000) throw new Error("Значение переменной вышло за допустимые пределы.");
      variables.set(key, result);
      return { detail: key + " = " + String(result) };
    }
    case "randomNumber": {
      requireVariable(undefined, key);
      const mode = config?.randomMode ?? "integer";
      if (mode !== "integer" && mode !== "percent") throw new Error("Выберите тип случайного значения.");
      const min = mode === "percent" ? 0 : number(config?.lower ?? "0");
      const max = mode === "percent" ? 99.99 : number(config?.upper ?? "100");
      if (min > max || (mode === "integer" && (!Number.isInteger(min) || !Number.isInteger(max)))) {
        throw new Error("Введите целые границы случайного числа. Нижняя граница должна быть не больше верхней.");
      }
      if (!variables) return {};
      const value = mode === "percent" ? Math.floor(Math.random() * 10_000) / 100 : min + Math.floor(Math.random() * (max - min + 1));
      variables.set(key, value);
      return { detail: key + " = " + (mode === "percent" ? value.toFixed(2) + "%" : String(value)) };
    }
    case "condition": {
      if (!config?.operator) {
        const value = literal("boolean", node.parameter);
        return { branch: value ? "yes" : "no", detail: value ? "Да" : "Нет" };
      }
      const value = requireVariable(variables, key);
      const op = config.operator;
      let matched: boolean;
      if (op === "eq" || op === "ne") {
        const operand = literal(config.valueType ?? "number", config.operand ?? "");
        if (variables && typeof value !== typeof operand) throw new Error("Для сравнения выберите тип переменной «" + key + "».");
        matched = (value === operand) === (op === "eq");
      } else if (op === "between" || op === "outside") {
        const min = number(config.lower ?? "");
        const max = number(config.upper ?? "");
        if (min >= max) throw new Error("Нижняя граница условия должна быть меньше верхней.");
        if (variables && typeof value !== "number") throw new Error("Для диапазона нужна числовая переменная.");
        const inside = typeof value === "number" && min < value && value < max;
        matched = inside === (op === "between");
      } else {
        const operand = number(config.operand ?? "");
        if (variables && typeof value !== "number") throw new Error("Для сравнения нужна числовая переменная.");
        const left = typeof value === "number" ? value : 0;
        switch (op) {
          case "lt": matched = left < operand; break;
          case "lte": matched = left <= operand; break;
          case "gt": matched = left > operand; break;
          case "gte": matched = left >= operand; break;
          default: throw new Error("Выберите оператор сравнения.");
        }
      }
      return variables ? { branch: matched ? "yes" : "no", detail: key + " = " + String(value) + " · ветка «" + (matched ? "Да" : "Нет") + "»" } : {};
    }
    case "log":
      return { detail: variables ? node.parameter.replace(/\{\{\s*([\p{L}_][\p{L}\p{N}_]{0,39})\s*\}\}/gu,
        (match, key: string) => variables.has(key) ? String(variables.get(key)) : match).slice(0, 4000) : undefined };
    default: return {};
  }
}
