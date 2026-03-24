function formatScope(scope: string, message: string): string {
  return `[HugoPublisher:${scope}] ${message}`;
}

function toErrorMeta(error: unknown): unknown[] {
  return error === undefined ? [] : [error];
}

export function createLogger(scope: string) {
  return {
    info(message: string, ...meta: unknown[]): void {
      console.info(formatScope(scope, message), ...meta);
    },
    warn(message: string, error?: unknown): void {
      console.warn(formatScope(scope, message), ...toErrorMeta(error));
    },
    error(message: string, error?: unknown): void {
      console.error(formatScope(scope, message), ...toErrorMeta(error));
    },
  };
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
