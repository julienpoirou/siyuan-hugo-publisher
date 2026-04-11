import { Plugin } from "siyuan";

import type { HugoConfig } from "./types";
import { getSyncEntry, initSyncState } from "./sync-state";
import { initSettings, loadConfig } from "./settings";
import { publishDoc as doPublish, unpublishDoc as doUnpublish, getDocStatus, reconcileOrphanDocs, retreePublishedDocs, listPublishedDocIds } from "./publisher";
import { createStorageAdapter } from "./storage-adapter";
import { exportMdContent } from "./api";
import { computeCurrentMetaHash } from "./sync-state";
import { upsertBadge } from "./ui/badge";
import { showToast } from "./ui/toast";
import { createLogger, getErrorMessage } from "./logger";
import { setupPluginSettings } from "./plugin-settings";
import { registerNativeMenus } from "./plugin-menus";
import { bindPluginEvents } from "./plugin-events";
import type { EventBusLike } from "./plugin-types";

const PUBLISH_HOTKEY = "⌥⌘P";
const UNPUBLISH_HOTKEY = "⌥⌘U";
const log = createLogger("plugin");

/**
 * Casts the plugin event bus to the narrowed type expected by plugin helpers.
 *
 * @param eventBus Raw SiYuan event bus instance.
 * @returns The event bus with plugin-specific typing.
 */
const asPluginEventBus = (eventBus: unknown): EventBusLike => eventBus as EventBusLike;
const BACKGROUND_RECONCILE_INTERVAL_MS = 30000;

export default class HugoPublisherPlugin extends Plugin {
  private config: HugoConfig | null = null;
  private statusCache = new Map<string, string>();
  private editorFingerprints = new Map<string, string>();
  private tabObserver: MutationObserver | null = null;
  private titleAreaObserver: MutationObserver | null = null;
  private titleInputCleanup: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private missingDocReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private missingDocReconcileInterval: ReturnType<typeof setInterval> | null = null;
  private pendingDeletedDocs = new Set<string>();
  private isReconcilingMissingDocs = false;
  private activeDocId: string | null = null;
  private activeProtyleEl: HTMLElement | undefined = undefined;
  private publishingDocs = new Set<string>();

  /**
   * Initializes plugin state, settings, commands, menus, and event bindings.
   */
  async onload() {
    initSyncState(this);
    initSettings(this);
    this.config = await loadConfig();

    this.setting = setupPluginSettings({
      getConfig: () => this.config ?? {
        hugoProjectPath: "",
        contentDir: "content/posts",
        staticDir: "static/images",
        publishTag: "",
        defaultDraft: false,
        slugMode: "title",
        autoSyncOnSave: false,
        autoCleanOrphans: false,
        language: "",
        badgeRefreshDelayMs: 400,
        preserveDocTree: false,
        publishMode: "filesystem",
        gitRepoUrl: "",
        gitBranch: "main",
        gitToken: "",
      },
      onConfigChange: (config) => {
        this.config = config;
      },
      runOrphanCleanup: () => this.runOrphanCleanup(false),
      onPreserveDocTreeChange: (enabled) => this.retreePublishedDocs(enabled),
      onSlugModeChange: (mode) => this.republishForSlugModeChange(mode),
    });

    if (this.config?.autoCleanOrphans) {
      void this.runOrphanCleanup(true);
    }

    this.addCommand({
      langKey: "publishToHugo",
      langText: "Publish to Hugo",
      hotkey: PUBLISH_HOTKEY,
      callback: () => this.publishCurrentDoc(),
    });

    this.addCommand({
      langKey: "unpublishFromHugo",
      langText: "Unpublish from Hugo",
      hotkey: UNPUBLISH_HOTKEY,
      callback: () => this.unpublishCurrentDoc(),
    });

    registerNativeMenus(asPluginEventBus(this.eventBus), PUBLISH_HOTKEY, UNPUBLISH_HOTKEY, {
      getStatus: (docId) => this.statusCache.get(docId),
      isRootId: (id): id is string => this.isRootId(id),
      publishDoc: (docId, protyleEl) => this.publishDoc(docId, protyleEl),
      unpublishDoc: (docId, protyleEl, silent) => this.unpublishDoc(docId, protyleEl, silent),
    });

    this.startTabObserver();
    this.missingDocReconcileInterval = setInterval(() => {
      void this.reconcileMissingPublishedDocs();
    }, BACKGROUND_RECONCILE_INTERVAL_MS);
    log.info("Plugin loaded");
  }

