import type { HugoConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { migrateConfig, wrapVersionedPayload } from "./data-migrations";

const SETTINGS_KEY = "hugo-config";

let pluginInstance: {
  loadData: (key: string) => Promise<unknown>;
  saveData: (key: string, value: unknown) => Promise<unknown>;
};

export function initSettings(plugin: typeof pluginInstance): void {
  pluginInstance = plugin;
}

export async function loadConfig(): Promise<HugoConfig> {
  try {
    const data = await pluginInstance.loadData(SETTINGS_KEY);
    return migrateConfig(data);
  } catch {
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: HugoConfig): Promise<void> {
  await pluginInstance.saveData(SETTINGS_KEY, wrapVersionedPayload(config));
}
