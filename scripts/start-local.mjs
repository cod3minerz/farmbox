import wordmark from "../lib/hashpix-wordmark.json" with { type: "json" };
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));

const shutdown = new AbortController();
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
  process.once(signal, () => {
    process.exitCode = exitCode;
    shutdown.abort();
  });
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const exists = (path) => access(path).then(() => true, () => false);
const toolsDirectory = resolve(".engine-tools");
const scrcpy = "scrcpy-server-v3.3.4";
const scrcpyDigest = "8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e";

function preventIdleSleep() {
  const windows = process.platform === "win32";
  if (!windows && process.platform !== "darwin") return;

  // Windows clears the request on thread exit. The pipe also closes if Node is killed.
  const windowsScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Name Awake -Namespace Farmbox -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
private static extern uint SetThreadExecutionState(uint flags);

public static void HoldUntilInputCloses() {
    const uint continuous = 0x80000000;
    const uint systemRequired = 0x00000001;
    if (SetThreadExecutionState(continuous | systemRequired) == 0)
        throw new System.InvalidOperationException("SetThreadExecutionState failed.");

    try {
        System.Console.OpenStandardInput().ReadByte();
    } finally {
        SetThreadExecutionState(continuous);
    }
}
'@
[Farmbox.Awake]::HoldUntilInputCloses()
`;
  const encoded = Buffer.from(windowsScript, "utf16le").toString("base64");
  const child = windows
    ? spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      stdio: ["pipe", "ignore", "inherit"],
      windowsHide: true,
    })
    : spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });

  let stopping = false;
  const warn = (reason) => {
    if (!stopping && !shutdown.signal.aborted) {
      console.warn(`Не удалось удерживать компьютер от автоматического сна. ${reason}`);
    }
  };
  child.once("error", (error) => warn(error.message));
  child.once("exit", (code, signal) => warn(`Системная команда завершилась (${signal ?? code}).`));
  // The child may exit before Node gets a chance to close the pipe.
  child.stdin?.on("error", () => {});

  return () => {
    stopping = true;
    if (windows) child.stdin.end();
    else child.kill();
  };
}

function run(command, args, label, onOutput) {
  shutdown.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stdio = onOutput ? ["inherit", "pipe", "inherit"] : "inherit";
    const child = spawn(command, args, { stdio, signal: shutdown.signal });
    if (onOutput) createInterface({ input: child.stdout }).on("line", onOutput);
    let spawnError;
    child.once("error", (error) => { spawnError = error; });
    child.once("close", (code, signal) => {
      if (spawnError) reject(spawnError);
      else if (code === 0) resolve();
      else reject(new Error(`${label}: ${signal ?? `код ${code}`}`));
    });
  });
}

async function buildFingerprint(installFingerprint) {
  const hash = createHash("sha256");
  const publicEnv = Object.entries(process.env).filter(([key]) => key.startsWith("NEXT_PUBLIC_")).sort();
  hash.update(JSON.stringify([installFingerprint, process.version, publicEnv]));

  async function addInputs(directory, include) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (!include(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await addInputs(path, (name) => name !== ".DS_Store");
      else if (entry.isFile() || entry.isSymbolicLink()) {
        hash.update(JSON.stringify([path, sha256(await readFile(path))]));
      }
    }
  }

  await addInputs(".", (name) => ["app", "components", "lib", "public", "package.json", "tsconfig.json", "jsconfig.json",
    ".env", ".env.local", ".env.production", ".env.production.local"].includes(name)
    || /^(?:(?:next|postcss|tailwind)\.config|instrumentation(?:-client)?|proxy|middleware)\./.test(name));
  return hash.digest("hex");
}

async function prepareProductionBuild(node, next, installFingerprint) {
  const buildStamp = resolve(".next/.hashpix-build");
  const buildId = resolve(".next/BUILD_ID");
  const before = await buildFingerprint(installFingerprint);
  const previousBuild = await readFile(buildId, "utf8").catch(() => "");
  const stamp = await readFile(buildStamp, "utf8").catch(() => "");
  if (previousBuild && stamp === JSON.stringify([before, previousBuild])) return;

  await rm(buildStamp, { force: true });
  console.log("Собираем локальную панель…");
  await run(node, [next, "build"], "Сборка панели");
  const currentBuild = await readFile(buildId, "utf8").catch(() => "");
  if (currentBuild && before === await buildFingerprint(installFingerprint)) {
    await writeFile(buildStamp, JSON.stringify([before, currentBuild]));
  }
}

function showReadyScreen(port) {
  const { isTTY, columns, rows } = process.stdout;
  const url = `http://127.0.0.1:${port}`;
  const stop = "Остановить · Ctrl+C";
  if (!isTTY || process.env.TERM === "dumb" || columns < 44 || rows < 14) {
    console.log(`\nHASHPIX\n${url}\n${stop}`);
    return;
  }

  const scale = Math.min(4, Math.floor((columns - 9) / 35));
  const pixels = wordmark.map((row) => row.split("|")
    .map((glyph) => Array.from(glyph, (pixel) => pixel.repeat(scale)).join(""))
    .join(" "));
  const width = pixels[0].length + 1;
  const logo = [...pixels, ""].map((row, y) => Array.from({ length: width }, (_, x) => {
    if (row[x] === "#") return "█";
    return pixels[y - 1]?.[x - 1] === "#" ? "░" : " ";
  }).join(""));
  const lines = [...logo, "", url, stop];
  const centered = lines.map((line) => " ".repeat(Math.floor((columns - line.length) / 2)) + line);
  const top = "\n".repeat(Math.floor((rows - lines.length) / 2));
  process.stdout.write(`\x1b[2J\x1b[H${top}${centered.join("\n")}\n`);
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(120_000)]),
  });
  if (!response.ok) throw new Error(`Скачивание не удалось (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareAndroidTools() {
  const { platform } = process;
  const adb = platform === "win32" ? "adb.exe" : "adb";
  const platformTools = resolve(toolsDirectory, "platform-tools");
  const adbPath = process.env.HASHPIX_ADB_PATH || resolve(platformTools, adb);
  const scrcpyPath = process.env.HASHPIX_SCRCPY_SERVER || resolve(toolsDirectory, scrcpy);
  const needsAdb = !process.env.HASHPIX_ADB_PATH && !(await exists(adbPath));
  const needsScrcpy = !process.env.HASHPIX_SCRCPY_SERVER && !(await exists(scrcpyPath));
  if (!needsAdb && !needsScrcpy) return;

  await mkdir(toolsDirectory, { recursive: true });
  const staging = await mkdtemp(resolve(toolsDirectory, "setup-"));
  try {
    if (needsAdb) {
      const archivePlatform = { darwin: "darwin", win32: "windows", linux: "linux" }[platform];
      if (!archivePlatform) throw new Error("Для этой ОС укажите путь к ADB через HASHPIX_ADB_PATH.");
      console.log("Скачиваем Android Platform-Tools (ADB)…");
      const archive = resolve(staging, "platform-tools.zip");
      const url = `https://dl.google.com/android/repository/platform-tools-latest-${archivePlatform}.zip`;
      await writeFile(archive, await download(url));
      const [extractor, args] = {
        darwin: ["ditto", ["-x", "-k", archive, staging]],
        win32: ["tar.exe", ["-xf", archive, "-C", staging]],
        linux: ["unzip", ["-q", archive, "-d", staging]],
      }[platform];
      const extracted = resolve(staging, "platform-tools");
      await run(extractor, args, "Распаковка Android Platform-Tools");
      await access(resolve(extracted, adb));
      await rm(platformTools, { recursive: true, force: true });
      await rename(extracted, platformTools);
    }
    if (needsScrcpy) {
      console.log("Скачиваем scrcpy для видео и управления…");
      const data = await download(`https://github.com/Genymobile/scrcpy/releases/download/v3.3.4/${scrcpy}`);
      if (sha256(data) !== scrcpyDigest) throw new Error("Контрольная сумма scrcpy не совпала.");
      const file = resolve(staging, scrcpy);
      await writeFile(file, data);
      await rename(file, scrcpyPath);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

let allowIdleSleep;
try {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Укажите корректный порт в PORT.");
  allowIdleSleep = preventIdleSleep();
  const node = process.execPath;
  const next = resolve("node_modules/next/dist/bin/next");
  const installStamp = resolve("node_modules/.hashpix-install");
  const lock = await readFile("package-lock.json");
  const fingerprint = `${process.platform}/${process.arch}/${process.versions.modules}/${sha256(lock)}`;
  if (!(await exists(next)) || (await readFile(installStamp, "utf8").catch(() => "")) !== fingerprint) {
    console.log("Устанавливаем зависимости проекта…");
    await run(node, [process.env.npm_execpath, "ci", "--include=dev"], "Установка зависимостей");
    await writeFile(installStamp, fingerprint);
  }
  await prepareAndroidTools();
  await prepareProductionBuild(node, next, fingerprint);
  let ready = false;
  await run(node, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], "Запуск панели", (line) => {
    console.log(line);
    if (!ready && /\bReady in\b/.test(stripVTControlCharacters(line))) {
      ready = true;
      showReadyScreen(port);
    }
  });
} catch (error) {
  if (!shutdown.signal.aborted) {
    console.error(`Не удалось запустить Hashpix Automation. ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  allowIdleSleep?.();
}
