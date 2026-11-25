import { EngineError, validSerial } from "@/lib/engine/android";
import { closeVirtualScreen, openVirtualScreen, relaunchVirtualScreen, validScreenId } from "@/lib/engine/android-video";
import { json, localEngineRequest } from "@/lib/engine/http";

export const runtime = "nodejs";

type Parameters = { params: Promise<{ serial: string; screen: string }> };

export function POST(request: Request, { params }: Parameters) {
  return localEngineRequest(request, async () => {
    const { serial, screen } = await params;
    if (!validSerial(serial) || !validScreenId(screen)) throw new EngineError("INVALID_REQUEST");
    return json({ screen: await openVirtualScreen(serial, screen) });
  });
}

export function PATCH(request: Request, { params }: Parameters) {
  return localEngineRequest(request, async () => {
    const { serial, screen } = await params;
    if (!validSerial(serial) || !validScreenId(screen)) throw new EngineError("INVALID_REQUEST");
    await relaunchVirtualScreen(serial, screen);
    return json({ requested: true });
  });
}

export function DELETE(request: Request, { params }: Parameters) {
  return localEngineRequest(request, async () => {
    const { serial, screen } = await params;
    if (!validSerial(serial) || !validScreenId(screen)) throw new EngineError("INVALID_REQUEST");
    await closeVirtualScreen(serial, screen);
    return json({ closed: true });
  });
}
