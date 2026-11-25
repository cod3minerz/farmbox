"use client";

import { useSyncExternalStore } from "react";
import { initial, type DemoState } from "./demo";

const key = "hashpix-automation-demo-v1";
const listeners = new Set<() => void>();
let current: DemoState | undefined;

function receiveStorage(event: StorageEvent) {
  if (event.key !== key && event.key !== null) return;
  current = undefined;
  listeners.forEach((listener) => listener());
}

function snapshot(): DemoState {
  if (!current) {
    try {
      const raw = localStorage.getItem(key);
      current = raw ? JSON.parse(raw) as DemoState : initial;
    } catch {
      current = initial;
    }
  }
  return current;
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", receiveStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", receiveStorage);
  };
}

export function useDemo() {
  return useSyncExternalStore(subscribe, snapshot, () => initial);
}

export function useDemoReady() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export function updateDemo(change: (state: DemoState) => DemoState) {
  current = change(snapshot());
  try { localStorage.setItem(key, JSON.stringify(current)); } catch { /* The demo remains available in memory. */ }
  listeners.forEach((listener) => listener());
}
