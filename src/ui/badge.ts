import type { SyncStatus } from "../types";

const BADGE_ID_PREFIX = "hugo-badge-";

const STATUS_CONFIG: Record<SyncStatus, { emoji: string; label: string; color: string }> = {
  synced:          { emoji: "🟢", label: "Synced",        color: "#28a745" },
  modified:        { emoji: "🟡", label: "Modified",      color: "#ffc107" },
  "not-published": { emoji: "🔴", label: "Not published", color: "#dc3545" },
};

function applyStatus(badge: HTMLElement, status: SyncStatus, lastSync?: string): void {
  const cfg = STATUS_CONFIG[status];
  const tooltip = lastSync
    ? `Hugo: ${cfg.label}\nDernier sync: ${new Date(lastSync).toLocaleString()}`
    : `Hugo: ${cfg.label}`;
  badge.title = tooltip;
  badge.setAttribute("aria-label", tooltip);
  badge.style.borderColor = `${cfg.color}33`;
  badge.style.background  = `${cfg.color}18`;
  badge.style.color       = cfg.color;
  badge.innerHTML = `<span style="font-size:10px">${cfg.emoji}</span> ${cfg.label}`;
}

function createBadge(docId: string, status: SyncStatus, lastSync?: string): HTMLElement {
  const cfg = STATUS_CONFIG[status];
  const b = document.createElement("span");
  b.id        = `${BADGE_ID_PREFIX}${docId}`;
  b.className = "hugo-sync-badge";
  b.style.cssText = `
    display:inline-flex;align-items:center;gap:4px;
    padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;
    cursor:default;margin-left:8px;user-select:none;vertical-align:middle;
    border:1px solid ${cfg.color}33;background:${cfg.color}18;color:${cfg.color};
    transition: all 0.2s;
  `;
  applyStatus(b, status, lastSync);
  return b;
}

export function upsertBadge(
  protyleEl: HTMLElement | null,
  docId: string,
  status: SyncStatus,
  lastSync?: string
): void {
  const existing = document.getElementById(`${BADGE_ID_PREFIX}${docId}`);
  if (existing) {
    applyStatus(existing as HTMLElement, status, lastSync);
    existing.parentElement?.querySelectorAll<HTMLElement>(".hugo-sync-badge").forEach((b) => {
      if (b !== existing) b.remove();
    });
    return;
  }

  const container = findTitleEl(protyleEl, docId);
  if (!container) return;

  container.querySelectorAll(".hugo-sync-badge").forEach((b) => {
    b.remove();
  });
  container.appendChild(createBadge(docId, status, lastSync));
}

export function removeBadge(docId: string): void {
  document.getElementById(`${BADGE_ID_PREFIX}${docId}`)?.remove();
}

function findTitleEl(protyleEl: HTMLElement | null, docId: string): Element | null {
  if (protyleEl) {
    const t = protyleEl.querySelector(".protyle-title");
    if (t) return t;
  }

  for (const attr of [`data-id`, `data-node-id`, `data-root-id`]) {
    const el = document.querySelector(`.protyle[${attr}="${docId}"] .protyle-title`);
    if (el) return el;
  }

  return null;
}
