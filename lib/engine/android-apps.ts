import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { adb, EngineError, requireDevice } from "./android";
import type { AndroidApp } from "./contracts";

const asset = resolve("lib/engine/assets/android-catalog.jar");
const cached = new Map<string, { until: number; apps: Promise<AndroidApp[]> }>();
const componentPattern = /^[a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+$/;

function appId(user: number, packageName: string) {
  return createHash("sha256").update(user + ":" + packageName).digest("hex").slice(0, 20);
}

async function installedApps(serial: string, profiles: number[]) {
  const remote = "/data/local/tmp/hashpix-catalog-" + randomBytes(7).toString("hex") + ".jar";
  await adb(["-s", serial, "push", asset, remote]);
  try {
    await adb(["-s", serial, "shell", "chmod", "444", remote]);
    const apps: AndroidApp[] = [];
    for (const user of profiles) {
      try {
        const output = (await adb(["-s", serial, "shell", "CLASSPATH=" + remote, "app_process", "/", "io.hashpix.android.Catalog", String(user)], 8 * 1024 * 1024, 15000)).toString();
        for (const line of output.split(/\r?\n/)) {
          if (!line.startsWith("{")) continue;
          const row = JSON.parse(line) as { user: number; package: string; component: string; label: string; icon?: string };
          const component = row.package + "/" + row.component;
          if (user !== row.user || !componentPattern.test(component)) continue;
          apps.push({ id: appId(user, row.package), package: row.package, component, user,
            label: row.label.slice(0, 120), icon: row.icon ? "data:image/png;base64," + row.icon : undefined });
        }
      } catch {
        apps.push(...await fallbackApps(serial, [user]));
      }
    }
    const icons = new Map(apps.filter((app) => app.user === 0).map((app) => [app.package, app]));
    return apps.map((app) => ({ ...app, icon: app.icon ?? icons.get(app.package)?.icon, label: app.label === app.package ? icons.get(app.package)?.label ?? app.label : app.label }));
  } finally {
    await adb(["-s", serial, "shell", "rm", "-f", remote]).catch(() => undefined);
  }
}

async function fallbackApps(serial: string, profiles: number[]) {
  const lists = await Promise.all(profiles.map(async (user) => {
    const output = (await adb(["-s", serial, "shell", "cmd", "package", "query-activities", "--brief", "--user", String(user),
      "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER"])).toString();
    const packages = new Map<string, AndroidApp>();
    for (const line of output.split(/\r?\n/)) {
      const component = line.trim();
      if (!componentPattern.test(component)) continue;
      const name = component.split("/")[0];
      if (!packages.has(name)) packages.set(name, { id: appId(user, name), package: name, component, user, label: name });
    }
    return [...packages.values()];
  }));
  return lists.flat();
}

export async function listAndroidApps(serial: string) {
  await requireDevice(serial);
  const previous = cached.get(serial);
  if (previous && Date.now() < previous.until) return previous.apps;
  const apps = (async () => {
    const users = (await adb(["-s", serial, "shell", "pm", "list", "users"])).toString();
    const profiles = [0, ...[...users.matchAll(/UserInfo\{(\d+):[^\r\n}]+\}[^\r\n]*\brunning\b/g)].map((match) => Number(match[1])).filter((id) => id !== 0)];
    const entries = await installedApps(serial, profiles).catch(() => fallbackApps(serial, profiles));
    return entries.sort((a, b) => a.label.localeCompare(b.label, "ru") || a.user - b.user);
  })();
  cached.set(serial, { apps, until: Date.now() + 20000 });
  try { return await apps; }
  catch (error) { if (cached.get(serial)?.apps === apps) cached.delete(serial); throw error; }
}

export async function launchAndroidApp(serial: string, app: Pick<AndroidApp, "component" | "user">, displayId: number) {
  if (!componentPattern.test(app.component) || !Number.isSafeInteger(app.user)) throw new EngineError("INVALID_REQUEST");
  const result = (await adb(["-s", serial, "shell", "am", "start", "--user", String(app.user), "--display", String(displayId),
    "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", "'" + app.component + "'"])).toString();
  if (/Error:|Exception/i.test(result) || !result.includes("Starting:")) throw new EngineError("APP_UNAVAILABLE");
}

export async function appTasksByDisplay(serial: string) {
  const output = (await adb(["-s", serial, "shell", "dumpsys", "activity", "activities"], 2 * 1024 * 1024)).toString();
  const displays = new Map<number, Set<string>>();
  let tasks: Set<string> | undefined;
  for (const line of output.split(/\r?\n/)) {
    const display = /^Display #(\d+) \(activities from top to bottom\):/.exec(line);
    if (display) {
      tasks = new Set<string>();
      displays.set(Number(display[1]), tasks);
    } else {
      const activity = /Hist #\d+: ActivityRecord\{\S+ u(\d+) ([\w.]+)\//.exec(line);
      if (activity) tasks?.add(activity[1] + ":" + activity[2]);
    }
  }
  return displays;
}

export function appTaskKey(app: AndroidApp) {
  return app.user + ":" + app.package;
}
