import { EngineError } from "@/lib/engine/android";
import { json, localEngineRequest } from "@/lib/engine/http";
import { readWorkflowLibrary, updateWorkflowLibrary, WorkflowConflict } from "@/lib/engine/workflow-library";

export const runtime = "nodejs";

export function GET(request: Request) {
  return localEngineRequest(request, async () => json(readWorkflowLibrary()));
}

export function POST(request: Request) {
  return localEngineRequest(request, async () => {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new EngineError("INVALID_REQUEST");
    const text = await request.text();
    if (text.length > 8_000_000) throw new EngineError("INVALID_REQUEST");
    let input: unknown;
    try { input = JSON.parse(text); }
    catch { throw new EngineError("INVALID_REQUEST"); }
    try { return json(updateWorkflowLibrary(input)); }
    catch (error) {
      if (error instanceof EngineError) throw error;
      return Response.json({ message: error instanceof Error ? error.message : "Не удалось сохранить сценарии." },
        { status: error instanceof WorkflowConflict ? 409 : 422 });
    }
  });
}
