import { EngineError } from "@/lib/engine/android";
import { androidVideo, validScreenId, virtualScreenVideo } from "@/lib/engine/android-video";
import { localEngineRequest } from "@/lib/engine/http";

export const runtime = "nodejs";

export function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  return localEngineRequest(request, async () => {
    const { serial } = await params;
    const screen = new URL(request.url).searchParams.get("screen");
    if (screen !== null && !validScreenId(screen)) throw new EngineError("INVALID_REQUEST");
    const video = screen ? await virtualScreenVideo(serial, screen, request.signal) : await androidVideo(serial, request.signal);
    return new Response(video, { headers: {
      "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  });
}
