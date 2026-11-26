import { setTimeout as delay } from "node:timers/promises";
import { EngineError, validSerial } from "@/lib/engine/android";
import { androidVideo, validScreenId, virtualScreenVideo } from "@/lib/engine/android-video";
import { engineErrors, type AndroidTarget } from "@/lib/engine/contracts";
import { localEngineRequest } from "@/lib/engine/http";
import { videoChannelError, videoChannelHeaderSize, videoPacketLimit } from "@/lib/video-protocol";

export const runtime = "nodejs";

function parseTargets(body: string): AndroidTarget[] {
  try {
    if (body.length > 7000) throw new Error();
    const targets: unknown = JSON.parse(body);
    if (!Array.isArray(targets) || !targets.length || targets.length > 32) throw new Error();
    const keys = new Set<string>();
    return targets.map((target) => {
      if (!target || typeof target.serial !== "string" || !validSerial(target.serial) ||
        (target.screen !== undefined && !validScreenId(target.screen))) throw new Error();
      const key = target.serial + "/" + (target.screen ?? "main");
      if (keys.has(key)) throw new Error();
      keys.add(key);
      return { serial: target.serial, screen: target.screen };
    });
  } catch {
    throw new EngineError("INVALID_REQUEST");
  }
}

function videos(targets: AndroidTarget[], request: Request) {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, request.signal]);
  const encoder = new TextEncoder();
  const waiting = new Set<() => void>();
  function resume() {
    for (const resolve of waiting) resolve();
    waiting.clear();
  }
  signal.addEventListener("abort", resume, { once: true });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      request.signal.addEventListener("abort", () => {
        if (!lifetime.signal.aborted) controller.close();
      }, { once: true, signal: lifetime.signal });
      function send(channel: number, packet: Uint8Array) {
        const frame = new Uint8Array(videoChannelHeaderSize + packet.byteLength);
        const header = new DataView(frame.buffer);
        header.setUint16(0, channel);
        header.setUint32(2, packet.byteLength);
        frame.set(packet, videoChannelHeaderSize);
        controller.enqueue(frame);
      }

      async function forward({ serial, screen }: AndroidTarget, index: number) {
        while (!signal.aborted) {
          let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
          const subscription = new AbortController();
          const sourceSignal = AbortSignal.any([signal, subscription.signal]);
          try {
            const source = screen ? await virtualScreenVideo(serial, screen, sourceSignal) : await androidVideo(serial, sourceSignal);
            reader = source.getReader();
            while (!signal.aborted) {
              const { done, value } = await reader.read();
              if (done || signal.aborted) break;
              while ((controller.desiredSize ?? 0) <= 0 && !signal.aborted) {
                await new Promise<void>((resolve) => waiting.add(resolve));
              }
              if (!signal.aborted) send(index, value);
            }
            if (!signal.aborted) send(index | videoChannelError, encoder.encode("Видеопоток прерван. Переподключаемся…"));
          } catch (error) {
            if (!signal.aborted) send(index | videoChannelError, encoder.encode(
              error instanceof EngineError ? engineErrors[error.code] : engineErrors.VIDEO_UNAVAILABLE));
          } finally {
            subscription.abort();
            await reader?.cancel().catch(() => undefined);
          }
          if (!signal.aborted) await delay(1600, undefined, { signal }).catch(() => undefined);
        }
      }

      void Promise.all(targets.map(forward)).catch((error) => {
        if (!signal.aborted) controller.error(error);
        lifetime.abort();
      });
    },
    pull: resume,
    cancel() { lifetime.abort(); },
  }, { highWaterMark: videoPacketLimit, size: (frame) => frame.byteLength });
}

export function POST(request: Request) {
  return localEngineRequest(request, async () => {
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new EngineError("INVALID_REQUEST");
    const targets = parseTargets(await request.text());
    return new Response(videos(targets, request), { headers: {
      "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Cross-Origin-Resource-Policy": "same-origin",
    } });
  });
}
