import type { DocSyncEntry, HugoConfig, ImageRefStore, SyncMirrorStore } from "./types";
import { DEFAULT_CONFIG } from "./types";

interface VersionedPayload<T> {
  version: number;
  data: T;
}

const DATA_VERSION = 1;

/**
 * Checks whether a value is a non-null object record.
 *
 * @param value Value to inspect.
 * @returns `true` when the value can be treated as a record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * Extracts the payload from a versioned persistence wrapper when present.
 *
 * @typeParam T Expected payload type.
 * @param raw Raw persisted value.
 * @returns The wrapped `data` field or the original input.
 */
function unwrapVersionedPayload<T>(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if (typeof raw.version === "number" && "data" in raw) {
    return raw.data as T;
  }
  return raw;
}

/**
 * Wraps persisted data with a schema version marker.
 *
 * @typeParam T Payload type.
 * @param data Data to wrap.
 * @returns A versioned persistence payload.
 */
export function wrapVersionedPayload<T>(data: T): VersionedPayload<T> {
  return { version: DATA_VERSION, data };
}

/**
 * Migrates raw plugin configuration into the current config shape.
 *
 * @param raw Raw persisted configuration.
 * @returns A fully populated configuration object.
 */
export function migrateConfig(raw: unknown): HugoConfig {
  const data = unwrapVersionedPayload<Partial<HugoConfig>>(raw);
  if (!isRecord(data)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...(data as Partial<HugoConfig>) };
}

/**
 * Migrates the persisted image reference index into a normalized structure.
 *
 * @param raw Raw persisted image reference data.
 * @returns A sanitized image reference store.
 */
export function migrateImageRefStore(raw: unknown): ImageRefStore {
  const data = unwrapVersionedPayload<ImageRefStore>(raw);
  if (!isRecord(data)) return {};
  const store: ImageRefStore = {};
  for (const [path, docIds] of Object.entries(data)) {
    if (!Array.isArray(docIds)) continue;
    store[path] = Array.from(new Set(docIds.filter((value): value is string => typeof value === "string")));
  }
  return store;
}

/**
 * Migrates the persisted sync mirror store into the current structure.
 *
 * @param raw Raw persisted sync mirror data.
 * @returns A sanitized sync mirror store.
 */
export function migrateSyncMirrorStore(raw: unknown): SyncMirrorStore {
  const data = unwrapVersionedPayload<SyncMirrorStore>(raw);
  if (!isRecord(data)) return {};
  const store: SyncMirrorStore = {};
  for (const [docId, rawEntry] of Object.entries(data)) {
    if (!isRecord(rawEntry) || typeof rawEntry.hash !== "string") continue;
    const entry = rawEntry as Partial<DocSyncEntry>;
    store[docId] = {
      hash: rawEntry.hash,
      lastSync: typeof entry.lastSync === "string" ? entry.lastSync : "",
      hugoPath: typeof entry.hugoPath === "string" ? entry.hugoPath : "",
      slug: typeof entry.slug === "string" ? entry.slug : "",
      images: Array.isArray(entry.images) ? entry.images.filter((value): value is string => typeof value === "string") : [],
    };
  }
  return store;
}
