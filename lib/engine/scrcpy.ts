import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { adb, adbExecutable, EngineError, requireDevice } from "./android";

const version = "3.3.4";
type ScrcpyMode = "video" | "control" | { width: number; height: number; dpi: number } | { controlDisplay: number };
function connect(port: number) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => fail(new Error("scrcpy connection timeout")), 300);
    function dispose() {
      clearTimeout(timeout);
      socket.off("error", fail);
      socket.off("end", ended);
      socket.off("readable", read);
    }
    function fail(error: Error) { dispose(); socket.destroy(); reject(error); }
    function ended() { fail(new Error("scrcpy has not started")); }
    function read() {
      const marker = socket.read(1) as Buffer | null;
      if (!marker) return;
      if (marker[0] !== 0) { fail(new Error("scrcpy handshake")); return; }
      dispose();
      socket.pause();
      resolve(socket);
    }
    socket.on("readable", read);
    socket.once("end", ended);
    socket.once("error", fail);
  });
}

export async function openScrcpy(serial: string, mode: ScrcpyMode) {
  const virtual = typeof mode === "object" && "width" in mode ? mode : undefined;
  const control = mode === "control" || (typeof mode === "object" && "controlDisplay" in mode);
  const unavailable = control ? "CONTROL_UNAVAILABLE" : "VIDEO_UNAVAILABLE";
  await requireDevice(serial);
  const jar = resolve(process.env.HASHPIX_SCRCPY_SERVER ?? ".engine-tools/scrcpy-server-v" + version);
  if (!existsSync(jar)) throw new EngineError(unavailable);
  const samsungVideo = !control && /^samsung$/i.test((await adb(
    ["-s", serial, "shell", "getprop", "ro.product.manufacturer"],
  ).catch(() => Buffer.alloc(0))).toString().trim());
  const id = (randomBytes(4).readUInt32BE(0) & 0x7fffffff).toString(16).padStart(8, "0");
  const remote = "/data/local/tmp/hashpix-scrcpy-" + id + ".jar";
  let port = "";
  let child: ChildProcess | undefined;
  let videoSocket: Socket | undefined;
  const cleanup = () => {
    videoSocket?.destroy();
    child?.kill();
    if (port) void adb(["-s", serial, "forward", "--remove", "tcp:" + port]).catch(() => undefined);
    void adb(["-s", serial, "shell", "rm", "-f", remote]).catch(() => undefined);
  };
  try {
    await adb(["-s", serial, "push", jar, remote]);
    port = (await adb(["-s", serial, "forward", "tcp:0", "localabstract:scrcpy_" + id])).toString().trim();
    if (!/^\d{1,5}$/.test(port)) throw new EngineError(unavailable);
    let displayId: number | undefined;
    const argv = ["app_process", "/", "com.genymobile.scrcpy.Server", version, "scid=" + id,
      "tunnel_forward=true", "send_device_meta=false", "audio=false", "cleanup=false"];
    if (control) {
      argv.push("video=false", "clipboard_autosync=false", "log_level=error");
      if (typeof mode === "object" && "controlDisplay" in mode) argv.push("display_id=" + mode.controlDisplay, "power_on=false");
    } else {
      argv.push("control=false", "max_size=1280", virtual ? "max_fps=15" : "max_fps=30",
        virtual ? "video_bit_rate=1000000" : "video_bit_rate=3000000");
      if (virtual) argv.push("new_display=" + virtual.width + "x" + virtual.height + "/" + virtual.dpi,
        "vd_system_decorations=false");
      // Some Samsung media frameworks abort when app_process's argv reaches 256 bytes (scrcpy #7169).
      if (!samsungVideo) argv.push(virtual ? "log_level=info" : "log_level=error", "video_codec_options=i-frame-interval=1");
      else if (!virtual) argv.push("video_codec_options=i-frame-interval=1");
    }
    child = spawn(adbExecutable(), ["-s", serial, "shell", "CLASSPATH=" + remote, ...argv],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let lastDiagnostic = "";
    child.stderr?.on("data", (chunk: Buffer) => { lastDiagnostic = (lastDiagnostic + chunk.toString()).slice(-2000); });
    child.on("close", (code) => {
      if (code) console.warn("scrcpy exited", { code, mode: control ? "control" : virtual ? "virtual" : "main", detail: lastDiagnostic.trim() });
    });
    if (child.stdout) {
      createInterface({ input: child.stdout }).on("line", (line) => {
        const match = /\bNew display:.*\(id=(\d+)\)/.exec(line);
        if (match) displayId = Number(match[1]);
        if (/\[server\]\s+(?:ERROR|WARN):/.test(line)) lastDiagnostic = (lastDiagnostic + "\n" + line).slice(-2000);
      });
    }
    child.on("error", () => undefined);
    for (let attempt = 0; attempt < 22; attempt++) {
      if (child.exitCode !== null) break;
      const socket = await connect(Number(port)).catch(() => null);
      if (socket) {
        videoSocket = socket;
        if (virtual) {
          socket.on("error", () => undefined);
          for (let check = 0; check < 35 && !displayId && !socket.destroyed && child.exitCode === null; check++) await delay(100);
          if (!displayId || socket.destroyed) throw new EngineError(unavailable);
        }
        return { socket, cleanup, displayId };
      }
      await delay(100);
    }
    throw new EngineError(unavailable);
  } catch (error) {
    cleanup();
    throw error;
  }
}
