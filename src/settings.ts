import type { HugoConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { migrateConfig, wrapVersionedPayload } from "./data-migrations";

const SETTINGS_KEY = "hugo-config";

let pluginInstance: {
  loadData: (key: string) => Promise<unknown>;
  saveData: (key: string, value: unknown) => Promise<unknown>;
};

/**
 * Registers the plugin instance used to persist configuration data.
 *
 * @param plugin Plugin instance exposing load and save helpers.
 */
export function initSettings(plugin: typeof pluginInstance): void {
  pluginInstance = plugin;
}

/**
 * Loads the persisted plugin configuration.
 *
 * @returns The stored configuration or defaults when missing.
 */
export async function loadConfig(): Promise<HugoConfig> {
  try {
    const data = await pluginInstance.loadData(SETTINGS_KEY);
    return migrateConfig(data);
  } catch {
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Saves the plugin configuration with schema version metadata.
 *
 * @param config Configuration to persist.
 */
export async function saveConfig(config: HugoConfig): Promise<void> {
  await pluginInstance.saveData(SETTINGS_KEY, wrapVersionedPayload(config));
}
