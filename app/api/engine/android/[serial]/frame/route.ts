import { androidFrame } from "@/lib/engine/android";
import { localEngineRequest, png } from "@/lib/engine/http";

export const runtime = "nodejs";

export function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  return localEngineRequest(request, async () => {
    const { serial } = await params;
    const frame = await androidFrame(serial);
    return png(frame.bytes, frame.capturedAt);
  });
}
