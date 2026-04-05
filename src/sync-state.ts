import type { SyncStatus, DocSyncEntry, ImageRefStore, SyncMirrorStore } from "./types";
import { hashContent } from "./hash";
import { buildSyncSignature, cleanSiYuanMarkdown } from "./converter";
import { getBlockAttrs, setBlockAttrs } from "./api";
import { createLogger } from "./logger";
import { migrateImageRefStore, migrateSyncMirrorStore, wrapVersionedPayload } from "./data-migrations";

const ATTR_HASH     = "custom-hugo-hash";
const ATTR_LASTSYNC = "custom-hugo-lastsync";
const ATTR_PATH     = "custom-hugo-path";
const ATTR_SLUG     = "custom-hugo-slug";
const ATTR_IMAGES   = "custom-hugo-images";
const IMAGE_REFS_KEY = "hugo-image-refs";
const SYNC_MIRROR_KEY = "hugo-sync-mirror";
const log = createLogger("sync-state");

let pluginInstance: {
  loadData: (key: string) => Promise<unknown>;
  saveData: (key: string, value: unknown) => Promise<unknown>;
} | null = null;

/**
 * Registers the plugin instance used to persist sync metadata.
 *
 * @param plugin Plugin instance exposing persistence helpers.
 */
export function initSyncState(plugin: typeof pluginInstance): void {
  pluginInstance = plugin;
}

/**
 * Deduplicates and filters path values.
 *
 * @param paths Candidate paths.
 * @returns Unique non-empty paths.
 */
function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

/**
 * Loads the persisted image reference store.
 *
 * @returns The normalized image reference store.
 */
async function loadImageRefStore(): Promise<ImageRefStore> {
  if (!pluginInstance) return {};
  try {
    const data = await pluginInstance.loadData(IMAGE_REFS_KEY);
    return migrateImageRefStore(data);
  } catch {
    return {};
  }
}

/**
 * Persists the image reference store.
 *
 * @param store Image reference store to save.
 */
async function saveImageRefStore(store: ImageRefStore): Promise<void> {
  if (!pluginInstance) return;
  await pluginInstance.saveData(IMAGE_REFS_KEY, wrapVersionedPayload(store));
}

/**
 * Loads the persisted sync mirror store.
 *
 * @returns The normalized sync mirror store.
 */
async function loadSyncMirrorStore(): Promise<SyncMirrorStore> {
  if (!pluginInstance) return {};
  try {
    const data = await pluginInstance.loadData(SYNC_MIRROR_KEY);
    return migrateSyncMirrorStore(data);
  } catch {
    return {};
  }
}

/**
 * Persists the sync mirror store.
 *
 * @param store Sync mirror store to save.
 */
async function saveSyncMirrorStore(store: SyncMirrorStore): Promise<void> {
  if (!pluginInstance) return;
  await pluginInstance.saveData(SYNC_MIRROR_KEY, wrapVersionedPayload(store));
}

/**
 * Lists all document identifiers present in the mirror store.
 *
 * @returns Mirrored document identifiers.
 */
export async function getMirroredDocIds(): Promise<string[]> {
  const mirror = await loadSyncMirrorStore();
  return Object.keys(mirror);
}

/**
 * Reads sync metadata for a published document.
 *
 * @param docId SiYuan document identifier.
 * @returns The sync entry or `null` when unavailable.
 */
