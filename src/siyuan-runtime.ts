export interface SiyuanMenuApi {
  remove(): void;
}

export interface SiyuanGlobal {
  config?: {
    api?: {
      token?: string;
    };
  };
  menus?: {
    menu?: SiyuanMenuApi;
  };
  showMessage?: (msg: string, timeout?: number, type?: string) => void;
}

declare global {
  interface Window {
    siyuan?: SiyuanGlobal;
  }
}

/**
 * Returns the global SiYuan runtime object when available in the browser.
 *
 * @returns The SiYuan global or `undefined` outside of runtime.
 */
export function getSiyuanGlobal(): SiyuanGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return window.siyuan;
}

/**
 * Reads the current SiYuan API token from the global runtime object.
 *
 * @returns The API token or an empty string when unavailable.
 */
export function getSiyuanApiToken(): string {
  return getSiyuanGlobal()?.config?.api?.token ?? "";
}

/**
 * Removes the currently open native SiYuan context menu when present.
 *
 * @returns `true` when a menu was found and removed.
 */
export function removeNativeMenu(): boolean {
  const menu = getSiyuanGlobal()?.menus?.menu;
  if (!menu) return false;
  menu.remove();
  return true;
}

/**
 * Displays a native SiYuan message toast when the runtime exposes that API.
 *
 * @param message Message to display.
 * @param durationMs Display duration in milliseconds.
 * @param type Native message type.
 * @returns `true` when the native API handled the message.
 */
export function showNativeMessage(message: string, durationMs: number, type: string): boolean {
  const showMessage = getSiyuanGlobal()?.showMessage;
  if (!showMessage) return false;
  showMessage(message, durationMs, type);
  return true;
}
