import { Setting } from "siyuan";

import { DEFAULT_CONFIG, type HugoConfig } from "./types";
import { saveConfig } from "./settings";
import { validateHugoProject } from "./image-handler";
import { openPathExplorer } from "./path-explorer";

interface SetupPluginSettingsOptions {
  getConfig: () => HugoConfig;
  onConfigChange: (config: HugoConfig) => void;
  runOrphanCleanup: () => Promise<void>;
  onPreserveDocTreeChange: (enabled: boolean) => Promise<void>;
}

type FieldMap = Record<string, HTMLInputElement | HTMLSelectElement>;

/**
 * Reads a typed configuration value through a dynamic key.
 *
 * @param config Current plugin configuration.
 * @param key Configuration key to read.
 * @returns The raw configuration value.
 */
function getConfigValue(config: HugoConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key];
}

/**
 * Creates a text input bound to a configuration field.
 *
 * @param fields Field registry updated with the created element.
 * @param key Configuration field key.
 * @param getConfig Callback returning the current config.
 * @param onChange Change handler used to persist updates.
 * @param placeholder Optional placeholder text.
 * @returns The created input element.
 */
function createTextField(
  fields: FieldMap,
  key: string,
  getConfig: () => HugoConfig,
  onChange: () => void,
  placeholder = ""
): HTMLInputElement {
  const el = document.createElement("input");
  el.className = "b3-text-field fn__flex-1";
  el.value = String(getConfigValue(getConfig(), key) ?? "");
  el.placeholder = placeholder;
  el.addEventListener("change", onChange);
  fields[key] = el;
  return el;
}

/**
 * Creates a numeric input bound to a configuration field.
 *
 * @param fields Field registry updated with the created element.
 * @param key Configuration field key.
 * @param getConfig Callback returning the current config.
 * @param onChange Change handler used to persist updates.
 * @param min Minimum allowed value.
 * @param placeholder Optional placeholder text.
 * @returns The created numeric input element.
 */
function createNumberField(
  fields: FieldMap,
  key: string,
  getConfig: () => HugoConfig,
  onChange: () => void,
  min: number,
  placeholder = ""
): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "number";
  el.min = String(min);
  el.className = "b3-text-field fn__flex-1";
  el.value = String(getConfigValue(getConfig(), key) ?? "");
  el.placeholder = placeholder;
  el.addEventListener("change", onChange);
  fields[key] = el;
  return el;
}

/**
 * Creates a checkbox input bound to a boolean configuration field.
 *
 * @param fields Field registry updated with the created element.
 * @param key Configuration field key.
 * @param getConfig Callback returning the current config.
 * @param onChange Change handler used to persist updates.
 * @returns The created checkbox element.
 */
function createSwitchField(
  fields: FieldMap,
  key: string,
  getConfig: () => HugoConfig,
  onChange: () => void
): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "checkbox";
  el.className = "b3-switch fn__flex-center";
  el.checked = Boolean(getConfigValue(getConfig(), key));
  el.addEventListener("change", onChange);
  fields[key] = el;
  return el;
}

/**
 * Rebuilds the plugin configuration object from the settings form fields.
 *
 * @param fields Current settings field registry.
 * @returns The normalized configuration object.
 */
function buildConfigFromFields(fields: FieldMap): HugoConfig {
  return {
    hugoProjectPath: (fields.hugoProjectPath as HTMLInputElement).value.trim(),
    contentDir: (fields.contentDir as HTMLInputElement).value.trim() || "content/posts",
    staticDir: (fields.staticDir as HTMLInputElement).value.trim() || "static/images",
    publishTag: (fields.publishTag as HTMLInputElement).value.trim(),
    language: (fields.language as HTMLInputElement).value.trim(),
    slugMode: (fields.slugMode as HTMLSelectElement).value as HugoConfig["slugMode"],
    defaultDraft: (fields.defaultDraft as HTMLInputElement).checked,
    autoSyncOnSave: (fields.autoSyncOnSave as HTMLInputElement).checked,
    autoCleanOrphans: (fields.autoCleanOrphans as HTMLInputElement).checked,
    badgeRefreshDelayMs: Math.max(100, Number((fields.badgeRefreshDelayMs as HTMLInputElement).value) || 400),
    preserveDocTree: (fields.preserveDocTree as HTMLInputElement).checked,
  };
}

