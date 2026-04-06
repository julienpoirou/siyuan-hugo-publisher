import type { EventBusLike, ProtyleLifecycleEvent, WsMainEvent } from "./plugin-types";

export interface EventBindings {
  isRootId: (id: string | undefined) => id is string;
  getActiveDocId: () => string | null;
  getActiveProtyleEl: () => HTMLElement | undefined;
  setActiveDoc: (docId: string, protyleEl?: HTMLElement) => void;
  clearActiveDoc: (docId: string) => void;
  refreshDocStatus: (docId: string, protyleEl?: HTMLElement) => Promise<void>;
  scheduleMissingDocReconcile: () => void;
  scheduleRefresh: (docId: string, protyleEl?: HTMLElement) => void;
  deleteStatus: (docId: string) => void;
  clearRefreshTimer: (docId: string) => void;
}

/**
 * Binds the core SiYuan event listeners used by the plugin lifecycle.
 *
 * @param eventBus SiYuan event bus implementation.
 * @param bindings Plugin callbacks invoked for each event.
 */
export function bindPluginEvents(
  eventBus: EventBusLike,
  bindings: EventBindings
): void {
  eventBus.on("loaded-protyle-static", async (event: ProtyleLifecycleEvent) => {
    const protyle = event?.detail?.protyle;
    const docId = protyle?.block?.rootID;
    const el: HTMLElement | undefined = protyle?.element;
    if (!bindings.isRootId(docId)) return;
    bindings.setActiveDoc(docId, el);
    await bindings.refreshDocStatus(docId, el);
  });

  eventBus.on("switch-protyle", async (event: ProtyleLifecycleEvent) => {
    const protyle = event?.detail?.protyle;
    const docId = protyle?.block?.rootID;
    const el: HTMLElement | undefined = protyle?.element;
    if (!bindings.isRootId(docId)) return;
    bindings.setActiveDoc(docId, el);
    await bindings.refreshDocStatus(docId, el);
  });

  eventBus.on("ws-main", async (event: WsMainEvent) => {
    const cmd = event.detail?.cmd;
    if (cmd !== "transactions" && cmd !== "setBlockAttrs") return;
    if (cmd === "transactions") bindings.scheduleMissingDocReconcile();
    const activeDocId = bindings.getActiveDocId();
    if (activeDocId) {
      bindings.scheduleRefresh(activeDocId, bindings.getActiveProtyleEl());
    }
  });

  eventBus.on("destroy-protyle", (event: ProtyleLifecycleEvent) => {
    const docId = event?.detail?.protyle?.block?.rootID;
    if (!bindings.isRootId(docId)) return;
    bindings.clearActiveDoc(docId);
    bindings.deleteStatus(docId);
    bindings.clearRefreshTimer(docId);
  });
}
