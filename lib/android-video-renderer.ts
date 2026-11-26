import { subscribeAndroidVideo } from "./android-video-client";
import { videoConfigFlag as configFlag, videoKeyFlag as keyFlag } from "./video-protocol";

export type VideoStatus = { ready: boolean; fps: number; error: string };
type Listener = { draw: (frame: VideoFrame) => void; status: (value: VideoStatus) => void };
const renderers = new Map<string, ReturnType<typeof createRenderer>>();

const timestampMask = keyFlag - 1n;

function concat(first: Uint8Array, second: Uint8Array) {
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first);
  bytes.set(second, first.length);
  return bytes;
}

function profile(bytes: Uint8Array) {
  for (let i = 2; i + 3 < bytes.length; i++) {
    if (bytes[i - 2] === 0 && bytes[i - 1] === 0 && bytes[i] === 1 && (bytes[i + 1] & 31) === 7 && i + 4 < bytes.length) {
      return "avc1." + [...bytes.slice(i + 2, i + 5)].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
  }
  return null;
}

function createRenderer(serial: string, screen: string | undefined) {
  const listeners = new Set<Listener>();
  let current: VideoStatus = { ready: false, fps: 0, error: "" };
  let latest: VideoFrame | undefined;
  let stopped = false;
  let idle: ReturnType<typeof setTimeout> | undefined;

  function update(status: VideoStatus) {
    current = status;
    for (const listener of listeners) listener.status(status);
  }

  let active: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  async function play() {
    if (stopped || active || document.hidden) return;
    const connection = new AbortController();
    active = connection;
    let decoder: VideoDecoder | null = null;
    let codec: string | null = null;
    let count = 0;
    let first = true;
    let recovering = false;
    let period = performance.now();
    let firstFrame: ReturnType<typeof setTimeout> | undefined;
    let failure = "";
    try {
      if (typeof VideoDecoder === "undefined") throw new Error("Для этого потока откройте панель в Chrome или Edge с WebCodecs.");
      const stream = subscribeAndroidVideo({ serial, screen }, connection.signal, (message) => {
        clearTimeout(firstFrame);
        recovering = true;
        update({ ...current, fps: 0, error: message });
      });
      firstFrame = setTimeout(() => {
        update({ ...current, fps: 0, error: "Экран пока не прислал первый кадр." });
      }, 10000);
      decoder = new VideoDecoder({
        output(frame) {
          if (connection.signal.aborted) { frame.close(); return; }
          latest?.close();
          latest = frame;
          for (const { draw } of listeners) draw(frame);
          if (first) clearTimeout(firstFrame);
          count++;
          const now = performance.now();
          if (first || recovering || now - period >= 1000) {
            update({ ready: true, fps: first || recovering ? 0 : Math.round(count * 1000 / (now - period)), error: "" });
            count = 0;
            period = now;
            first = false;
            recovering = false;
          }
        },
        error() {
          failure = "Браузер не смог декодировать H.264. Переподключаемся…";
          connection.abort();
        },
      });
      const reader = stream.getReader();
      let config: Uint8Array | null = null;
      let waitForKey = true;
      while (!connection.signal.aborted) {
        const { done, value: packet } = await reader.read();
        if (done || connection.signal.aborted) break;
        const flags = new DataView(packet.buffer, packet.byteOffset, 12).getBigUint64(0);
        const data = packet.subarray(12);
        if (flags & configFlag) { config = data; waitForKey = true; continue; }
        const key = Boolean(flags & keyFlag);
        if (decoder.decodeQueueSize > 8 && !key) { waitForKey = true; continue; }
        if (!key && waitForKey) continue;
        if (key && config && (waitForKey || !codec)) {
          codec = profile(config);
          if (!codec) continue;
          if (decoder.state === "configured") decoder.reset();
          decoder.configure({ codec, optimizeForLatency: true });
          waitForKey = false;
        }
        if (decoder.state !== "configured") continue;
        decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: Number(flags & timestampMask), data: key && config ? concat(config, data) : data }));
      }
      if (!connection.signal.aborted) throw new Error("Соединение прервано. Переподключаемся…");
    } catch (error) {
      if (!connection.signal.aborted) failure = error instanceof Error ? error.message : "Поток недоступен.";
    } finally {
      clearTimeout(firstFrame);
      const interrupted = connection.signal.aborted;
      if (decoder?.state !== "closed") decoder?.close();
      connection.abort();
      active = null;
      if (!stopped && !document.hidden) {
        if (failure) {
          update({ ...current, fps: 0, error: failure });
          if (typeof VideoDecoder !== "undefined") retry = setTimeout(play, 1400);
        } else if (interrupted) {
          // The tab may have returned while its previous stream was closing.
          void play();
        }
      }
    }
  }

  function visibility() {
    clearTimeout(retry);
    if (document.hidden) {
      active?.abort();
      if (current.fps) update({ ...current, fps: 0 });
    } else void play();
  }

  void play();
  document.addEventListener("visibilitychange", visibility);

  return {
    subscribe(listener: Listener, onIdle: () => void) {
      clearTimeout(idle);
      listeners.add(listener);
      if (latest) listener.draw(latest);
      listener.status(current);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          idle = setTimeout(() => {
            stopped = true;
            document.removeEventListener("visibilitychange", visibility);
            clearTimeout(retry);
            active?.abort();
            latest?.close();
            onIdle();
          }, 300);
        }
      };
    },
  };
}

export function renderAndroidVideo(serial: string, screen: string | undefined, listener: Listener) {
  const key = serial + "/" + (screen ?? "main");
  let renderer = renderers.get(key);
  if (!renderer) {
    renderer = createRenderer(serial, screen);
    renderers.set(key, renderer);
  }
  return renderer.subscribe(listener, () => renderers.delete(key));
}
