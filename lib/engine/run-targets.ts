import { EngineError, validSerial } from "./android";
import { validScreenId } from "./android-video";
import type { AndroidTarget } from "./contracts";

export function parseRunTargets(value: unknown): AndroidTarget[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) throw new EngineError("INVALID_REQUEST");
  const ids = new Set<string>();
  return value.map((target): AndroidTarget => {
    if (!target || typeof target.serial !== "string" || !validSerial(target.serial) ||
      (target.screen !== undefined && !validScreenId(target.screen))) throw new EngineError("INVALID_REQUEST");
    const key = target.serial + "/" + (target.screen ?? "main");
    if (ids.has(key)) throw new EngineError("INVALID_REQUEST");
    ids.add(key);
    return { serial: target.serial, screen: target.screen };
  });
}
