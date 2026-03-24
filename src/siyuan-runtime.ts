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

export function getSiyuanGlobal(): SiyuanGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return window.siyuan;
}

export function getSiyuanApiToken(): string {
  return getSiyuanGlobal()?.config?.api?.token ?? "";
}

export function removeNativeMenu(): boolean {
  const menu = getSiyuanGlobal()?.menus?.menu;
  if (!menu) return false;
  menu.remove();
  return true;
}

export function showNativeMessage(message: string, durationMs: number, type: string): boolean {
  const showMessage = getSiyuanGlobal()?.showMessage;
  if (!showMessage) return false;
  showMessage(message, durationMs, type);
  return true;
}