  /**
   * Tears down observers and timers created during plugin startup.
   */
  async onunload() {
    this.tabObserver?.disconnect();
    this.titleAreaObserver?.disconnect();
    this.titleInputCleanup?.();
    if (this.missingDocReconcileTimer) clearTimeout(this.missingDocReconcileTimer);
    if (this.missingDocReconcileInterval) clearInterval(this.missingDocReconcileInterval);
  }

  /**
   * Removes orphaned Hugo pages whose source SiYuan documents are gone or stale.
   *
   * @param silent When `true`, suppresses the "no orphans" toast.
   */
  private getAdapter() {
    return createStorageAdapter(this.config!);
  }

  /**
   * Returns true when the active publish mode is sufficiently configured to
   * perform storage operations. In filesystem mode this requires hugoProjectPath;
   * in git mode it requires gitRepoUrl and gitToken.
   */
  private isConfigured(): boolean {
    if (!this.config) return false;
    if (this.config.publishMode === "git") {
      return !!(this.config.gitRepoUrl && this.config.gitToken);
    }
    return !!this.config.hugoProjectPath;
  }

  private configurationErrorMessage(): string {
    if (this.config?.publishMode === "git") {
      return "Configure the Git repo URL and token in plugin settings first";
    }
    return "Configure the Hugo path in plugin settings first";
  }

  async runOrphanCleanup(silent = false): Promise<void> {
    if (!this.config) return;
    try {
      const { removed, errors } = await reconcileOrphanDocs(this.config, this.getAdapter());
      if (removed.length > 0) {
        showToast(`Orphans removed: ${removed.length}`, "info");
        await this.refreshAllOpenDocs();
      } else if (!silent) {
        showToast("No orphans found", "info");
      }
      if (errors.length > 0) {
        log.error("Orphan cleanup errors", errors);
        showToast(`Orphan cleanup errors: ${errors[0]}`, "error", 8000);
      }
    } catch (err) {
      log.error("Orphan cleanup failed", err);
      if (!silent) showToast(`Orphan cleanup failed: ${getErrorMessage(err)}`, "error");
    }
  }

  /**
   * Re-publishes all mirrored documents after a `preserveDocTree` toggle.
   *
   * Shows a progress toast and a summary toast on completion.
   *
   * @param enabled New value of `preserveDocTree`.
   */
  async retreePublishedDocs(enabled: boolean): Promise<void> {
    if (!this.config) return;
    const label = enabled ? "tree" : "flat";
    showToast(`Reorganizing notes to ${label} structure…`, "info", 3000);
    try {
      const { moved, errors } = await retreePublishedDocs(this.config, this.getAdapter());
      if (moved > 0) {
        showToast(`Reorganized ${moved} note(s) to ${label} structure`, "success", 5000);
        await this.refreshAllOpenDocs();
      }
      if (errors.length > 0) {
        log.error("Retree errors", errors);
        showToast(`Retree: ${errors.length} error(s) — see console`, "error", 6000);
      }
    } catch (err) {
      log.error("Retree failed", err);
      showToast(`Retree failed: ${getErrorMessage(err)}`, "error", 6000);
    }
  }

  /**
   * Re-publishes all published documents after a `slugMode` change.
   *
   * @param mode New slug mode value.
   */
  async republishForSlugModeChange(mode: HugoConfig["slugMode"]): Promise<void> {
    if (!this.config) return;
    const label = mode === "id" ? "SiYuan ID" : "title";
    showToast(`Reorganizing notes for ${label} slug mode…`, "info", 3000);
    try {
      const { moved, errors } = await retreePublishedDocs(this.config, this.getAdapter());
      if (moved > 0) {
        showToast(`Reorganized ${moved} note(s) for ${label} slug mode`, "success", 5000);
        await this.refreshAllOpenDocs();
      }
      if (errors.length > 0) {
        log.error("Slug mode republish errors", errors);
        showToast(`Slug mode update: ${errors.length} error(s) — see console`, "error", 6000);
      }
    } catch (err) {
      log.error("Slug mode republish failed", err);
      showToast(`Slug mode update failed: ${getErrorMessage(err)}`, "error", 6000);
    }
  }

