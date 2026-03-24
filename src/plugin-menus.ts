const DELETE_LABELS = ["Delete", "Supprimer", "删除"];
const EXPORT_LABELS = ["Export", "Exporter", "导出"];

import { removeNativeMenu } from "./siyuan-runtime";
import type { EditorTitleIconEvent, EventBusLike, OpenMenuDocTreeEvent } from "./plugin-types";

export interface MenuActions {
  getStatus: (docId: string) => string | undefined;
  isRootId: (id: string | undefined) => id is string;
  publishDoc: (docId: string, protyleEl?: HTMLElement) => void | Promise<void>;
  unpublishDoc: (docId: string, protyleEl?: HTMLElement, silent?: boolean) => void | Promise<void>;
}

function closeMenu(menuEl: HTMLElement): void {
  try {
    if (!removeNativeMenu()) {
      menuEl.remove();
    }
  } catch {
    menuEl.remove();
  }
}

function createMenuButton(
  menuEl: HTMLElement,
  icon: string,
  label: string,
  hotkey: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "b3-menu__item";
  button.setAttribute("aria-label", `${label} (${hotkey})`);
  button.innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#${icon}"></use></svg><span class="b3-menu__label">${label}</span><span class="b3-menu__accelerator">${hotkey}</span>`;
  button.addEventListener("click", () => {
    closeMenu(menuEl);
    onClick();
  });
  return button;
}

function installDeleteAutoUnpublish(menuEl: HTMLElement, docId: string, actions: MenuActions): void {
  const allItems = Array.from(menuEl.querySelectorAll<HTMLElement>(".b3-menu__item"));
  const deleteItem = allItems.find((item) => {
    const labelText = item.querySelector(".b3-menu__label")?.textContent?.trim() ?? "";
    const fullText = item.textContent?.trim() ?? "";
    return DELETE_LABELS.includes(labelText) || DELETE_LABELS.some((label) => fullText.startsWith(label));
  });
  if (!deleteItem) return;

  deleteItem.addEventListener("mousedown", () => {
    const observer = new MutationObserver(() => {
      const confirmBtn = Array.from(
        document.querySelectorAll<HTMLElement>(".b3-dialog__action button, .b3-dialog button")
      ).find((button) => button.textContent?.trim() === "Delete");
      if (!confirmBtn) return;
      observer.disconnect();
      confirmBtn.addEventListener("click", () => {
        void actions.unpublishDoc(docId, undefined, true);
      }, { once: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  }, { once: true, capture: true });
}

export function registerNativeMenus(
  eventBus: EventBusLike,
  publishHotkey: string,
  unpublishHotkey: string,
  actions: MenuActions
): void {
  eventBus.on("click-editortitleicon", (event: EditorTitleIconEvent) => {
    if (!event.detail) return;
    const protyle = event.detail?.protyle;
    const docId = protyle?.block?.rootID;
    if (!actions.isRootId(docId)) return;

    event.detail.menu.addItem({
      icon: "iconUpload",
      label: "Publish",
      accelerator: publishHotkey,
      click: () => { void actions.publishDoc(docId, protyle?.element); },
    });

    if (actions.getStatus(docId) && actions.getStatus(docId) !== "not-published") {
      event.detail.menu.addItem({
        icon: "iconClose",
        label: "Unpublish",
        accelerator: unpublishHotkey,
        click: () => { void actions.unpublishDoc(docId, protyle?.element); },
      });
    }
  });

  eventBus.on("open-menu-doctree", (event: OpenMenuDocTreeEvent) => {
    if (!event.detail) return;
    if (event.detail?.type !== "doc") return;
    const el = event.detail?.elements?.[0] as HTMLElement | undefined;
    const docId = el?.getAttribute("data-node-id") ?? el?.dataset?.nodeId;
    if (!docId) return;

    setTimeout(() => {
      const menuEl = document.querySelector<HTMLElement>(".b3-menu");
      if (!menuEl) return;

      const exportItem = Array.from(menuEl.querySelectorAll<HTMLElement>(".b3-menu__item")).find(
        (item) => EXPORT_LABELS.includes(item.querySelector(".b3-menu__label")?.textContent?.trim() ?? "")
      );

      const publishBtn = createMenuButton(menuEl, "iconUpload", "Publish", publishHotkey, () => {
        void actions.publishDoc(docId);
      });

      const status = actions.getStatus(docId);
      const unpublishBtn = (status && status !== "not-published")
        ? createMenuButton(menuEl, "iconClose", "Unpublish", unpublishHotkey, () => {
          void actions.unpublishDoc(docId);
        })
        : null;

      installDeleteAutoUnpublish(menuEl, docId, actions);

      if (exportItem) {
        exportItem.insertAdjacentElement("afterend", publishBtn);
        if (unpublishBtn) publishBtn.insertAdjacentElement("afterend", unpublishBtn);
      } else {
        menuEl.appendChild(publishBtn);
        if (unpublishBtn) menuEl.appendChild(unpublishBtn);
      }
    }, 50);
  });
}
