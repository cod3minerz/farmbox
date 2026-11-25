export type AndroidDevice = {
  serial: string;
  model: string;
  state: "ready" | "unauthorized" | "offline" | "unavailable";
  transport: "usb" | "emulator" | "network" | "unknown";
};

export type AndroidApp = { id: string; package: string; component: string; user: number; label: string; icon?: string };
export type AndroidScreen = { serial: string; id: string; label: string; appId: string; user: number; awaitingConfirmation?: boolean };
export type AndroidTarget = { serial: string; screen?: string };
export type AndroidInventory = { devices: AndroidDevice[]; screens?: AndroidScreen[] };

export type EngineErrorCode = "ADB_MISSING" | "ADB_FAILED" | "ADB_TIMEOUT" | "INPUT_PERMISSION_DENIED" | "DEVICE_NOT_FOUND" | "DEVICE_UNAVAILABLE" |
  "FRAME_INVALID" | "FRAME_CHANGED" | "ENGINE_BUSY" | "INVALID_REQUEST" | "FORBIDDEN" | "VIDEO_UNAVAILABLE" | "CONTROL_UNAVAILABLE" | "SCREEN_UNAVAILABLE" | "APP_UNAVAILABLE" | "SCREEN_LIMIT" | "SCREEN_CAPTURE_UNAVAILABLE" | "CLONE_CONFIRMATION";

export type AndroidInput =
  | { kind: "key"; key: "home" | "back" | "wake" }
  | { kind: "tap"; x: number; y: number; width: number; height: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number; width: number; height: number; duration: number };

export const engineErrors: Record<EngineErrorCode, string> = {
  CLONE_CONFIRMATION: "Разблокируйте телефон и подтвердите запуск копии в MIUI перед автоматизацией.",
  SCREEN_LIMIT: "На одном телефоне можно открыть до трёх виртуальных экранов.",
  SCREEN_CAPTURE_UNAVAILABLE: "Снимок виртуального экрана недоступен. Проверьте FFmpeg и видеопоток.",
  SCREEN_UNAVAILABLE: "Виртуальный экран недоступен. Откройте его заново.",
  APP_UNAVAILABLE: "Приложение недоступно на этом устройстве.",
  CONTROL_UNAVAILABLE: "Не удалось передать двойной тап через scrcpy. Проверьте подключение телефона и наличие сервера scrcpy.",
  VIDEO_UNAVAILABLE: "Видеопоток scrcpy недоступен.",
  ADB_MISSING: "Не найден ADB. Установите Android SDK Platform Tools.",
  ADB_FAILED: "ADB не выполнил команду. Проверьте подключение и разрешение отладки.",
  INPUT_PERMISSION_DENIED: "Android запретил жесты по USB. На Xiaomi включите «Отладка по USB (настройки безопасности)» в параметрах разработчика и перезагрузите телефон.",
  ADB_TIMEOUT: "Телефон не ответил вовремя.",
  DEVICE_NOT_FOUND: "Телефон больше не подключён.",
  DEVICE_UNAVAILABLE: "Устройство недоступно для команд. Проверьте USB-отладку.",
  FRAME_INVALID: "Телефон вернул некорректный кадр.",
  FRAME_CHANGED: "Размер экрана изменился. Повторите жест на новом кадре.",
  ENGINE_BUSY: "Устройство или получение кадров занято. Повторите через несколько секунд.",
  INVALID_REQUEST: "Некорректные параметры команды.",
  FORBIDDEN: "Интерфейс устройств доступен только из локальной панели.",
};
