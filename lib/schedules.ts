import type { AndroidTarget } from "./engine/contracts";

export type ScheduleTiming =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string; timezone: string };

export type Schedule = {
  id: string;
  workflowId: string;
  version: number;
  name: string;
  targets: AndroidTarget[];
  timing: ScheduleTiming;
  preempt: boolean;
  enabled: boolean;
  nextAt: number;
  last?: { at: number; status: "running" | "success" | "error" | "skipped"; detail: string };
};

export function nextScheduleAt(timing: ScheduleTiming, after: number, slot?: number) {
  if (timing.kind === "interval") {
    const interval = timing.minutes * 60000;
    return slot === undefined ? after + interval : slot + Math.max(1, Math.floor((after - slot) / interval) + 1) * interval;
  }
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timing.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timing.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const previousDay = slot === undefined ? undefined : date.format(slot);
  const start = Math.floor(after / 60000) * 60000 + 60000;
  for (let at = start; at < start + 49 * 3600000; at += 60000) {
    if (localTime.format(at) === timing.time && (previousDay === undefined || date.format(at) !== previousDay)) return at;
  }
  throw new Error("Не удалось вычислить следующее время запуска.");
}
