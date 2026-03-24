export interface EventBusLike {
  on<TEvent = unknown>(event: string, callback: (event: TEvent) => void | Promise<void>): void;
}

export interface ProtyleRef {
  block?: {
    rootID?: string;
  };
  element?: HTMLElement;
}

export interface TreeDocElement extends HTMLElement {
  dataset: DOMStringMap & {
    nodeId?: string;
  };
}

export interface EditorTitleIconEvent {
  detail?: {
    protyle?: ProtyleRef;
    menu: {
      addItem(item: {
        icon: string;
        label: string;
        accelerator: string;
        click: () => void;
      }): void;
    };
  };
}

export interface OpenMenuDocTreeEvent {
  detail?: {
    type?: string;
    elements?: TreeDocElement[];
  };
}

export interface ProtyleLifecycleEvent {
  detail?: {
    protyle?: ProtyleRef;
  };
}

export interface WsMainEvent {
  detail?: {
    cmd?: string;
  };
}
