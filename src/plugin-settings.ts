import { Setting } from "siyuan";

import { DEFAULT_CONFIG, type HugoConfig } from "./types";
import { saveConfig } from "./settings";
import { validateHugoProject } from "./image-handler";
import { createStorageAdapter } from "./storage-adapter";
import { openPathExplorer } from "./path-explorer";

interface SetupPluginSettingsOptions {
  getConfig: () => HugoConfig;
  onConfigChange: (config: HugoConfig) => void;
  runOrphanCleanup: () => Promise<void>;
  onPreserveDocTreeChange: (enabled: boolean) => Promise<void>;
}

type FieldMap = Record<string, HTMLInputElement | HTMLSelectElement>;

function getConfigValue(config: HugoConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key];
}

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
    publishMode: (fields.publishMode as HTMLSelectElement).value as HugoConfig["publishMode"],
    gitRepoUrl: (fields.gitRepoUrl as HTMLInputElement)?.value.trim() ?? "",
    gitBranch: (fields.gitBranch as HTMLInputElement)?.value.trim() || "main",
    gitToken: (fields.gitToken as HTMLInputElement)?.value.trim() ?? "",
  };
}

/**
 * Returns the closest ancestor `<li>` of an element — the row container
 * used by SiYuan's Setting component.
 */
function settingRow(el: HTMLElement): HTMLElement | null {
  return el.closest("li") as HTMLElement | null;
}

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

export function setupPluginSettings(options: SetupPluginSettingsOptions): Setting {
  const fields: FieldMap = {};
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Elements whose rows are hidden/shown based on publish mode
  const fsOnlyEls: HTMLElement[] = [];   // visible in filesystem mode only
  const gitOnlyEls: HTMLElement[] = [];  // visible in git mode only

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

  /**
   * Shows/hides setting rows based on the currently selected publish mode.
   * Uses el.closest('li') to reach the full row rendered by SiYuan's Setting API.
   */
  const applyModeVisibility = () => {
    const isGit = (fields.publishMode as HTMLSelectElement)?.value === "git";
    for (const el of fsOnlyEls) {
      const row = settingRow(el);
      if (row) row.style.display = isGit ? "none" : "";
    }
    for (const el of gitOnlyEls) {
      const row = settingRow(el);
      if (row) row.style.display = isGit ? "" : "none";
    }
  };

  installSettingsDialogObserver();

  const setting = new Setting({});

  // ---------------------------------------------------------------------------
  // 1. Publish mode  (always visible — drives show/hide of groups below)
  // ---------------------------------------------------------------------------

  setting.addItem({
    title: "Publish mode",
    description: "Filesystem: write via SiYuan shared volume. Git: push directly to a GitHub repository.",
    createActionElement: () => {
      const select = document.createElement("select");
      select.className = "b3-select fn__flex-1";
      [
        { value: "filesystem", label: "Filesystem (shared volume)" },
        { value: "git",        label: "Git (GitHub repository)" },
      ].forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        opt.selected = getConfig().publishMode === value;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => { scheduleSave(); applyModeVisibility(); });
      fields.publishMode = select;
      // Apply initial visibility once the rows are in the DOM
      setTimeout(applyModeVisibility, 0);
      return select;
    },
  });

  // ---------------------------------------------------------------------------
  // 2. Filesystem-only fields
  // ---------------------------------------------------------------------------

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
        const testConfig = { ...getConfig(), hugoProjectPath: input.value.trim() };
        const result = await validateHugoProject(testConfig, createStorageAdapter(testConfig));
        testBtn.textContent = result.valid ? "OK" : "KO";
        testBtn.title = result.valid ? "" : (result.error ?? "");
        setTimeout(() => { testBtn.textContent = "Test"; testBtn.disabled = false; }, 2500);
      });

      wrap.appendChild(inputWrap);
      wrap.appendChild(browseBtn);
      wrap.appendChild(testBtn);
      fsOnlyEls.push(wrap);
      return wrap;
    },
  });

  setting.addItem({
    title: "Content directory",
    description: "Relative path from Hugo root",
    createActionElement: () => {
      const el = createTextField(fields, "contentDir", getConfig, scheduleSave, "content/posts");
      fsOnlyEls.push(el);
      return el;
    },
  });

  setting.addItem({
    title: "Images directory",
    description: "Relative path inside /static/",
    createActionElement: () => {
      const el = createTextField(fields, "staticDir", getConfig, scheduleSave, "static/images");
      fsOnlyEls.push(el);
      return el;
    },
  });

  // ---------------------------------------------------------------------------
  // 3. Git-only fields
  // ---------------------------------------------------------------------------

  setting.addItem({
    title: "Git repository URL",
    description: "GitHub HTTPS URL (e.g. https://github.com/owner/repo.git)",
    createActionElement: () => {
      const el = createTextField(fields, "gitRepoUrl", getConfig, scheduleSave, "https://github.com/owner/repo.git");
      gitOnlyEls.push(el);
      return el;
    },
  });

  setting.addItem({
    title: "Git branch",
    description: "Target branch for published content (default: main)",
    createActionElement: () => {
      const el = createTextField(fields, "gitBranch", getConfig, scheduleSave, "main");
      gitOnlyEls.push(el);
      return el;
    },
  });

  setting.addItem({
    title: "Git token",
    description: "GitHub Personal Access Token with repo write access",
    createActionElement: () => {
      const wrap = document.createElement("div");
      wrap.className = "fn__flex fn__flex-1";
      wrap.style.gap = "8px";

      const tokenInput = document.createElement("input");
      tokenInput.type = "password";
      tokenInput.className = "b3-text-field fn__flex-1";
      tokenInput.value = String(getConfig().gitToken ?? "");
      tokenInput.placeholder = "ghp_xxxxxxxxxxxxxxxxxxxx";
      tokenInput.addEventListener("change", scheduleSave);
      fields.gitToken = tokenInput;

      const testBtn = document.createElement("button");
      testBtn.className = "b3-button b3-button--outline";
      testBtn.textContent = "Test";
      testBtn.style.whiteSpace = "nowrap";
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = "…";
        const testConfig = buildConfigFromFields(fields);
        const result = await validateHugoProject(testConfig, createStorageAdapter(testConfig));
        testBtn.textContent = result.valid ? "OK" : "KO";
        testBtn.title = result.valid ? "" : (result.error ?? "");
        setTimeout(() => { testBtn.textContent = "Test"; testBtn.disabled = false; }, 2500);
      });

      wrap.appendChild(tokenInput);
      wrap.appendChild(testBtn);
      gitOnlyEls.push(wrap);
      return wrap;
    },
  });

  // ---------------------------------------------------------------------------
  // 4. Common fields
  // ---------------------------------------------------------------------------

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
