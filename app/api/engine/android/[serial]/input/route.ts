import { sendVirtualScreenInput, validScreenId } from "@/lib/engine/android-video";
import { EngineError, parseInput, sendAndroidInput } from "@/lib/engine/android";
import { json, localEngineRequest } from "@/lib/engine/http";

export const runtime = "nodejs";

export function POST(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  return localEngineRequest(request, async () => {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new EngineError("INVALID_REQUEST");
    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > 2048) throw new Error();
      body = JSON.parse(raw);
    } catch { throw new EngineError("INVALID_REQUEST"); }
    const { serial } = await params;
    const screen = new URL(request.url).searchParams.get("screen");
    if (screen !== null && !validScreenId(screen)) throw new EngineError("INVALID_REQUEST");
    const input = parseInput(body);
    if (screen) await sendVirtualScreenInput(serial, screen, input);
    else await sendAndroidInput(serial, input);
    return json({ accepted: true });
  });
}
