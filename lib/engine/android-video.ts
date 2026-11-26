import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import { androidDisplayProfile, androidInputKey, claimAndroid, isAndroidInputBusy, EngineError, requireDevice, sendAndroidInput, validSerial, type InputDisplay } from "./android";
import { appTaskKey, appTasksByDisplay, launchAndroidApp, listAndroidApps } from "./android-apps";
import type { AndroidApp, AndroidInput, AndroidScreen } from "./contracts";
import { openScrcpy } from "./scrcpy";

const maxPacket = 4 * 1024 * 1024;
const keyFlag = 1n << 62n;
const configFlag = 1n << 63n;

type Client = ReadableStreamDefaultController<Uint8Array>;

class VideoSession {
  private clients = new Set<Client>();
  private data: Buffer = Buffer.alloc(0);
  private metadata = false;
  private config: Buffer | null = null;
  private gop: Buffer[] = [];
  private replaySize = 0;
  private idle?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(private socket: Socket, private cleanup: () => void, private persistent = false) {
    socket.on("data", (data) => this.receive(Buffer.isBuffer(data) ? data : Buffer.from(data)));
    socket.on("error", () => this.close());
    socket.on("close", () => this.close());
    this.scheduleStop();
    socket.resume();
  }

  subscribe(signal: AbortSignal) {
    let client: Client;
    const detach = () => {
      this.clients.delete(client);
      signal.removeEventListener("abort", abort);
      if (!this.clients.size) this.scheduleStop();
    };
    const abort = () => {
      if (this.clients.has(client)) client.close();
      detach();
    };
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        client = controller;
        if (this.closed || signal.aborted) { controller.close(); return; }
        clearTimeout(this.idle);
        this.clients.add(controller);
        signal.addEventListener("abort", abort, { once: true });
        if (this.config) controller.enqueue(this.config);
        for (const packet of this.gop) controller.enqueue(packet);
      },
      cancel: detach,
    }, { highWaterMark: maxPacket, size: (chunk) => chunk.byteLength });
  }

  capturePackets() {
    if (this.closed || !this.config || !this.gop.length) throw new EngineError("FRAME_INVALID");
    return Buffer.concat([this.config, ...this.gop].map((packet) => packet.subarray(12)));
  }

  private scheduleStop() {
    clearTimeout(this.idle);
    if (!this.closed && !this.persistent) this.idle = setTimeout(() => this.close(), 3500);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idle);
    this.socket.destroy();
    for (const client of this.clients) client.close();
    this.clients.clear();
    this.cleanup();
  }

  private receive(chunk: Buffer) {
    if (this.closed) return;
    this.data = this.data.length ? Buffer.concat([this.data, chunk]) : chunk;
    if (!this.metadata) {
      if (this.data.length < 12) return;
      if (this.data.toString("ascii", 0, 4) !== "h264") { this.close(); return; }
      this.data = this.data.subarray(12);
      this.metadata = true;
    }
    while (this.data.length >= 12) {
      const length = this.data.readUInt32BE(8);
      if (!length || length > maxPacket) { this.close(); return; }
      if (this.data.length < 12 + length) return;
      const packet = this.data.subarray(0, 12 + length);
      const flags = packet.readBigUInt64BE(0);
      this.data = this.data.subarray(packet.length);
      if (flags & configFlag) {
        this.config = packet;
        this.gop = [];
        this.replaySize = 0;
      } else {
        if (flags & keyFlag) { this.gop = []; this.replaySize = 0; }
        if ((flags & keyFlag) || this.gop.length) {
          this.replaySize += packet.length;
          if (this.replaySize <= maxPacket / 2) this.gop.push(packet);
          else this.gop = [];
        }
      }
      for (const client of this.clients) {
        if ((client.desiredSize ?? 0) > 0) client.enqueue(packet);
        else { this.clients.delete(client); client.close(); }
      }
      if (!this.clients.size && !this.idle) this.scheduleStop();
    }
  }
}

const globalVideo = globalThis as typeof globalThis & { hashpixVideo?: Map<string, Promise<VideoSession>> };
const sessions = globalVideo.hashpixVideo ??= new Map<string, Promise<VideoSession>>();

async function start(serial: string) {
  const { socket, cleanup } = await openScrcpy(serial, "video");
  return new VideoSession(socket, () => {
    sessions.delete(serial);
    cleanup();
  });
}

export async function androidVideo(serial: string, signal: AbortSignal) {
  let session = sessions.get(serial);
  if (!session) {
    if (sessions.size >= 8) throw new EngineError("ENGINE_BUSY");
    session = start(serial).catch((error) => { sessions.delete(serial); throw error; });
    sessions.set(serial, session);
  }
  return (await session).subscribe(signal);
}

type VirtualScreen = { video: VideoSession; display: InputDisplay; app: AndroidApp; view: AndroidScreen };
type VirtualEntry = { serial: string; start: Promise<VirtualScreen>; screen?: VirtualScreen };
const globalScreens = globalThis as typeof globalThis & { hashpixVirtualScreens?: Map<string, VirtualEntry> };
const virtualScreens = globalScreens.hashpixVirtualScreens ??= new Map<string, VirtualEntry>();

