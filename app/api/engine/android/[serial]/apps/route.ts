import { listAndroidApps } from "@/lib/engine/android-apps";
import { json, localEngineRequest } from "@/lib/engine/http";

export const runtime = "nodejs";

export function GET(request: Request, { params }: { params: Promise<{ serial: string }> }) {
  return localEngineRequest(request, async () => json({ apps: await listAndroidApps((await params).serial) }));
}
