import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AndroidDevice, AndroidInput, EngineErrorCode } from "./contracts";

export class EngineError extends Error {
  constructor(public readonly code: EngineErrorCode) {
    super(code);
  }
}

type Frame = { bytes: Buffer; capturedAt: number; width: number; height: number };
type SharedEngine = {
  inventory: AndroidDevice[];
  inventoryAt: number;
  listing?: Promise<AndroidDevice[]>;
  captures: Map<string, Promise<Frame>>;
  frames: Map<string, Frame>;
  input: Set<string>;
  owners: Map<string, string>;
};

const globals = globalThis as typeof globalThis & { hashpixAndroidEngine?: SharedEngine };
const shared: SharedEngine = globals.hashpixAndroidEngine ??= { inventory: [], inventoryAt: 0, captures: new Map(), frames: new Map(), input: new Set(), owners: new Map() };

export function adbExecutable() {
  const name = process.platform === "win32" ? "adb.exe" : "adb";
  if (process.env.HASHPIX_ADB_PATH) return resolve(process.env.HASHPIX_ADB_PATH);
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, resolve(".engine-tools")];
  return candidates.map((path) => path && resolve(path, "platform-tools", name))
    .find((path): path is string => Boolean(path && existsSync(path))) ?? name;
}

export function adb(args: string[], maxBuffer = 192 * 1024, timeout = 5000) {
  return new Promise<Buffer>((done, fail) => {
    execFile(adbExecutable(), args, { encoding: "buffer", maxBuffer, timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error?.code === "ENOENT") return fail(new EngineError("ADB_MISSING"));
      if (error?.killed && error.signal === "SIGTERM") return fail(new EngineError("ADB_TIMEOUT"));
      if (args[2] === "shell" && args[3] === "input") {
        const diagnostic = stderr.toString("utf8") + "\n" + stdout.toString("utf8");
        if (/\bINJECT_EVENTS\b|input event injection[^\n]*permission denied|SecurityException[^\n]*inject/i.test(diagnostic)) {
          return fail(new EngineError("INPUT_PERMISSION_DENIED"));
        }
      }
      if (error) return fail(new EngineError("ADB_FAILED"));
      done(stdout);
    });
  });
}

export function validSerial(serial: string) {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(serial);
}

export function parseInventory(text: string): AndroidDevice[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const [serial, state, ...properties] = line.trim().split(/\s+/);
    if (!serial || !state || !validSerial(serial) || line.startsWith("List of devices")) return [];
    // Ignore diagnostic lines that do not have a recognized ADB state.
    const states: Record<string, AndroidDevice["state"]> = { device: "ready", unauthorized: "unauthorized", offline: "offline", recovery: "unavailable", sideload: "unavailable", bootloader: "unavailable", connecting: "unavailable", authorizing: "unauthorized", no: "unavailable" };
    const normalized = Object.hasOwn(states, state) ? states[state] : null;
    if (!normalized) return [];
    const model = properties.find((property) => property.startsWith("model:"))?.slice(6).replaceAll("_", " ") || "Android";
    const transport = serial.startsWith("emulator-") ? "emulator" : properties.some((property) => property.startsWith("usb:")) ? "usb" : serial.includes(":") || serial.endsWith("_adb-tls-connect._tcp.") ? "network" : "unknown";
    return [{ serial, model, state: normalized, transport }];
  });
}

export async function listAndroid() {
  if (Date.now() - shared.inventoryAt < 750) return shared.inventory;
  if (!shared.listing) {
    shared.listing = adb(["devices", "-l"]).then((output) => {
      const devices = parseInventory(output.toString("utf8"));
      shared.inventory = devices;
      shared.inventoryAt = Date.now();
      for (const serial of shared.frames.keys()) {
        if (!devices.some((device) => device.serial === serial && device.state === "ready")) shared.frames.delete(serial);
      }
      return devices;
    }).finally(() => { shared.listing = undefined; });
  }
  return shared.listing;
}

export async function requireDevice(serial: string) {
  if (!validSerial(serial)) throw new EngineError("INVALID_REQUEST");
  const device = (await listAndroid()).find((item) => item.serial === serial);
  if (!device) throw new EngineError("DEVICE_NOT_FOUND");
  if (device.state !== "ready") throw new EngineError("DEVICE_UNAVAILABLE");
}

const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function androidFrame(serial: string, refresh = false): Promise<Frame> {
  await requireDevice(serial);
  const cached = shared.frames.get(serial);
  if (!refresh && cached && Date.now() - cached.capturedAt < 650) return cached;
  const pending = shared.captures.get(serial);
  if (pending) return pending;
  if (shared.captures.size >= 3) throw new EngineError("ENGINE_BUSY");
  const capture = adb(["-s", serial, "exec-out", "screencap", "-p"], 16 * 1024 * 1024).then((bytes) => {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngHeader) || bytes.toString("ascii", 12, 16) !== "IHDR") {
      throw new EngineError("FRAME_INVALID");
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height || width > 16384 || height > 16384) throw new EngineError("FRAME_INVALID");
    const frame = { bytes, capturedAt: Date.now(), width, height };
    shared.frames.set(serial, frame);
    return frame;
  }).finally(() => { shared.captures.delete(serial); });
  shared.captures.set(serial, capture);
  return capture;
}

