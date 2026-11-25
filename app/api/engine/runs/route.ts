import { EngineError } from "@/lib/engine/android";
import { parseRunTargets } from "@/lib/engine/run-targets";
import { json, localEngineRequest } from "@/lib/engine/http";
import { listDeviceRuns, startDeviceRuns } from "@/lib/engine/runs";
import { validateDeviceGraph } from "@/lib/workflow-steps";
import type { Workflow } from "@/lib/demo";

export const runtime = "nodejs";

export function GET(request: Request) {
  return localEngineRequest(request, async () => json({ runs: listDeviceRuns() }));
}

export function POST(request: Request) {
  return localEngineRequest(request, async () => {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new EngineError("INVALID_REQUEST");
    let body: { workflow: Workflow; serial?: unknown; targets?: unknown };
    try {
      const text = await request.text();
      if (text.length > 150000) throw new Error();
      body = JSON.parse(text);
      if (!body || typeof body !== "object") throw new Error();
    } catch { throw new EngineError("INVALID_REQUEST"); }
    const targets = parseRunTargets(body.targets ?? [{ serial: body.serial }]);
    try { validateDeviceGraph(body.workflow); }
    catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Проверьте сценарий." }, { status: 422 }); }
    const runs = await startDeviceRuns(body.workflow, targets);
    return json({ run: runs[0], runs });
  });
}
