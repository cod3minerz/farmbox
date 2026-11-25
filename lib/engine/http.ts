import { EngineError } from "./android";
import { engineErrors, type EngineErrorCode } from "./contracts";

const status: Record<EngineErrorCode, number> = {
  CLONE_CONFIRMATION: 409, SCREEN_CAPTURE_UNAVAILABLE: 503, SCREEN_LIMIT: 409, SCREEN_UNAVAILABLE: 409, APP_UNAVAILABLE: 409, VIDEO_UNAVAILABLE: 503, CONTROL_UNAVAILABLE: 503, ADB_MISSING: 503, ADB_FAILED: 502, ADB_TIMEOUT: 504, INPUT_PERMISSION_DENIED: 403, DEVICE_NOT_FOUND: 404, DEVICE_UNAVAILABLE: 409,
  FRAME_INVALID: 502, FRAME_CHANGED: 409, ENGINE_BUSY: 429, INVALID_REQUEST: 400, FORBIDDEN: 403,
};

const headers = { "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin" };

export async function localEngineRequest(request: Request, action: () => Promise<Response>) {
  try {
    const host = request.headers.get("host") ?? "";
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host) ||
        (origin && origin !== "http://" + host && origin !== "https://" + host) ||
        (site && site !== "same-origin" && site !== "none")) throw new EngineError("FORBIDDEN");
    return await action();
  } catch (error) {
    const code = error instanceof EngineError ? error.code : "ADB_FAILED";
    return Response.json({ code, message: engineErrors[code] }, { status: status[code], headers });
  }
}

export function json(data: unknown) {
  return Response.json(data, { headers });
}

export function png(bytes: Buffer, capturedAt: number) {
  return new Response(new Uint8Array(bytes), {
    headers: { ...headers, "Content-Type": "image/png", "X-Frame-Time": String(capturedAt) },
  });
}