/**
 * Tweaks the native SiYuan settings dialog styling for this plugin panel.
 */
function installSettingsDialogObserver(): void {
  const dialogObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue;
        const dialogs = node.classList.contains("b3-dialog")
          ? [node]
          : Array.from(node.querySelectorAll<HTMLElement>(".b3-dialog"));
        for (const dialog of dialogs) {
          const header = dialog.querySelector<HTMLElement>(".b3-dialog__header");
          if (!header?.textContent?.includes("SiYuan Hugo Publisher")) continue;

          const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            if (textNode.data.includes("SiYuan Hugo Publisher")) {
              textNode.data = "Settings Panel";
              break;
            }
          }

          for (const selector of [".b3-dialog__body", ".config__panel", ".b3-dialog__container"]) {
            const element = dialog.querySelector<HTMLElement>(selector);
            if (element) {
              element.style.background = "var(--b3-theme-background)";
              break;
            }
          }

          for (const selector of [".b3-dialog__action", ".b3-dialog__footer", ".b3-dialog__btns"]) {
            const footer = dialog.querySelector<HTMLElement>(selector);
            if (footer) {
              footer.style.display = "none";
              break;
            }
          }

          dialog.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
            if (["Cancel", "Save", "Annuler", "确认", "取消"].includes(button.textContent?.trim() ?? "")) {
              button.style.display = "none";
            }
          });
        }
      }
    }
  });

  dialogObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Builds the SiYuan settings panel for the plugin configuration.
 *
 * @param options Settings callbacks used to read, save, and trigger actions.
 * @returns The configured SiYuan `Setting` instance.
 */
