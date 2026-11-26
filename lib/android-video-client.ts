import type { AndroidTarget } from "./engine/contracts";
import { videoChannelError, videoChannelHeaderSize, videoConfigFlag, videoKeyFlag, videoPacketLimit } from "./video-protocol";

type Listener = ReadableStreamDefaultController<Uint8Array>;
type Channel = {
  target: AndroidTarget;
  listeners: Map<Listener, (message: string) => void>;
  config?: Uint8Array;
  replay: Uint8Array[];
  replaySize: number;
};

const channels = new Map<string, Channel>();
let connection: AbortController | undefined;
let connected: Channel[] = [];
let pending: ReturnType<typeof setTimeout> | undefined;

function scheduleConnection() {
  if (pending !== undefined) return;
  pending = setTimeout(() => {
    pending = undefined;
    const next = [...channels.values()];
    if (next.length === connected.length && next.every((channel, index) => connected[index] === channel)) return;
    connection?.abort();
    connected = next;
    if (next.length) {
      connection = new AbortController();
      void receiveVideo(next, connection.signal);
    }
  }, 20);
}

function remove(channel: Channel) {
  for (const [key, value] of channels) {
    if (channel === value) {
      channels.delete(key);
      scheduleConnection();
      break;
    }
  }
}

function fail(channel: Channel, message: string) {
  for (const listener of channel.listeners.keys()) listener.error(new Error(message));
  channel.listeners.clear();
  remove(channel);
}

function publish(channel: Channel, packet: Uint8Array) {
  if (!channel.listeners.size) return;
  if (packet.byteLength < 12) throw new Error("Некорректный пакет видео.");
  const flags = new DataView(packet.buffer, packet.byteOffset, 8).getBigUint64(0);
  if (flags & videoConfigFlag) channel.config = packet;
  if (flags & (videoConfigFlag | videoKeyFlag)) {
    channel.replay = [];
    channel.replaySize = 0;
  }
  if ((flags & videoKeyFlag) || channel.replay.length) {
    channel.replaySize += packet.byteLength;
    if (channel.replaySize <= videoPacketLimit) channel.replay.push(packet);
    else channel.replay = [];
  }
  for (const listener of channel.listeners.keys()) {
    if ((listener.desiredSize ?? 0) > 0) listener.enqueue(packet);
    else {
      listener.error(new Error("Видеопоток отстал. Переподключаемся…"));
      channel.listeners.delete(listener);
    }
  }
  if (!channel.listeners.size) remove(channel);
}

async function receiveVideo(active: Channel[], signal: AbortSignal) {
  try {
    const response = await fetch("/api/engine/android/videos", {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify(active.map((channel) => channel.target)), signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(data?.message ?? "Не удалось подключить видеопоток.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer: Uint8Array = new Uint8Array();
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      if (!buffer.byteLength) buffer = value;
      else {
        const joined = new Uint8Array(buffer.byteLength + value.byteLength);
        joined.set(buffer);
        joined.set(value, buffer.byteLength);
        buffer = joined;
      }
      while (buffer.byteLength >= videoChannelHeaderSize) {
        const header = new DataView(buffer.buffer, buffer.byteOffset, videoChannelHeaderSize);
        const id = header.getUint16(0);
        const size = header.getUint32(2);
        const channel = active[id & ~videoChannelError];
        if (!channel || !size || size > videoPacketLimit + 12) throw new Error("Некорректный пакет видеопотока.");
        if (buffer.byteLength < size + videoChannelHeaderSize) break;
        const packet = buffer.subarray(videoChannelHeaderSize, videoChannelHeaderSize + size);
        if (id & videoChannelError) {
          channel.config = undefined;
          channel.replay = [];
          channel.replaySize = 0;
          const message = decoder.decode(packet);
          for (const onError of channel.listeners.values()) onError(message);
        } else publish(channel, packet);
        buffer = buffer.subarray(videoChannelHeaderSize + size);
      }
    }
    if (!signal.aborted) throw new Error("Видеопоток прерван. Переподключаемся…");
  } catch (error) {
    if (!signal.aborted) {
      const message = error instanceof Error && !(error instanceof TypeError) ? error.message : "Не удалось получить видео. Переподключаемся…";
      for (const channel of active) fail(channel, message);
    }
  }
}

export function subscribeAndroidVideo(target: AndroidTarget, signal: AbortSignal, onError: (message: string) => void) {
  const key = target.serial + "/" + (target.screen ?? "main");
  let detach: (() => void) | undefined;
  return new ReadableStream<Uint8Array>({
    start(listener) {
      if (signal.aborted) { listener.close(); return; }
      let channel = channels.get(key);
      if (!channel) {
        channel = { target, listeners: new Map(), replay: [], replaySize: 0 };
        channels.set(key, channel);
        scheduleConnection();
      }
      const current = channel;
      current.listeners.set(listener, onError);
      const abort = () => {
        if (current.listeners.has(listener)) listener.close();
        detach?.();
      };
      detach = () => {
        signal.removeEventListener("abort", abort);
        current.listeners.delete(listener);
        if (!current.listeners.size) remove(current);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (current.config) listener.enqueue(current.config);
      for (const packet of current.replay) listener.enqueue(packet);
    },
    cancel() { detach?.(); },
  }, { highWaterMark: videoPacketLimit + 1024, size: (packet) => packet.byteLength });
}
