/**
 * Prefixes a log message with the plugin and subsystem scope.
 *
 * @param scope Logger scope name.
 * @param message Raw log message.
 * @returns The formatted message prefix used by console logging.
 */
function formatScope(scope: string, message: string): string {
  return `[HugoPublisher:${scope}] ${message}`;
}

/**
 * Normalizes an optional error into a spreadable metadata array.
 *
 * @param error Optional error payload.
 * @returns An empty array when absent, otherwise a single-item array.
 */
function toErrorMeta(error: unknown): unknown[] {
  return error === undefined ? [] : [error];
}

/**
 * Creates a scoped console logger used by the plugin modules.
 *
 * @param scope Subsystem scope name.
 * @returns A logger with `info`, `warn`, and `error` helpers.
 */
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

/**
 * Extracts a human-readable message from an unknown error value.
 *
 * @param error Error-like value.
 * @returns A string representation of the error.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
