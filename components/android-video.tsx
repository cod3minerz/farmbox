"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { renderAndroidVideo, type VideoStatus } from "@/lib/android-video-renderer";
import { Smartphone } from "./icons";
import type { AndroidInput } from "@/lib/engine/contracts";

type Gesture = Extract<AndroidInput, { kind: "tap" | "swipe" }>;
export function AndroidVideo({ serial, label, screen, onGesture, overlay }: { serial: string; label: string; screen?: string; overlay?: ReactNode; onGesture?: (gesture: Gesture) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  const [status, setStatus] = useState<VideoStatus>({ ready: false, fps: 0, error: "" });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;
    return renderAndroidVideo(serial, screen, {
      draw(frame) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        context.drawImage(frame, 0, 0);
      },
      status: setStatus,
    });
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
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { ...point(event), at: performance.now() };
      } : undefined}
      onPointerUp={onGesture ? (event) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
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