export async function getSyncEntry(docId: string): Promise<DocSyncEntry | null> {
  try {
    const attrs = await getBlockAttrs(docId);
    const hash = attrs[ATTR_HASH];
    if (!hash) return null;
    let images: string[] = [];
    try {
      const parsed = JSON.parse(attrs[ATTR_IMAGES] ?? "[]");
      if (Array.isArray(parsed)) {
        images = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      images = [];
    }
    return {
      hash,
      lastSync: attrs[ATTR_LASTSYNC] ?? "",
      hugoPath: attrs[ATTR_PATH] ?? "",
      slug:     attrs[ATTR_SLUG]  ?? "",
      images,
    };
  } catch {
    const mirror = await loadSyncMirrorStore();
    return mirror[docId] ?? null;
  }
}

/**
 * Persists sync metadata for a published document in both plugin storage and block attributes.
 *
 * @param docId SiYuan document identifier.
 * @param entry Sync metadata to save.
 */
export async function setSyncEntry(docId: string, entry: DocSyncEntry): Promise<void> {
  const mirror = await loadSyncMirrorStore();
  mirror[docId] = entry;
  await saveSyncMirrorStore(mirror);

  try {
    await setBlockAttrs(docId, {
      [ATTR_HASH]:     entry.hash,
      [ATTR_LASTSYNC]: entry.lastSync,
      [ATTR_PATH]:     entry.hugoPath,
      [ATTR_SLUG]:     entry.slug,
      [ATTR_IMAGES]:   JSON.stringify(entry.images),
    });
  } catch (err) {
    // Block attrs are a convenience cache; the mirror store is the source of truth.
    // "tree not found" happens when the document's notebook is not mounted.
    log.warn(`Unable to write sync attrs for ${docId} (notebook may be unmounted)`, err);
  }
}

/**
 * Removes sync metadata for a document from storage and block attributes.
 *
 * @param docId SiYuan document identifier.
 */
export async function removeSyncEntry(docId: string): Promise<void> {
  const mirror = await loadSyncMirrorStore();
  if (mirror[docId]) {
    delete mirror[docId];
    await saveSyncMirrorStore(mirror);
  }

  try {
    await setBlockAttrs(docId, {
      [ATTR_HASH]:     "",
      [ATTR_LASTSYNC]: "",
      [ATTR_PATH]:     "",
      [ATTR_SLUG]:     "",
      [ATTR_IMAGES]:   "",
    });
  } catch {
    log.warn(`Unable to clear sync attrs for ${docId}`);
  }
}

/**
 * Updates the reverse image-reference index for a document publish cycle.
 *
 * @param docId SiYuan document identifier.
 * @param previousImages Previously published image paths.
 * @param nextImages Newly published image paths.
 * @returns Image paths that are no longer referenced by any document.
 */
export async function reconcileImageRefsForDoc(
  docId: string,
  previousImages: string[],
  nextImages: string[]
): Promise<string[]> {
  const prev = uniquePaths(previousImages);
  const next = uniquePaths(nextImages);
  const store = await loadImageRefStore();
  const orphaned: string[] = [];

  for (const imagePath of prev) {
    if (next.includes(imagePath)) continue;
    const refs = (store[imagePath] ?? []).filter((refDocId) => refDocId !== docId);
    if (refs.length === 0) {
      delete store[imagePath];
      orphaned.push(imagePath);
    } else {
      store[imagePath] = refs;
    }
  }

  for (const imagePath of next) {
    const refs = new Set(store[imagePath] ?? []);
    refs.add(docId);
    store[imagePath] = Array.from(refs);
  }

  await saveImageRefStore(store);
  return orphaned;
}

/**
 * Computes the sync status of a document by hashing its current exported content.
 *
 * @param docId SiYuan document identifier.
 * @param currentContent Current exported Markdown.
 * @returns The computed status and current content hash.
 */
export async function computeSyncStatus(
  docId: string,
  currentContent: string
): Promise<{ status: SyncStatus; currentHash: string }> {
  const cleaned = cleanSiYuanMarkdown(currentContent);

  let ial: Record<string, string> = {};
  try {
    ial = await getBlockAttrs(docId);
  } catch (err) {
    log.warn(`Unable to read block attrs for sync hash on ${docId}`, err);
  }
  const currentHash = await hashContent(buildSyncSignature(cleaned, ial));

  const entry = await getSyncEntry(docId);
  if (!entry) return { status: "not-published", currentHash };
  if (entry.hash === currentHash) return { status: "synced", currentHash };
  return { status: "modified", currentHash };
}