  /**
   * Publishes the currently active document.
   */
  async publishCurrentDoc(): Promise<void> {
    const docId = this.getCurrentDocId();
    if (!docId) { showToast("Aucun document ouvert", "warning"); return; }
    await this.publishDoc(docId, this.activeProtyleEl);
  }

  /**
   * Unpublishes the currently active document.
   */
  async unpublishCurrentDoc(): Promise<void> {
    const docId = this.getCurrentDocId();
    if (!docId) { showToast("Aucun document ouvert", "warning"); return; }
    await this.unpublishDoc(docId, this.activeProtyleEl);
  }

  /**
   * Unpublishes a specific document and updates local UI state.
   *
   * @param docId SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   * @param silent When `true`, suppresses success and error toasts.
   */
  async unpublishDoc(docId: string, protyleEl?: HTMLElement, silent = false): Promise<void> {
    if (!this.isConfigured()) {
      showToast(this.configurationErrorMessage(), "error");
      return;
    }
    try {
      const result = await doUnpublish(docId, this.config!, this.getAdapter());
      if (result.success) {
        this.statusCache.set(docId, "not-published");
        this.editorFingerprints.delete(docId);
        upsertBadge(protyleEl ?? null, docId, "not-published");
        if (!silent) showToast(`Dépublié : ${result.hugoPath}`, "success", 4000);
      } else if (!silent) {
        showToast(result.message, "error", 4000);
      }
    } catch (err) {
      log.error(`Unpublish failed for ${docId}`, err);
      if (!silent) showToast(getErrorMessage(err), "error", 4000);
    }
  }

  /**
   * Publishes a specific document and updates local UI state.
   *
   * @param docId SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   * @param silent When `true`, suppresses user-facing toasts.
   */
  async publishDoc(docId: string, protyleEl?: HTMLElement, silent = false): Promise<void> {
    if (!this.isConfigured()) {
      showToast(this.configurationErrorMessage(), "error");
      this.setting.open(this.name);
      return;
    }

    if (this.publishingDocs.has(docId)) {
      log.info(`Publish already in progress for ${docId}, skipping concurrent request`);
      return;
    }

    this.publishingDocs.add(docId);
    try {
      if (!silent) showToast("Publication en cours…", "info", 2000);
      const result = await doPublish(docId, this.config!, this.getAdapter());

      if (result.success) {
        if (!silent) {
          const msg = [
            `Publié : ${result.hugoPath}`,
            result.imagesCopied ? `${result.imagesCopied} image(s)` : null,
            result.imagesErrors?.length ? `${result.imagesErrors.length} erreur(s) image` : null,
          ].filter(Boolean).join(" · ");
          showToast(msg, "success", 5000);
        }
        const now = new Date().toISOString();
        this.statusCache.set(docId, "synced");
        upsertBadge(protyleEl ?? null, docId, "synced", now);
        this.captureEditorFingerprint(docId, protyleEl);
      } else if (!silent) {
        showToast(result.message, "error", 6000);
      }
    } finally {
      this.publishingDocs.delete(docId);
    }
  }

