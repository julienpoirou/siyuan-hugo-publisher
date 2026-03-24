import type { SyncStatus, DocSyncEntry, ImageRefStore, SyncMirrorStore } from "./types";
import { hashContent } from "./hash";
import { cleanSiYuanMarkdown, resolveIcon } from "./converter";
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

export function initSyncState(plugin: typeof pluginInstance): void {
  pluginInstance = plugin;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

async function loadImageRefStore(): Promise<ImageRefStore> {
  if (!pluginInstance) return {};
  try {
    const data = await pluginInstance.loadData(IMAGE_REFS_KEY);
    return migrateImageRefStore(data);
  } catch {
    return {};
  }
}

async function saveImageRefStore(store: ImageRefStore): Promise<void> {
  if (!pluginInstance) return;
  await pluginInstance.saveData(IMAGE_REFS_KEY, wrapVersionedPayload(store));
}

async function loadSyncMirrorStore(): Promise<SyncMirrorStore> {
  if (!pluginInstance) return {};
  try {
    const data = await pluginInstance.loadData(SYNC_MIRROR_KEY);
    return migrateSyncMirrorStore(data);
  } catch {
    return {};
  }
}

async function saveSyncMirrorStore(store: SyncMirrorStore): Promise<void> {
  if (!pluginInstance) return;
  await pluginInstance.saveData(SYNC_MIRROR_KEY, wrapVersionedPayload(store));
}

export async function getMirroredDocIds(): Promise<string[]> {
  const mirror = await loadSyncMirrorStore();
  return Object.keys(mirror);
}

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

export async function setSyncEntry(docId: string, entry: DocSyncEntry): Promise<void> {
  const mirror = await loadSyncMirrorStore();
  mirror[docId] = entry;
  await saveSyncMirrorStore(mirror);

  await setBlockAttrs(docId, {
    [ATTR_HASH]:     entry.hash,
    [ATTR_LASTSYNC]: entry.lastSync,
    [ATTR_PATH]:     entry.hugoPath,
    [ATTR_SLUG]:     entry.slug,
    [ATTR_IMAGES]:   JSON.stringify(entry.images),
  });
}

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
  const currentHash = await hashContent(
    `${cleaned}\n${resolveIcon(ial["icon"] ?? "")}\n${ial["title-img"] ?? ""}`
  );

  const entry = await getSyncEntry(docId);
  if (!entry) return { status: "not-published", currentHash };
  if (entry.hash === currentHash) return { status: "synced", currentHash };
  return { status: "modified", currentHash };
}
