import { json, localEngineRequest } from "@/lib/engine/http";
import { stopDeviceRun } from "@/lib/engine/runs";

export const runtime = "nodejs";

export function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return localEngineRequest(request, async () => {
    const { id } = await params;
    return json({ stopped: stopDeviceRun(id) });
  });
}
