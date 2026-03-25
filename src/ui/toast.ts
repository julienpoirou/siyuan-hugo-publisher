import { showNativeMessage } from "../siyuan-runtime";

type ToastType = "success" | "error" | "info" | "warning";

const TYPE_CONFIG: Record<ToastType, { icon: string; bgColor: string; textColor: string }> = {
  success: { icon: "✅", bgColor: "#d4edda", textColor: "#155724" },
  error:   { icon: "❌", bgColor: "#f8d7da", textColor: "#721c24" },
  info:    { icon: "ℹ️", bgColor: "#d1ecf1", textColor: "#0c5460" },
  warning: { icon: "⚠️", bgColor: "#fff3cd", textColor: "#856404" },
};

/**
 * Displays a toast through the native SiYuan API or a DOM fallback.
 *
 * @param message Message to display.
 * @param type Visual toast type.
 * @param durationMs Display duration in milliseconds.
 */
export function showToast(message: string, type: ToastType = "info", durationMs = 4000): void {
  const siyuanType = type === "success" ? "info" : type === "warning" ? "error" : type;
  if (showNativeMessage(message, durationMs, siyuanType)) {
    return;
  }

  renderDOMToast(message, type, durationMs);
}

/**
 * Renders a fallback toast directly in the DOM when native messages are unavailable.
 *
 * @param message Message to display.
 * @param type Visual toast type.
 * @param durationMs Display duration in milliseconds.
 */
function renderDOMToast(message: string, type: ToastType, durationMs: number): void {
  const cfg = TYPE_CONFIG[type];

  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 99999;
    padding: 12px 18px;
    border-radius: 8px;
    background: ${cfg.bgColor};
    color: ${cfg.textColor};
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 380px;
    animation: hugo-toast-in 0.2s ease;
  `;

  if (!document.getElementById("hugo-toast-style")) {
    const style = document.createElement("style");
    style.id = "hugo-toast-style";
    style.textContent = `
      @keyframes hugo-toast-in {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes hugo-toast-out {
        from { opacity: 1; transform: translateY(0); }
        to   { opacity: 0; transform: translateY(10px); }
      }
    `;
    document.head.appendChild(style);
  }

  toast.innerHTML = `<span>${cfg.icon}</span><span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  const timeout = setTimeout(() => {
    toast.style.animation = "hugo-toast-out 0.2s ease forwards";
    setTimeout(() => toast.remove(), 200);
  }, durationMs);

  toast.addEventListener("click", () => {
    clearTimeout(timeout);
    toast.remove();
  });
}

/**
 * Escapes user-facing text before inserting it into toast HTML.
 *
 * @param s Raw text to escape.
 * @returns HTML-safe text.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