export function validScreenId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{20}$/.test(value);
}

function screenKey(serial: string, id: string) {
  return serial + "/" + id;
}

export async function listVirtualScreens(): Promise<AndroidScreen[]> {
  const current = [...virtualScreens.values()].flatMap(({ screen }) => screen ? [screen] : []);
  const pending = current.filter((screen) => screen.view.awaitingConfirmation);
  await Promise.all([...new Set(pending.map((screen) => screen.view.serial))].map(async (serial) => {
    const displays = await appTasksByDisplay(serial).catch(() => null);
    for (const screen of pending.filter((item) => item.view.serial === serial)) {
      if (displays?.get(screen.display.id)?.has(appTaskKey(screen.app))) screen.view.awaitingConfirmation = false;
    }
  }));
  return current.map((screen) => screen.view);
}

export async function openVirtualScreen(serial: string, id: string) {
  if (!validSerial(serial) || !validScreenId(id)) throw new EngineError("INVALID_REQUEST");
  const key = screenKey(serial, id);
  const existing = virtualScreens.get(key);
  if (existing) return (await existing.start).view;
  if (virtualScreens.size >= 9) throw new EngineError("ENGINE_BUSY");
  if ([...virtualScreens.values()].filter((entry) => entry.serial === serial).length >= 3) {
    throw new EngineError("SCREEN_LIMIT");
  }

  const start = Promise.resolve().then(async () => {
    await requireDevice(serial);
    const app = (await listAndroidApps(serial)).find((entry) => entry.id === id);
    if (!app) throw new EngineError("APP_UNAVAILABLE");
    const { width, height, dpi } = await androidDisplayProfile(serial);
    const { socket, cleanup, displayId } = await openScrcpy(serial, { width, height, dpi });
    if (!displayId) { cleanup(); throw new EngineError("SCREEN_UNAVAILABLE"); }
    const video = new VideoSession(socket, () => {
      if (virtualScreens.get(key)?.start === start) virtualScreens.delete(key);
      cleanup();
    }, true);
    try {
      await launchAndroidApp(serial, app, displayId);
      const view: AndroidScreen = { serial, id, appId: app.id, label: app.label, user: app.user, awaitingConfirmation: app.user === 999 || undefined };
      const screen = { video, display: { id: displayId, width, height }, app, view };
      const entry = virtualScreens.get(key);
      if (!entry || entry.start !== start) throw new EngineError("SCREEN_UNAVAILABLE");
      entry.screen = screen;
      return screen;
    } catch (error) {
      video.close();
      throw error;
    }
  }).catch((error) => {
    if (virtualScreens.get(key)?.start === start) virtualScreens.delete(key);
    throw error;
  });
  virtualScreens.set(key, { serial, start });
  return (await start).view;
}

export async function getVirtualScreen(serial: string, id: string) {
  if (!validSerial(serial) || !validScreenId(id)) throw new EngineError("INVALID_REQUEST");
  const entry = virtualScreens.get(screenKey(serial, id));
  if (!entry) throw new EngineError("SCREEN_UNAVAILABLE");
  const screen = await entry.start;
  if (virtualScreens.get(screenKey(serial, id)) !== entry) throw new EngineError("SCREEN_UNAVAILABLE");
  return screen;
}

export async function sendVirtualScreenInput(serial: string, id: string, input: AndroidInput) {
  const { display } = await getVirtualScreen(serial, id);
  const owner = "manual:" + id;
  const release = claimAndroid(androidInputKey(serial, display), owner);
  try { await sendAndroidInput(serial, input, owner, display); }
  finally { release(); }
}

export async function relaunchVirtualScreen(serial: string, id: string) {
  const screen = await getVirtualScreen(serial, id);
  const release = claimAndroid(androidInputKey(serial, screen.display), "relaunch:" + id);
  try { await launchAndroidApp(serial, screen.app, screen.display.id); }
  finally { release(); }
}

export async function closeVirtualScreen(serial: string, id: string) {
  const entry = virtualScreens.get(screenKey(serial, id));
  if (!entry) return;
  const screen = await entry.start;
  if (isAndroidInputBusy(serial, screen.display)) throw new EngineError("ENGINE_BUSY");
  screen.video.close();
}

export async function virtualScreenVideo(serial: string, id: string, signal: AbortSignal) {
  return (await getVirtualScreen(serial, id)).video.subscribe(signal);
}

export async function virtualScreenFrame(serial: string, id: string, signal: AbortSignal) {
  const { video } = await getVirtualScreen(serial, id);
  const packets = video.capturePackets();
  return new Promise<Buffer>((done, fail) => {
    const child = spawn(process.env.HASHPIX_FFMPEG_PATH || "ffmpeg",
      ["-v", "error", "-f", "h264", "-i", "pipe:0", "-vf", "reverse", "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"],
      { signal, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => fail(new EngineError("SCREEN_CAPTURE_UNAVAILABLE")));
    child.on("close", (code) => {
      if (code !== 0 || !chunks.length) fail(new EngineError("SCREEN_CAPTURE_UNAVAILABLE"));
      else done(Buffer.concat(chunks));
    });
    child.stdin.end(packets);
  });
}