function percent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 16384;
}

export function parseInput(value: unknown): AndroidInput {
  if (!value || typeof value !== "object") throw new EngineError("INVALID_REQUEST");
  const data = value as Record<string, unknown>;
  if (data.kind === "key" && (data.key === "home" || data.key === "back" || data.key === "wake")) return { kind: "key", key: data.key };
  if (percent(data.x) && percent(data.y) && dimension(data.width) && dimension(data.height)) {
    const point = { x: data.x, y: data.y, width: data.width, height: data.height };
    if (data.kind === "tap") return { ...point, kind: "tap" };
    if (data.kind === "swipe" && percent(data.toX) && percent(data.toY) && typeof data.duration === "number" &&
        Number.isInteger(data.duration) && data.duration >= 100 && data.duration <= 2000) {
      return { ...point, kind: "swipe", toX: data.toX, toY: data.toY, duration: data.duration };
    }
  }
  throw new EngineError("INVALID_REQUEST");
}

export function claimAndroid(serial: string, owner: string) {
  if (shared.owners.has(serial) || shared.input.has(serial)) throw new EngineError("ENGINE_BUSY");
  shared.owners.set(serial, owner);
  return () => { if (shared.owners.get(serial) === owner) shared.owners.delete(serial); };
}

export async function androidDisplay(serial: string) {
  await requireDevice(serial);
  const text = (await adb(["-s", serial, "shell", "dumpsys", "input"], 1024 * 1024)).toString();
  const display = /Viewport INTERNAL: displayId=0[^\n]*logicalFrame=\[0, 0, (\d+), (\d+)\]/.exec(text);
  if (!display) {
    const frame = await androidFrame(serial);
    return { width: frame.width, height: frame.height };
  }
  return { width: Number(display[1]), height: Number(display[2]) };
}

export async function androidDisplayProfile(serial: string) {
  await requireDevice(serial);
  const [rawSize, rawDensity] = await Promise.all([
    adb(["-s", serial, "shell", "wm", "size"]),
    adb(["-s", serial, "shell", "wm", "density"]),
  ]);
  const size = /(?:Override|Physical) size:\s*(\d+)x(\d+)/g;
  const density = /(?:Override|Physical) density:\s*(\d+)/g;
  const dimensions = [...rawSize.toString().matchAll(size)].at(-1);
  const dpi = Number([...rawDensity.toString().matchAll(density)].at(-1)?.[1]);
  if (!dimensions || !Number.isInteger(dpi) || dpi < 72 || dpi > 2000) throw new EngineError("FRAME_INVALID");
  const width = Number(dimensions[1]), height = Number(dimensions[2]);
  if (!dimension(width) || !dimension(height)) throw new EngineError("FRAME_INVALID");
  return { width, height, dpi };
}

export type InputDisplay = { id: number; width: number; height: number };

export function androidInputKey(serial: string, display?: InputDisplay) {
  return display ? serial + "/" + display.id : serial;
}

export function isAndroidInputBusy(serial: string, display: InputDisplay) {
  const key = androidInputKey(serial, display);
  return shared.input.has(key) || shared.owners.has(key);
}

export async function sendAndroidInput(serial: string, input: AndroidInput, owner?: string, display?: InputDisplay) {
  await requireDevice(serial);
  const target = androidInputKey(serial, display);
  if (shared.input.has(target) || (shared.owners.has(target) && shared.owners.get(target) !== owner)) throw new EngineError("ENGINE_BUSY");
  shared.input.add(target);
  try {
    let command: string[];
    if (input.kind === "key") {
      if (display && input.key === "wake") throw new EngineError("INVALID_REQUEST");
      command = ["keyevent", { home: "KEYCODE_HOME", back: "KEYCODE_BACK", wake: "KEYCODE_WAKEUP" }[input.key]];
    } else {
      const frame = display ?? await androidDisplay(serial);
      // Encoded video is scaled. Reject a gesture if the viewport orientation or aspect changed.
      if (Math.abs((input.width / input.height) / (frame.width / frame.height) - 1) > 0.06) throw new EngineError("FRAME_CHANGED");
      const toPixel = (value: number, size: number) => String(Math.round(value * (size - 1)));
      const start = [toPixel(input.x, frame.width), toPixel(input.y, frame.height)];
      command = input.kind === "tap" ? ["tap", ...start] : [
        "swipe", ...start, toPixel(input.toX, frame.width), toPixel(input.toY, frame.height), String(input.duration),
      ];
    }
    await adb(["-s", serial, "shell", "input", ...(display ? ["-d", String(display.id)] : []), ...command]);
    if (!display) shared.frames.delete(serial);
  } finally {
    shared.input.delete(target);
  }
}