export function setupPluginSettings(options: SetupPluginSettingsOptions): Setting {
  const fields: FieldMap = {};
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const getConfig = (): HugoConfig => options.getConfig() ?? { ...DEFAULT_CONFIG };
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (!fields.hugoProjectPath) return;
      const nextConfig = buildConfigFromFields(fields);
      options.onConfigChange(nextConfig);
      await saveConfig(nextConfig);
    }, 500);
  };

  installSettingsDialogObserver();

  const setting = new Setting({});

  setting.addItem({
    title: "Hugo project path",
    description: "Ex: /data/hugo-site or /siyuan/workspace/data/hugo-site",
    createActionElement: () => {
      const wrap = document.createElement("div");
      wrap.className = "shp-path-field fn__flex fn__flex-1";

      const input = createTextField(fields, "hugoProjectPath", getConfig, scheduleSave, "/data/hugo-site");
      input.classList.add("shp-path-field__input");

      const inputWrap = document.createElement("div");
      inputWrap.className = "shp-path-field__input-wrap";
      inputWrap.appendChild(input);

      const browseBtn = document.createElement("button");
      browseBtn.className = "b3-button b3-button--outline";
      browseBtn.textContent = "Browse";
      browseBtn.style.whiteSpace = "nowrap";
      browseBtn.addEventListener("click", () => {
        openPathExplorer(input.value.trim(), (selectedPath) => {
          input.value = selectedPath;
          // Trigger change to persist the new value
          input.dispatchEvent(new Event("change"));
        });
      });

      const testBtn = document.createElement("button");
      testBtn.className = "b3-button b3-button--outline";
      testBtn.textContent = "Test";
      testBtn.style.whiteSpace = "nowrap";
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = "…";
        const result = await validateHugoProject({ ...getConfig(), hugoProjectPath: input.value.trim() });
        testBtn.textContent = result.valid ? "OK" : "KO";
        testBtn.title = result.valid ? "" : (result.error ?? "");
        setTimeout(() => {
          testBtn.textContent = "Test";
          testBtn.disabled = false;
        }, 2500);
      });

      wrap.appendChild(inputWrap);
      wrap.appendChild(browseBtn);
      wrap.appendChild(testBtn);
      return wrap;
    },
  });

  setting.addItem({
    title: "Content directory",
    description: "Relative path from Hugo root",
    createActionElement: () => createTextField(fields, "contentDir", getConfig, scheduleSave, "content/posts"),
  });

  setting.addItem({
    title: "Images directory",
    description: "Relative path inside /static/",
    createActionElement: () => createTextField(fields, "staticDir", getConfig, scheduleSave, "static/images"),
  });

  setting.addItem({
    title: "Tag filter",
    description: "Only publish docs with this tag (empty = all)",
    createActionElement: () => createTextField(fields, "publishTag", getConfig, scheduleSave, "publish"),
  });

  setting.addItem({
    title: "Slug mode",
    createActionElement: () => {
      const select = document.createElement("select");
      select.className = "b3-select fn__flex-1";
      [
        { value: "title", label: "Title (recommended)" },
        { value: "id", label: "SiYuan ID" },
      ].forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = getConfig().slugMode === value;
        select.appendChild(option);
      });
      select.addEventListener("change", scheduleSave);
      fields.slugMode = select;
      return select;
    },
  });

  setting.addItem({
    title: "Hugo language",
    description: "Language prefix for multi-lang (e.g. \"fr\" → content/fr/posts/). Empty = disabled",
    createActionElement: () => createTextField(fields, "language", getConfig, scheduleSave, "fr"),
  });

  setting.addItem({
    title: "Publish as draft by default",
    description: "Sets draft: true in front matter",
    createActionElement: () => createSwitchField(fields, "defaultDraft", getConfig, scheduleSave),
  });

  setting.addItem({
    title: "Auto sync on save",
    description: "Automatically re-publish when the document is saved",
    createActionElement: () => createSwitchField(fields, "autoSyncOnSave", getConfig, scheduleSave),
  });

  setting.addItem({
    title: "Badge refresh delay",
    description: "Debounce delay in ms for Sync/Modified detection",
    createActionElement: () => createNumberField(fields, "badgeRefreshDelayMs", getConfig, scheduleSave, 100, "400"),
  });

  setting.addItem({
    title: "Auto clean orphans",
    description: "On startup, remove Hugo pages whose SiYuan document no longer exists",
    createActionElement: () => createSwitchField(fields, "autoCleanOrphans", getConfig, scheduleSave),
  });

  setting.addItem({
    title: "Mirror doc tree structure",
    description: "Replicate SiYuan folder hierarchy in Hugo content directory. Toggling reorganizes existing published notes.",
    createActionElement: () => {
      const checkbox = createSwitchField(fields, "preserveDocTree", getConfig, scheduleSave);
      const previousValue = { current: getConfig().preserveDocTree };

      checkbox.addEventListener("change", async () => {
        const enabled = checkbox.checked;
        if (enabled === previousValue.current) return;
        previousValue.current = enabled;

        if (saveTimer) clearTimeout(saveTimer);
        const nextConfig = buildConfigFromFields(fields);
        options.onConfigChange(nextConfig);
        await saveConfig(nextConfig);

        await options.onPreserveDocTreeChange(enabled);
      });

      return checkbox;
    },
  });

  setting.addItem({
    title: "Clean orphans now",
    description: "Scan Hugo content directory and remove pages with no matching SiYuan document",
    createActionElement: () => {
      const button = document.createElement("button");
      button.className = "b3-button b3-button--outline";
      button.textContent = "Run now";
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Running…";
        await options.runOrphanCleanup();
        button.textContent = "Run now";
        button.disabled = false;
      });
      return button;
    },
  });

  return setting;
}
