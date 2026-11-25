export const sections = {
  devices: "Устройства",
  overview: "Обзор",
  automations: "Автоматизации",
  content: "Контент",
  publications: "Публикации",
  runs: "Запуски",
  integrations: "Интеграции",
  settings: "Настройки",
} as const;

export type Section = keyof typeof sections;

export function isSection(value: string): value is Section {
  return Object.hasOwn(sections, value);
}