  /**
   * Refreshes the computed publish status for a document badge.
   *
   * @param docId SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   */
  async refreshDocStatus(docId: string, protyleEl?: HTMLElement): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const result = await getDocStatus(docId, this.config!, this.getAdapter());
      upsertBadge(protyleEl ?? null, docId, result.status, result.lastSync);
      this.statusCache.set(docId, result.status);
      if (result.status === "synced") {
        this.captureEditorFingerprint(docId, protyleEl);
      }
    } catch (err) {
      log.warn(`Status refresh failed for ${docId}`, err);
    }
  }

  /**
   * Debounces status refreshes triggered by document-save activity.
   *
   * @param docId SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   */
  private scheduleRefresh(docId: string, protyleEl?: HTMLElement): void {
    const existing = this.refreshTimers.get(docId);
    if (existing) clearTimeout(existing);
    const delayMs = Math.max(100, this.config?.badgeRefreshDelayMs ?? 400);
    const timer = setTimeout(async () => {
      this.refreshTimers.delete(docId);
      await this.refreshEditorDirtyState(docId, protyleEl);
      if (this.config?.autoSyncOnSave && this.statusCache.get(docId) === "modified") {
        await this.publishDoc(docId, protyleEl, true);
      }
    }, delayMs);
    this.refreshTimers.set(docId, timer);
  }

  /**
   * Updates badge state for an edited document using a local editor fingerprint.
   *
   * The SiYuan export API is unstable for some large documents, so during
   * active editing we compare the current editor snapshot against the snapshot
   * captured right after a successful publish.
   *
   * @param docId SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   */
  private async refreshEditorDirtyState(docId: string, protyleEl?: HTMLElement): Promise<void> {
    const entry = await getSyncEntry(docId);
    if (!entry?.hugoPath || !protyleEl) {
      await this.refreshDocStatus(docId, protyleEl);
      return;
    }

    const baseline = this.editorFingerprints.get(docId);
    const current = this.computeEditorFingerprint(protyleEl);
    if (!current) {
      await this.refreshDocStatus(docId, protyleEl);
      return;
    }
    if (!baseline) {
      this.editorFingerprints.set(docId, current);
      await this.refreshDocStatus(docId, protyleEl);
      return;
    }

    let nextStatus: "synced" | "modified" = current === baseline ? "synced" : "modified";

    // If fingerprint says synced, verify metaHash as well (title/icon/banner may have
    // changed without updating the fingerprint baseline).
    if (nextStatus === "synced" && entry.metaHash) {
      try {
        if (await computeCurrentMetaHash(docId, this.getVisibleTitle(protyleEl)) !== entry.metaHash) nextStatus = "modified";
      } catch { /* non-blocking */ }
    }

    upsertBadge(protyleEl ?? null, docId, nextStatus, entry.lastSync);
    this.statusCache.set(docId, nextStatus);
  }

  /**
   * Stores the current editor fingerprint as the synced baseline for a doc.
   *
   * @param docId SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   */
  private captureEditorFingerprint(docId: string, protyleEl?: HTMLElement): void {
    if (!protyleEl) return;
    const fingerprint = this.computeEditorFingerprint(protyleEl);
    if (fingerprint) {
      this.editorFingerprints.set(docId, fingerprint);
    }
  }

  /**
   * Creates a stable local fingerprint from the visible editor state.
   *
   * @param protyleEl Active protyle root element.
   * @returns Fingerprint string or an empty string when unavailable.
   */
  private computeEditorFingerprint(protyleEl: HTMLElement): string {
    const title = this.getVisibleTitle(protyleEl);
    const wysiwyg = protyleEl.querySelector<HTMLElement>(".protyle-wysiwyg");
    const body = this.serializeEditorFingerprint(wysiwyg);

    const iconEl = protyleEl.querySelector<HTMLElement>(".protyle-title__icon");
    const icon = iconEl?.querySelector<HTMLImageElement>("img")?.src
      ?? iconEl?.textContent?.trim()
      ?? "";

    const banner = protyleEl.querySelector<HTMLImageElement>(".protyle-background__img img")?.src ?? "";

    return `${title}\n${icon}\n${banner}\n${body}`;
  }

  /**
   * Reads the visible editor title from the current protyle.
   *
   * @param protyleEl Active protyle root element.
   * @returns Visible title text.
   */
  private getVisibleTitle(protyleEl: HTMLElement): string {
    const titleEl = protyleEl.querySelector<HTMLElement>(".protyle-title__input");
    return (titleEl as HTMLInputElement | null)?.value || titleEl?.textContent?.trim() || "";
  }

  /**
   * Serializes the editor DOM into a stable fingerprint.
   *
   * @param root Editor root element.
   * @returns Stable serialized representation.
   */
  private serializeEditorFingerprint(root: HTMLElement | null | undefined): string {
    if (!root) return "";
    return Array.from(root.childNodes).map((node) => this.serializeFingerprintNode(node)).join("");
  }

  /**
   * Converts a DOM node into a stable fingerprint fragment.
   *
   * @param node DOM node to serialize.
   * @returns Stable fragment string.
   */
  private serializeFingerprintNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "")
        .replace(/\u200b/g, "")
        .replace(/\uFEFF/g, "");
    }

    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "WBR") return "";

    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes).map((child) => this.serializeFingerprintNode(child)).join("");
    return `<${tag}>${children}</${tag}>`;
  }

  /**
   * Binds SiYuan runtime events to plugin state transitions.
   */
  private bindEvents(): void {
    bindPluginEvents(asPluginEventBus(this.eventBus), {
      isRootId: (id): id is string => this.isRootId(id),
      getActiveDocId: () => this.activeDocId,
      getActiveProtyleEl: () => this.activeProtyleEl,
      setActiveDoc: (docId, protyleEl) => this.setActiveDoc(docId, protyleEl),
      clearActiveDoc: (docId) => {
        if (this.activeDocId === docId) {
          this.activeDocId = null;
          this.activeProtyleEl = undefined;
          this.titleAreaObserver?.disconnect();
          this.titleAreaObserver = null;
          this.titleInputCleanup?.();
          this.titleInputCleanup = null;
        }
      },
      refreshDocStatus: (docId, protyleEl) => this.refreshDocStatus(docId, protyleEl),
      scheduleMissingDocReconcile: () => this.scheduleMissingDocReconcile(),
      scheduleRefresh: (docId, protyleEl) => this.scheduleRefresh(docId, protyleEl),
      scheduleRefreshIfIdle: (docId, protyleEl) => {
        if (!this.refreshTimers.has(docId)) this.scheduleRefresh(docId, protyleEl);
      },
      deleteStatus: (docId) => {
        this.statusCache.delete(docId);
        this.editorFingerprints.delete(docId);
      },
      clearRefreshTimer: (docId) => {
        const timer = this.refreshTimers.get(docId);
        if (timer) {
          clearTimeout(timer);
          this.refreshTimers.delete(docId);
        }
      },
    });
  }

  /**
   * Observes tab/layout mutations so badges stay in sync with the active editor view.
   */
  private startTabObserver(): void {
    const layoutEl = document.querySelector("#layouts");
    if (!layoutEl) {
      setTimeout(() => this.startTabObserver(), 1000);
      return;
    }

    this.tabObserver = new MutationObserver((mutations) => {
      const isOwnMutation = mutations.every((m) =>
        Array.from(m.addedNodes).every(
          (n) => n instanceof Element && n.classList.contains("hugo-sync-badge")
        )
      );
      if (isOwnMutation) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.refreshAllOpenDocs(), 800);
    });

    this.tabObserver.observe(layoutEl, { attributeFilter: ["data-id"], subtree: true });
    this.bindEvents();
  }

  /**
   * Refreshes sync badges for all documents currently tracked in the local status cache.
   */
  private async refreshAllOpenDocs(): Promise<void> {
    for (const docId of this.statusCache.keys()) {
      const el = docId === this.activeDocId ? this.activeProtyleEl : undefined;
      await this.refreshDocStatus(docId, el);
    }
  }

  /**
   * Checks whether an identifier matches the SiYuan root document ID format.
   *
   * @param id Candidate identifier.
   * @returns `true` when the identifier matches a root document ID.
   */
  private isRootId(id: string | undefined): id is string {
    return !!id && /^\d{14}-\w+$/.test(id);
  }

  /**
   * Returns the currently active document identifier.
   *
   * @returns The active document ID or `null`.
   */
  private getCurrentDocId(): string | null {
    return this.activeDocId;
  }

  /**
   * Updates the active document and editor element references.
   *
   * @param docId Active SiYuan document identifier.
   * @param protyleEl Active protyle element when available.
   */
  private setActiveDoc(docId: string, protyleEl?: HTMLElement): void {
    this.activeDocId = docId;
    this.activeProtyleEl = protyleEl;
    this.observeTitleArea(docId, protyleEl);
  }

  /**
   * Observes icon and banner DOM mutations for the active protyle.
   *
   * SiYuan updates icon/banner via direct attribute API calls that do NOT
   * emit a `ws-main transactions` event, so we need a DOM observer to detect
   * those changes and trigger a badge refresh.
   *
   * @param docId Active SiYuan document identifier.
   * @param protyleEl Active protyle root element when available.
   */
  private observeTitleArea(docId: string, protyleEl?: HTMLElement): void {
    this.titleAreaObserver?.disconnect();
    this.titleAreaObserver = null;
    this.titleInputCleanup?.();
    this.titleInputCleanup = null;
    if (!protyleEl) return;

    const titleContainer = protyleEl.querySelector<HTMLElement>(".protyle-title");
    const titleInput = protyleEl.querySelector<HTMLElement>(".protyle-title__input");
    const titleEditable = titleInput
      ?? titleContainer?.querySelector<HTMLElement>("input, textarea, [contenteditable='true']");

    if (titleContainer) {
      const onTitleChange = () => this.scheduleRefresh(docId, protyleEl);
      titleContainer.addEventListener("input", onTitleChange, true);
      titleContainer.addEventListener("change", onTitleChange, true);
      titleContainer.addEventListener("keyup", onTitleChange, true);
      titleContainer.addEventListener("blur", onTitleChange, true);
      titleContainer.addEventListener("compositionend", onTitleChange, true);
      this.titleInputCleanup = () => {
        titleContainer.removeEventListener("input", onTitleChange, true);
        titleContainer.removeEventListener("change", onTitleChange, true);
        titleContainer.removeEventListener("keyup", onTitleChange, true);
        titleContainer.removeEventListener("blur", onTitleChange, true);
        titleContainer.removeEventListener("compositionend", onTitleChange, true);
      };
    }

    this.titleAreaObserver = new MutationObserver(() => {
      this.scheduleRefresh(docId, protyleEl);
    });

    // Observe the protyle root for direct-child structural changes.
    // This catches .protyle-background being created, replaced, or removed even
    // when the element reference captured below becomes stale after recreation.
    this.titleAreaObserver.observe(protyleEl, {
      childList: true,
      subtree: false,
    });

    const targets = [
      titleContainer,
      protyleEl.querySelector(".protyle-title__icon"),
      titleEditable,
      protyleEl.querySelector(".protyle-background"),
    ].filter((el): el is Element => el !== null);

    for (const target of targets) {
      this.titleAreaObserver.observe(target, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["src", "style", "data-icon"],
      });
    }
  }

  /**
   * Debounces background reconciliation for documents deleted from SiYuan.
   */
  private scheduleMissingDocReconcile(): void {
    if (this.missingDocReconcileTimer) clearTimeout(this.missingDocReconcileTimer);
    this.missingDocReconcileTimer = setTimeout(() => {
      this.missingDocReconcileTimer = null;
      void this.reconcileMissingPublishedDocs();
    }, 1200);
  }

  /**
   * Unpublishes documents that still exist in sync storage but can no longer be exported.
   */
  private async reconcileMissingPublishedDocs(): Promise<void> {
    if (this.isReconcilingMissingDocs) return;
    if (typeof document !== "undefined" && document.hidden) return;

    this.isReconcilingMissingDocs = true;
    const trackedDocIds = await listPublishedDocIds(this.config!, this.getAdapter());
    try {
      if (trackedDocIds.length === 0) return;

      for (const docId of trackedDocIds) {
        if (this.pendingDeletedDocs.has(docId)) continue;
        try {
          await exportMdContent(docId);
        } catch {
          this.pendingDeletedDocs.add(docId);
          try {
            await this.unpublishDoc(docId, undefined, true);
            this.statusCache.delete(docId);
          } finally {
            this.pendingDeletedDocs.delete(docId);
          }
        }
      }
    } finally {
      this.isReconcilingMissingDocs = false;
    }
  }
}
