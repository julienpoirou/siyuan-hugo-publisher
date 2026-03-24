import type { DocSyncEntry, HugoConfig, ImageRefStore, SyncMirrorStore } from "./types";
import { DEFAULT_CONFIG } from "./types";

interface VersionedPayload<T> {
  version: number;
  data: T;
}

const DATA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function unwrapVersionedPayload<T>(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if (typeof raw.version === "number" && "data" in raw) {
    return raw.data as T;
  }
  return raw;
}

export function wrapVersionedPayload<T>(data: T): VersionedPayload<T> {
  return { version: DATA_VERSION, data };
}

export function migrateConfig(raw: unknown): HugoConfig {
  const data = unwrapVersionedPayload<Partial<HugoConfig>>(raw);
  if (!isRecord(data)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...(data as Partial<HugoConfig>) };
}

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
