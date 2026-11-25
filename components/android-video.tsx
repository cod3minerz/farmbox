"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Smartphone } from "./icons";
import type { AndroidInput } from "@/lib/engine/contracts";

type Gesture = Extract<AndroidInput, { kind: "tap" | "swipe" }>;
const keyFlag = 1n << 62n;
const configFlag = 1n << 63n;
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

export function AndroidVideo({ serial, label, screen, onGesture, overlay }: { serial: string; label: string; screen?: string; overlay?: ReactNode; onGesture?: (gesture: Gesture) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const [status, setStatus] = useState({ ready: false, fps: 0, error: "" });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;
    const surface = canvas;
    const painter = context;
    let active: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function play() {
      if (active) return;
      const connection = new AbortController();
      active = connection;
      let decoder: VideoDecoder | null = null;
      let codec: string | null = null;
      let count = 0;
      let first = true;
      let period = performance.now();
      try {
        if (typeof VideoDecoder === "undefined") throw new Error("Для этого потока откройте панель в Chrome или Edge с WebCodecs.");
        const res = await fetch("/api/engine/android/" + encodeURIComponent(serial) + "/video" + (screen ? "?screen=" + encodeURIComponent(screen) : ""), { signal: connection.signal, cache: "no-store" });
        if (!res.ok || !res.body) {
          const payload = await res.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message ?? "Видеопоток недоступен.");
        }
        decoder = new VideoDecoder({
          output(frame) {
            try {
              if (connection.signal.aborted) return;
              if (surface.width !== frame.displayWidth || surface.height !== frame.displayHeight) {
                surface.width = frame.displayWidth;
                surface.height = frame.displayHeight;
              }
              painter.drawImage(frame, 0, 0);
              count++;
              const now = performance.now();
              if (first || now - period >= 1000) {
                setStatus({ ready: true, fps: first ? 0 : Math.round(count * 1000 / (now - period)), error: "" });
                if (!first) { count = 0; period = now; }
                first = false;
              }
            } finally { frame.close(); }
          },
          error() {
            codec = null;
          },
        });
        const reader = res.body.getReader();
        let buffer: Uint8Array = new Uint8Array();
        let config: Uint8Array | null = null;
        let waitForKey = true;
        while (!connection.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = concat(buffer, value);
          while (buffer.length >= 12) {
            const header = new DataView(buffer.buffer, buffer.byteOffset, 12);
            const flags = header.getBigUint64(0);
            const size = header.getUint32(8);
            if (!size || size > 4 * 1024 * 1024) throw new Error("Некорректный пакет видео.");
            if (buffer.length < size + 12) break;
            const data = buffer.subarray(12, size + 12);
            buffer = buffer.subarray(size + 12);
            if (flags & configFlag) { config = data; waitForKey = true; continue; }
            const key = Boolean(flags & keyFlag);
            if (decoder.state === "closed") throw new Error("Не удалось декодировать H.264.");
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
        }
        if (!connection.signal.aborted) throw new Error("Соединение прервано. Переподключаемся…");
      } catch (error) {
        if (!connection.signal.aborted) {
          setStatus((old) => ({ ...old, fps: 0, error: error instanceof Error ? error.message : "Поток недоступен." }));
          if (typeof VideoDecoder !== "undefined") retry = setTimeout(play, 1400);
        }
      } finally {
        if (decoder?.state !== "closed") decoder?.close();
        connection.abort();
        if (active === connection) active = null;
      }
    }

    function visibility() {
      if (document.hidden) return;
      clearTimeout(retry);
      void play();
    }

    void play();
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); clearTimeout(retry); active?.abort(); };
  }, [serial, screen]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const limit = (n: number) => Math.min(1, Math.max(0, n));
    return { x: limit((event.clientX - box.left) / box.width), y: limit((event.clientY - box.top) / box.height) };
  }

  return <span className="android-preview">
    {!status.ready && <span className="android-placeholder"><Smartphone size={22} /><span>{status.error || "Подключаем видеопоток…"}</span></span>}
    <span className="android-video-surface" hidden={!status.ready}><canvas ref={canvasRef} hidden={!status.ready} role="img" aria-label={"Экран " + label}
      className={onGesture ? "android-stream android-stream-interactive" : "android-stream"}
      onPointerDown={onGesture ? (event) => {
        if (event.button !== 0 || status.error) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { ...point(event), at: performance.now() };
      } : undefined}
      onPointerUp={onGesture ? (event) => {
        const from = start.current;
        start.current = null;
        if (!from || status.error) return;
        const to = point(event);
        const dimensions = { width: event.currentTarget.width, height: event.currentTarget.height };
        if (Math.hypot(from.x - to.x, from.y - to.y) < 0.025) onGesture({ ...dimensions, ...to, kind: "tap" });
        else onGesture({ ...dimensions, x: from.x, y: from.y, toX: to.x, toY: to.y, kind: "swipe",
          duration: Math.max(100, Math.min(2000, Math.round(performance.now() - from.at))) });
      } : undefined}
      onPointerCancel={() => { start.current = null; }} />{overlay && <span className="android-video-overlay">{overlay}</span>}</span>
    {status.ready && <small className="android-frame-time">{status.error || (status.fps ? status.fps + " FPS" : "Видеопоток")}</small>}
  </span>;
}
