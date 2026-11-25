import { listVirtualScreens } from "@/lib/engine/android-video";
import { listAndroid } from "@/lib/engine/android";
import { json, localEngineRequest } from "@/lib/engine/http";

export const runtime = "nodejs";

export function GET(request: Request) {
  return localEngineRequest(request, async () => json({ devices: await listAndroid(), screens: await listVirtualScreens() }));
}
