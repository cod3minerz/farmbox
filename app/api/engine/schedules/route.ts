import { EngineError } from "@/lib/engine/android";
import { json, localEngineRequest } from "@/lib/engine/http";
import { parseRunTargets } from "@/lib/engine/run-targets";
import { addSchedule, listSchedules, parseTiming, removeWorkflowSchedules } from "@/lib/engine/scheduler";
import type { Workflow } from "@/lib/demo";

export const runtime = "nodejs";

export function GET(request: Request) {
  return localEngineRequest(request, async () => json({ schedules: listSchedules() }));
}

export function DELETE(request: Request) {
  return localEngineRequest(request, async () => {
    const workflowId = new URL(request.url).searchParams.get("workflowId");
    if (!workflowId || workflowId.length > 100) throw new EngineError("INVALID_REQUEST");
    removeWorkflowSchedules(workflowId);
    return json({ removed: true });
  });
}

export function POST(request: Request) {
  return localEngineRequest(request, async () => {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new EngineError("INVALID_REQUEST");
    let body: { workflow: Workflow; targets: unknown; timing: unknown; preempt?: unknown };
    try {
      const text = await request.text();
      if (text.length > 150000) throw new Error();
      body = JSON.parse(text);
      if (!body || typeof body !== "object") throw new Error();
    } catch { throw new EngineError("INVALID_REQUEST"); }
    const targets = parseRunTargets(body.targets);
    const timing = parseTiming(body.timing);
    try {
      return json({ schedule: addSchedule(body.workflow, targets, timing, body.preempt === true) });
    } catch (error) {
      if (error instanceof EngineError) throw error;
      return Response.json({ message: error instanceof Error ? error.message : "Не удалось сохранить расписание." }, { status: 422 });
    }
  });
}
