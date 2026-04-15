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
  onSlugModeChange: (mode: HugoConfig["slugMode"]) => Promise<void>;
}

type FieldMap = Record<string, HTMLInputElement | HTMLSelectElement>;

// ---------------------------------------------------------------------------
// Field creation helpers
// ---------------------------------------------------------------------------

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

/**
 * Creates a relative-directory field (text input + Browse + Test).
 */
function createRelativeDirField(
  fields: FieldMap,
  key: string,
  getConfig: () => HugoConfig,
  scheduleSave: () => void,
  placeholder: string
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "shp-path-field fn__flex fn__flex-1";

  const input = createTextField(fields, key, getConfig, scheduleSave, placeholder);
  input.classList.add("shp-path-field__input");

  const inputWrap = document.createElement("div");
  inputWrap.className = "shp-path-field__input-wrap";
  inputWrap.appendChild(input);

  const browseBtn = document.createElement("button");
  browseBtn.className = "b3-button b3-button--outline";
  browseBtn.textContent = "Browse";
  browseBtn.style.whiteSpace = "nowrap";
  browseBtn.addEventListener("click", () => {
    const base = (fields.hugoProjectPath as HTMLInputElement)?.value.trim() ?? "";
    const start = base ? `${base}/${input.value.trim()}` : input.value.trim();
    openPathExplorer(start, (selected) => {
      input.value = base && selected.startsWith(base)
        ? selected.slice(base.length).replace(/^\/+/, "")
        : selected;
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
    try {
      const cfg = { ...getConfig(), [key]: input.value.trim() };
      const adapter = createStorageAdapter(cfg);
      const relativeDir = String(getConfigValue(cfg, key) ?? "");
      const dirPath = `${adapter.hugoBase}/${relativeDir}`;
      await adapter.listDir(dirPath);
      testBtn.textContent = "OK";
      testBtn.title = "";
    } catch (err) {
      testBtn.textContent = "KO";
      testBtn.title = err instanceof Error ? err.message : String(err);
    }
    setTimeout(() => { testBtn.textContent = "Test"; testBtn.disabled = false; }, 2500);
  });

  wrap.appendChild(inputWrap);
  wrap.appendChild(browseBtn);
  wrap.appendChild(testBtn);
  return wrap;
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

// ---------------------------------------------------------------------------
// Sidebar DOM builders
// ---------------------------------------------------------------------------

/**
 * Creates a settings row: [title + description stacked left] [action right].
 */
function buildRow(title: string, description: string, actionEl: HTMLElement): HTMLElement {
  const label = document.createElement("label");
  label.className = "b3-label shp-row";

  const textGroup = document.createElement("div");
  textGroup.className = "shp-row__text";

  const titleEl = document.createElement("div");
  titleEl.className = "shp-row__title";
  titleEl.textContent = title;
  textGroup.appendChild(titleEl);

  if (description) {
    const descEl = document.createElement("div");
    descEl.className = "b3-label__text shp-row__desc";
    descEl.textContent = description;
    textGroup.appendChild(descEl);
  }

  label.appendChild(textGroup);

  const actionWrapper = document.createElement("div");
  actionWrapper.className = "shp-row__action";
  actionWrapper.appendChild(actionEl);
  label.appendChild(actionWrapper);

  return label;
}

/**
 * Wraps rows into a named section panel.
 */
function buildSection(rows: HTMLElement[]): HTMLElement {
  const section = document.createElement("div");
  section.className = "shp-settings__section";
  for (const row of rows) section.appendChild(row);
  return section;
}

/**
 * Assembles the full sidebar layout using SiYuan's native tab-bar pattern.
 * Matches the look of built-in SiYuan settings dialogs.
 * First section is shown by default.
 */
function buildSidebarLayout(
  sections: { id: string; label: string; el: HTMLElement }[]
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "fn__flex fn__flex-1 shp-settings-sidebar";

  // Left nav — native SiYuan tab bar
  const nav = document.createElement("ul");
  nav.className = "b3-tab-bar b3-list b3-list--background";

  // Right content pane
  const content = document.createElement("div");
  content.className = "config__tab-wrap";

  sections.forEach(({ id, label, el }, i) => {
    const li = document.createElement("li");
    li.className = "b3-list-item";
    if (i === 0) li.classList.add("b3-list-item--focus");
    li.dataset.section = id;

    const span = document.createElement("span");
    span.className = "b3-list-item__text";
    span.textContent = label;
    li.appendChild(span);

    li.addEventListener("click", () => {
      nav.querySelectorAll<HTMLElement>(".b3-list-item")
        .forEach(b => b.classList.remove("b3-list-item--focus"));
      li.classList.add("b3-list-item--focus");
      content.querySelectorAll<HTMLElement>(".shp-settings__section")
        .forEach(s => s.classList.remove("shp-settings__section--active"));
      el.classList.add("shp-settings__section--active");
    });

    nav.appendChild(li);
    if (i === 0) el.classList.add("shp-settings__section--active");
    content.appendChild(el);
  });

  wrapper.appendChild(nav);
  wrapper.appendChild(content);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Confirmation modal
// ---------------------------------------------------------------------------

/**
 * Shows a SiYuan-styled confirmation modal and returns true if the user
 * clicks Confirm, false if they click Cancel or dismiss the overlay.
 */
function showConfirmModal(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "b3-dialog b3-dialog--open shp-confirm-overlay";

    const container = document.createElement("div");
    container.className = "b3-dialog__container shp-confirm-container";

    const header = document.createElement("div");
    header.className = "b3-dialog__header";
    const titleEl = document.createElement("div");
    titleEl.className = "fn__flex-1";
    titleEl.textContent = title;
    header.appendChild(titleEl);

    const body = document.createElement("div");
    body.className = "b3-dialog__body shp-confirm-body";
    const msgEl = document.createElement("p");
    msgEl.className = "shp-confirm-msg";
    msgEl.textContent = message;
    body.appendChild(msgEl);

    const footer = document.createElement("div");
    footer.className = "b3-dialog__footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "b3-button b3-button--cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "b3-button b3-button--text";
    confirmBtn.textContent = "Confirm";

    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    container.appendChild(header);
    container.appendChild(body);
    container.appendChild(footer);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    const cleanup = (result: boolean) => {
      document.body.removeChild(overlay);
      resolve(result);
    };

    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
  });
}

// ---------------------------------------------------------------------------
// Dialog observer (title rename + footer hide)
// ---------------------------------------------------------------------------

/**
 * Installs a MutationObserver that fires when the plugin Settings dialog opens.
 * Calls onOpen(dialog) so the caller can apply initial row visibility.
 */
function installSettingsDialogObserver(onOpen: (dialog: HTMLElement) => void): void {
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

          onOpen(dialog);
        }
      }
    }
  });

  dialogObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

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

  const persistConfigNow = async (): Promise<HugoConfig> => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const nextConfig = buildConfigFromFields(fields);
    options.onConfigChange(nextConfig);
    await saveConfig(nextConfig);
    return nextConfig;
  };

  // Rows that depend on publish mode — kept as references for visibility toggling
  let fsOnlyRows: HTMLElement[] = [];
  let gitOnlyRows: HTMLElement[] = [];

  const applyModeVisibility = () => {
    const isGit = (fields.publishMode as HTMLSelectElement | undefined)?.value === "git";
    fsOnlyRows.forEach(row => { row.classList.toggle("shp-row--hidden", isGit); });
    gitOnlyRows.forEach(row => { row.classList.toggle("shp-row--hidden", !isGit); });
    // Remove bottom border from the last visible row of each mode
    const lastGit = gitOnlyRows[gitOnlyRows.length - 1];
    const lastFs  = fsOnlyRows[fsOnlyRows.length - 1];
    if (lastGit) lastGit.classList.toggle("shp-row--no-border", isGit);
    if (lastFs)  lastFs.classList.toggle("shp-row--no-border", !isGit);
  };

  // -------------------------------------------------------------------------
  // Section: Publishing
  // -------------------------------------------------------------------------

  const publishModeSelect = document.createElement("select");
  publishModeSelect.className = "b3-select fn__flex-1";
  [
    { value: "filesystem", label: "Filesystem (shared volume)" },
    { value: "git", label: "Git (GitHub repository)" },
  ].forEach(({ value, label }) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = getConfig().publishMode === value;
    publishModeSelect.appendChild(opt);
  });
  publishModeSelect.addEventListener("change", () => { scheduleSave(); applyModeVisibility(); });
  fields.publishMode = publishModeSelect;

  const rowPublishMode = buildRow(
    "Publish mode",
    "Filesystem: write via SiYuan shared volume. Git: push directly to a GitHub repository.",
    publishModeSelect
  );

  // Git-only rows
  const rowGitUrl = buildRow(
    "Git repository URL",
    "GitHub HTTPS URL (e.g. https://github.com/owner/repo.git)",
    createTextField(fields, "gitRepoUrl", getConfig, scheduleSave, "https://github.com/owner/repo.git") as HTMLElement
  );

  const rowGitBranch = buildRow(
    "Git branch",
    "Target branch for published content (default: main)",
    createTextField(fields, "gitBranch", getConfig, scheduleSave, "main") as HTMLElement
  );

  const tokenWrap = document.createElement("div");
  tokenWrap.className = "fn__flex fn__flex-1";
  tokenWrap.style.gap = "8px";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.className = "b3-text-field fn__flex-1";
  tokenInput.value = String(getConfig().gitToken ?? "");
  tokenInput.placeholder = "ghp_xxxxxxxxxxxxxxxxxxxx";
  tokenInput.addEventListener("change", scheduleSave);
  fields.gitToken = tokenInput;
  const tokenTestBtn = document.createElement("button");
  tokenTestBtn.className = "b3-button b3-button--outline";
  tokenTestBtn.textContent = "Test";
  tokenTestBtn.style.whiteSpace = "nowrap";
  tokenTestBtn.addEventListener("click", async () => {
    tokenTestBtn.disabled = true;
    tokenTestBtn.textContent = "…";
    const testConfig = buildConfigFromFields(fields);
    const result = await validateHugoProject(testConfig, createStorageAdapter(testConfig));
    tokenTestBtn.textContent = result.valid ? "OK" : "KO";
    tokenTestBtn.title = result.valid ? "" : (result.error ?? "");
    setTimeout(() => { tokenTestBtn.textContent = "Test"; tokenTestBtn.disabled = false; }, 2500);
  });
  tokenWrap.appendChild(tokenInput);
  tokenWrap.appendChild(tokenTestBtn);
  const rowGitToken = buildRow(
    "Git token",
    "GitHub Personal Access Token with repo write access",
    tokenWrap
  );

  // Filesystem-only rows
  const hugoPathWrap = document.createElement("div");
  hugoPathWrap.className = "shp-path-field fn__flex fn__flex-1";
  const hugoPathInput = createTextField(fields, "hugoProjectPath", getConfig, scheduleSave, "/data/hugo-site");
  hugoPathInput.classList.add("shp-path-field__input");
  const hugoPathInputWrap = document.createElement("div");
  hugoPathInputWrap.className = "shp-path-field__input-wrap";
  hugoPathInputWrap.appendChild(hugoPathInput);
  const hugoBrowseBtn = document.createElement("button");
  hugoBrowseBtn.className = "b3-button b3-button--outline";
  hugoBrowseBtn.textContent = "Browse";
  hugoBrowseBtn.style.whiteSpace = "nowrap";
  hugoBrowseBtn.addEventListener("click", () => {
    openPathExplorer(hugoPathInput.value.trim(), (selectedPath) => {
      hugoPathInput.value = selectedPath;
      hugoPathInput.dispatchEvent(new Event("change"));
    });
  });
  const hugoTestBtn = document.createElement("button");
  hugoTestBtn.className = "b3-button b3-button--outline";
  hugoTestBtn.textContent = "Test";
  hugoTestBtn.style.whiteSpace = "nowrap";
  hugoTestBtn.addEventListener("click", async () => {
    hugoTestBtn.disabled = true;
    hugoTestBtn.textContent = "…";
    const testConfig = { ...getConfig(), hugoProjectPath: hugoPathInput.value.trim() };
    const result = await validateHugoProject(testConfig, createStorageAdapter(testConfig));
    hugoTestBtn.textContent = result.valid ? "OK" : "KO";
    hugoTestBtn.title = result.valid ? "" : (result.error ?? "");
    setTimeout(() => { hugoTestBtn.textContent = "Test"; hugoTestBtn.disabled = false; }, 2500);
  });
  hugoPathWrap.appendChild(hugoPathInputWrap);
  hugoPathWrap.appendChild(hugoBrowseBtn);
  hugoPathWrap.appendChild(hugoTestBtn);
  const rowHugoPath = buildRow(
    "Hugo project path",
    "Ex: /data/hugo-site or /siyuan/workspace/data/hugo-site",
    hugoPathWrap
  );

  const rowContentDir = buildRow(
    "Content directory",
    "Relative path from Hugo root",
    createRelativeDirField(fields, "contentDir", getConfig, scheduleSave, "content/posts")
  );

  const rowImagesDir = buildRow(
    "Images directory",
    "Relative path inside /static/",
    createRelativeDirField(fields, "staticDir", getConfig, scheduleSave, "static/images")
  );

  gitOnlyRows = [rowGitUrl, rowGitBranch, rowGitToken];
  fsOnlyRows = [rowHugoPath, rowContentDir, rowImagesDir];

  const sectionPublishing = buildSection([
    rowPublishMode,
    rowGitUrl,
    rowGitBranch,
    rowGitToken,
    rowHugoPath,
    rowContentDir,
    rowImagesDir,
  ]);

  // -------------------------------------------------------------------------
  // Section: Content Rules
  // -------------------------------------------------------------------------

  const slugSelect = document.createElement("select");
  slugSelect.className = "b3-select fn__flex-1";
  [
    { value: "title", label: "Title (recommended)" },
    { value: "id", label: "SiYuan ID" },
  ].forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = getConfig().slugMode === value;
    slugSelect.appendChild(option);
  });
  const previousSlug = { current: getConfig().slugMode };
  const handleSlugModeChange = async () => {
    const nextMode = slugSelect.value as HugoConfig["slugMode"];
    if (nextMode === previousSlug.current) return;

    const message = nextMode === "id"
      ? "Switching to SiYuan ID will rename all already-published files using document IDs as filenames. Hugo permalinks will change and may break existing links."
      : "Switching to Title will rename all already-published files using document titles as filenames. Hugo permalinks will change and may break existing links.";
    const confirmed = await showConfirmModal("Change slug mode?", message);
    if (!confirmed) {
      slugSelect.value = previousSlug.current;
      return;
    }

    previousSlug.current = nextMode;
    await persistConfigNow();
    await options.onSlugModeChange(nextMode);
  };
  slugSelect.addEventListener("change", () => { void handleSlugModeChange(); });
  fields.slugMode = slugSelect;

  const preserveCheckbox = createSwitchField(fields, "preserveDocTree", getConfig, scheduleSave);
  const previousPreserve = { current: getConfig().preserveDocTree };
  preserveCheckbox.addEventListener("change", async () => {
    const enabled = preserveCheckbox.checked;
    if (enabled === previousPreserve.current) return;

    const message = enabled
      ? "Enabling Mirror doc tree will reorganize all published notes into subdirectories matching your SiYuan notebook hierarchy. Existing Hugo permalinks will change."
      : "Disabling Mirror doc tree will move all published notes to a flat content directory. Existing Hugo permalinks will change.";
    const confirmed = await showConfirmModal("Change doc tree structure?", message);
    if (!confirmed) {
      preserveCheckbox.checked = previousPreserve.current;
      return;
    }

    previousPreserve.current = enabled;
    await persistConfigNow();
    await options.onPreserveDocTreeChange(enabled);
  });

  const sectionContentRules = buildSection([
    buildRow(
      "Tag filter",
      "Only publish docs with this tag (empty = all)",
      createTextField(fields, "publishTag", getConfig, scheduleSave, "publish") as HTMLElement
    ),
    buildRow("Slug mode", "Filename used for published Hugo pages (Title or SiYuan ID). Changing this renames all published files.", slugSelect),
    buildRow(
      "Hugo language",
      "Language prefix for multi-lang (e.g. \"fr\" → content/fr/posts/). Empty = disabled",
      createTextField(fields, "language", getConfig, scheduleSave, "fr") as HTMLElement
    ),
    buildRow(
      "Publish as draft",
      "Sets draft: true in front matter",
      createSwitchField(fields, "defaultDraft", getConfig, scheduleSave) as HTMLElement
    ),
    buildRow(
      "Mirror doc tree structure",
      "Replicate SiYuan folder hierarchy in Hugo content directory. Toggling reorganizes existing published notes.",
      preserveCheckbox as HTMLElement
    ),
  ]);

  // -------------------------------------------------------------------------
  // Section: Sync
  // -------------------------------------------------------------------------

  const sectionSync = buildSection([
    buildRow(
      "Auto sync on save",
      "Automatically re-publish when the document is saved",
      createSwitchField(fields, "autoSyncOnSave", getConfig, scheduleSave) as HTMLElement
    ),
    buildRow(
      "Badge refresh delay",
      "Debounce delay in ms for Sync/Modified detection",
      createNumberField(fields, "badgeRefreshDelayMs", getConfig, scheduleSave, 100, "400") as HTMLElement
    ),
  ]);

  // -------------------------------------------------------------------------
  // Section: Cleanup
  // -------------------------------------------------------------------------

  const cleanNowBtn = document.createElement("button");
  cleanNowBtn.className = "b3-button b3-button--outline";
  cleanNowBtn.textContent = "Run now";
  cleanNowBtn.addEventListener("click", async () => {
    const confirmed = await showConfirmModal(
      "Clean orphans now?",
      "This will permanently delete all Hugo content files with no matching SiYuan document. This action cannot be undone."
    );
    if (!confirmed) return;
    cleanNowBtn.disabled = true;
    cleanNowBtn.textContent = "Running…";
    await options.runOrphanCleanup();
    cleanNowBtn.textContent = "Run now";
    cleanNowBtn.disabled = false;
  });

  const autoCleanCheckbox = document.createElement("input");
  autoCleanCheckbox.type = "checkbox";
  autoCleanCheckbox.className = "b3-switch fn__flex-center";
  autoCleanCheckbox.checked = Boolean(getConfig().autoCleanOrphans);
  fields.autoCleanOrphans = autoCleanCheckbox;
  autoCleanCheckbox.addEventListener("change", async () => {
    const enabled = autoCleanCheckbox.checked;
    if (enabled) {
      const confirmed = await showConfirmModal(
        "Enable auto clean orphans?",
        "On each plugin startup, Hugo content files with no matching SiYuan document will be permanently deleted. This cannot be undone."
      );
      if (!confirmed) {
        autoCleanCheckbox.checked = false;
        return;
      }
    }
    scheduleSave();
  });

  const sectionCleanup = buildSection([
    buildRow(
      "Auto clean orphans",
      "On plugin startup (page reload), scan Hugo content and remove published pages whose SiYuan document no longer exists. Documents deleted during an active session are always cleaned up automatically, regardless of this setting.",
      autoCleanCheckbox as HTMLElement
    ),
    buildRow(
      "Clean orphans now",
      "Scan Hugo content directory and remove pages with no matching SiYuan document",
      cleanNowBtn
    ),
  ]);

  // -------------------------------------------------------------------------
  // Assemble sidebar and wire up dialog injection
  // -------------------------------------------------------------------------

  const setting = new Setting({});

  // SiYuan only creates the dialog DOM when at least one item exists.
  // Add a bootstrap placeholder that the observer will remove on open.
  setting.addItem({
    title: "",
    createActionElement: () => document.createElement("span"),
  });

  const sidebar = buildSidebarLayout([
    { id: "publishing",    label: "Publishing",    el: sectionPublishing },
    { id: "content-rules", label: "Content Rules", el: sectionContentRules },
    { id: "sync",          label: "Sync",          el: sectionSync },
    { id: "cleanup",       label: "Cleanup",       el: sectionCleanup },
  ]);

  installSettingsDialogObserver((dialog) => {
    // Find the content area SiYuan created for the dialog items.
    // .config__panel is present in some SiYuan versions; .b3-dialog__body in others.
    const contentArea =
      dialog.querySelector<HTMLElement>(".config__panel") ??
      dialog.querySelector<HTMLElement>(".b3-dialog__body");

    if (!contentArea || contentArea.querySelector(".config__tab-wrap")) return;

    // Clear ALL children (including the empty setting.element wrapper div
    // that stays after we remove the placeholder .b3-label — it would otherwise
    // appear as an empty flex sibling of the sidebar and create a gap).
    while (contentArea.firstChild) contentArea.removeChild(contentArea.firstChild);

    // Turn the content area into a flex row, matching SiYuan's native tab-panel layout.
    contentArea.style.padding = "0";
    contentArea.style.overflow = "hidden";
    contentArea.style.display = "flex";

    // The border-radius lives on .b3-dialog__container (the card), not on
    // .b3-dialog itself (which is the backdrop/overlay and has no radius).
    // We apply the radius + overflow:hidden on contentArea so it clips
    // everything inside (nav included) without touching the nav's own box.
    const cardEl = dialog.querySelector<HTMLElement>(".b3-dialog__container") ?? dialog;
    const computed = window.getComputedStyle(cardEl);
    contentArea.style.borderBottomLeftRadius  = computed.borderBottomLeftRadius;
    contentArea.style.borderBottomRightRadius = computed.borderBottomRightRadius;

    contentArea.appendChild(sidebar);
    applyModeVisibility();
  });

  return setting;
}
