import { EngineError } from "@/lib/engine/android";
import { json, localEngineRequest } from "@/lib/engine/http";
import { changeSchedule } from "@/lib/engine/scheduler";

export const runtime = "nodejs";
type Parameters = { params: Promise<{ id: string }> };

function update(id: string, enabled: boolean | null) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new EngineError("INVALID_REQUEST");
  return changeSchedule(id, enabled) ? json({ updated: true }) : new Response(null, { status: 404 });
}

export function PATCH(request: Request, { params }: Parameters) {
  return localEngineRequest(request, async () => {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new EngineError("INVALID_REQUEST");
    const raw = await request.text();
    let enabled: unknown;
    try {
      if (raw.length > 512) throw new Error();
      enabled = JSON.parse(raw)?.enabled;
    } catch { throw new EngineError("INVALID_REQUEST"); }
    if (typeof enabled !== "boolean") throw new EngineError("INVALID_REQUEST");
    return update((await params).id, enabled);
  });
}

export function DELETE(request: Request, { params }: Parameters) {
  return localEngineRequest(request, async () => update((await params).id, null));
}
