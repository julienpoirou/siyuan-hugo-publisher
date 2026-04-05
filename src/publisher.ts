import type { HugoConfig, SyncStatus } from "./types";
import type { StorageAdapter } from "./storage-adapter";
import { exportMdContent, getBlockAttrs, toWorkspacePath } from "./api";
import { convertDoc, renderMarkdownFile, slugify } from "./converter";
import { copyImagesToHugo, validateHugoProject } from "./image-handler";
import { computeSyncStatus, setSyncEntry, getSyncEntry, removeSyncEntry, reconcileImageRefsForDoc, getMirroredDocIds } from "./sync-state";
import { createLogger, getErrorMessage } from "./logger";

export interface PublishResult {
  success: boolean;
  message: string;
  hugoPath?: string;
  imagesCopied?: number;
  imagesErrors?: string[];
}

export interface StatusResult {
  status: SyncStatus;
  currentHash: string;
  lastSync?: string;
  hugoPath?: string;
}

interface HugoDestination {
  contentDir: string;
  dirPath: string;
  filePath: (slug: string) => string;
  relativePath: (slug: string) => string;
}

/**
 * Removes leading and trailing slashes from a path segment.
 */
function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Resolves the effective Hugo content directory, optionally inserting a language prefix.
 */
export function resolveLocalizedContentDir(contentDir: string, language: string): string {
  const normalizedDir = trimSlashes(contentDir);
  const normalizedLang = trimSlashes(language);
  if (!normalizedLang) return normalizedDir;

  const segments = normalizedDir.split("/").filter(Boolean);
  if (segments[0] === "content") {
    return [segments[0], normalizedLang, ...segments.slice(1)].join("/");
  }
  return [normalizedLang, ...segments].join("/");
}

/**
 * Builds the destination helpers used for Hugo content output paths.
 *
 * When `preserveDocTree` is enabled and `hPath` is provided, the SiYuan
 * hierarchical path is mirrored as subfolders under `contentDir`.
 *
 * @param config Active Hugo publishing configuration.
 * @param adapter Active storage adapter (provides the hugo base path).
 * @param hPath Optional SiYuan hierarchical path used for tree mirroring.
 */
function buildHugoDestination(config: HugoConfig, adapter: StorageAdapter, hPath?: string): HugoDestination {
  const hugoBase = adapter.hugoBase;
  let contentDir = resolveLocalizedContentDir(config.contentDir, config.language);

  if (config.preserveDocTree && hPath) {
    const folderSegments = hPath.split("/").filter(Boolean).slice(0, -1);
    if (folderSegments.length > 0) {
      contentDir = `${contentDir}/${folderSegments.map(slugify).join("/")}`;
    }
  }

  const dirPath = `${hugoBase}/${contentDir}`;
  return {
    contentDir,
    dirPath,
    filePath: (slug: string) => `${dirPath}/${slug}.md`,
    relativePath: (slug: string) => `${contentDir}/${slug}.md`,
  };
}

/**
 * Deduplicates and normalizes relative paths.
 */
function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => trimSlashes(p)).filter(Boolean)));
}

/**
 * Normalizes rendered Markdown before status comparison.
 */
export function normalizeRenderedContentForComparison(content: string): string {
  return content
    .replace(/^lastmod:\s*"[^"]*"\r?$\n?/m, "")
    .replace(/^hash:\s*"[^"]*"\r?$\n?/m, "")
    .replace(/&#123;&#123;/g, "{{")
    .replace(/>&#125;&#125;/g, ">}}")
    .replace(/%&#125;&#125;/g, "%}}");
}

/**
 * Derives common Hugo public output paths generated from a content file.
 */
export function deriveGeneratedPublicPaths(hugoRelPath: string): string[] {
  const normalized = trimSlashes(hugoRelPath);
  if (!normalized.endsWith(".md")) return [];

  const withoutContent = normalized.startsWith("content/")
    ? normalized.slice("content/".length)
    : normalized;
  const pagePath = withoutContent.replace(/\.md$/, "");

  return uniquePaths([
    `public/${pagePath}`,
    `public/${pagePath}/index.html`,
    `public/${pagePath}.html`,
  ]);
}

/**
 * Removes published files relative to the Hugo project root.
 *
 * In git mode, public artifact paths are skipped (Hugo's dev server does not
 * generate a public/ directory in the repository).
 */
async function removePublishedFiles(paths: string[], adapter: StorageAdapter): Promise<void> {
  for (const relPath of uniquePaths(paths)) {
    try {
      await adapter.deleteFile(`${adapter.hugoBase}/${relPath}`);
    } catch (err) {
      log.warn(`Non-blocking cleanup failure for ${relPath}`, err);
    }
  }
}

/**
 * Removes a published content file and its generated public artifacts.
 *
 * Public artifacts are only attempted in filesystem mode.
 */
async function removePublishedPageArtifacts(
  hugoRelPath: string,
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<void> {
  const artifacts = config.publishMode === "git"
    ? []
    : deriveGeneratedPublicPaths(hugoRelPath);

  await removePublishedFiles([hugoRelPath, ...artifacts], adapter);
}

/**
 * Writes a marker file to trigger Hugo's filesystem watcher (filesystem mode only).
 */
async function triggerHugoRefresh(config: HugoConfig, adapter: StorageAdapter): Promise<void> {
  if (config.publishMode === "git") return;

  const hugoBase = toWorkspacePath(config.hugoProjectPath);
  const markerDir = `${hugoBase}/data`;
  const markerPath = `${markerDir}/siyuan-hugo-publisher-refresh.json`;
  const markerContent = JSON.stringify({
    refreshedAt: new Date().toISOString(),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  }, null, 2);
  await adapter.ensureDir(markerDir);
  await adapter.putTextFile(markerPath, `${markerContent}\n`);
}

/**
 * Resolves a unique slug by probing the target directory for collisions.
 */
async function resolveUniqueSlug(
  baseSlug: string,
  docId: string,
  destDir: string,
  adapter: StorageAdapter
): Promise<string> {
  let slug = baseSlug;
  let counter = 0;
  while (true) {
    const filePath = `${destDir}${slug}.md`;
    if (!(await adapter.fileExists(filePath))) return slug;
    try {
      const content = await adapter.readText(filePath);
      if (content.includes(`siyuan_id: "${docId}"`)) return slug;
    } catch (err) {
      log.warn(`Unable to inspect existing slug at ${filePath}`, err);
    }
    counter++;
    slug = `${baseSlug}_${counter}`;
  }
}

/**
 * Publishes a SiYuan document to the configured Hugo project.
 *
 * @param docId SiYuan document identifier.
 * @param config Active Hugo publishing configuration.
 * @param adapter Active storage adapter (filesystem or git).
 * @returns The publish operation result.
 */
export async function publishDoc(
  docId: string,
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<PublishResult> {
  const validation = await validateHugoProject(config, adapter);
  if (!validation.valid) {
    return { success: false, message: validation.error ?? "Projet Hugo invalide" };
  }

  let exported: { hPath: string; content: string };
  try {
    exported = await exportMdContent(docId);
  } catch (err) {
    return {
      success: false,
      message: `Erreur export SiYuan: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let ial: Record<string, string> = {};
  try {
    ial = await getBlockAttrs(docId);
  } catch (err) {
    log.warn(`Unable to read block attributes for ${docId}`, err);
  }

  const docName = exported.hPath.split("/").pop() ?? docId;

  if (config.publishTag) {
    const tags = (ial["tags"] ?? "").split(/\s+/).map((t) => t.replace(/^#/, ""));
    if (!tags.includes(config.publishTag)) {
      return {
        success: false,
        message: `Document sans tag "${config.publishTag}" — publication ignorée`,
      };
    }
  }

  let converted;
  try {
    converted = await convertDoc(docId, exported.content, docName, ial, config);
  } catch (err) {
    return {
      success: false,
      message: `Erreur de conversion: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const imageResults = await copyImagesToHugo(converted.images, config, adapter);
  const imagesErrors = imageResults.filter((r) => !r.success).map((r) => r.error ?? "Erreur inconnue");
  const publishedImages = uniquePaths(
    imageResults.filter((r) => r.success).map((r) => r.ref.targetPath)
  );

  const destination = buildHugoDestination(config, adapter, exported.hPath);
  const previousEntry = await getSyncEntry(docId);

  const slug = await resolveUniqueSlug(
    converted.frontMatter.slug,
    docId,
    `${destination.dirPath}/`,
    adapter
  );
  converted.frontMatter.slug = slug;

  const hugoRelPath = destination.relativePath(slug);
  const destPath = destination.filePath(slug);

  try {
    await adapter.ensureDir(destination.dirPath);
  } catch (err) {
    log.warn(`Unable to ensure destination directory ${destination.dirPath}`, err);
  }

  const fileContent = renderMarkdownFile(converted);

  try {
    await adapter.putTextFile(destPath, fileContent);
  } catch (err) {
    return {
      success: false,
      message: `Erreur écriture fichier: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (previousEntry?.hugoPath && previousEntry.hugoPath !== hugoRelPath) {
    await removePublishedPageArtifacts(previousEntry.hugoPath, config, adapter);
  }

  const orphanedImages = await reconcileImageRefsForDoc(docId, previousEntry?.images ?? [], publishedImages);
  await removePublishedFiles(orphanedImages, adapter);

  const lastSync = new Date().toISOString();
  let stableHash = converted.frontMatter.hash;

  await setSyncEntry(docId, {
    hash: stableHash,
    lastSync,
    hugoPath: hugoRelPath,
    slug,
    images: publishedImages,
  });

  try {
    const refreshed = await exportMdContent(docId);
    const refreshedStatus = await computeSyncStatus(docId, refreshed.content);
    stableHash = refreshedStatus.currentHash;
    if (stableHash !== converted.frontMatter.hash) {
      await setSyncEntry(docId, {
        hash: stableHash,
        lastSync,
        hugoPath: hugoRelPath,
        slug,
        images: publishedImages,
      });
    }
  } catch (err) {
    log.warn(`Unable to stabilize sync hash after publish for ${docId}`, err);
  }

  try {
    await triggerHugoRefresh(config, adapter);
  } catch (err) {
    log.warn(`Unable to trigger Hugo refresh for ${docId}`, err);
  }

  return {
    success: true,
    message: `Publié: ${hugoRelPath}`,
    hugoPath: hugoRelPath,
    imagesCopied: imageResults.filter((r) => r.success).length,
    imagesErrors,
  };
}

export interface UnpublishResult {
  success: boolean;
  message: string;
  hugoPath?: string;
}

/**
 * Unpublishes a previously published SiYuan document from the Hugo project.
 */
export async function unpublishDoc(
  docId: string,
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<UnpublishResult> {
  const entry = await getSyncEntry(docId);
  if (!entry?.hugoPath) {
    return { success: false, message: "Document non publié" };
  }

  await removePublishedPageArtifacts(entry.hugoPath, config, adapter);

  const orphanedImages = await reconcileImageRefsForDoc(docId, entry.images, []);
  await removePublishedFiles(orphanedImages, adapter);

  try {
    await triggerHugoRefresh(config, adapter);
  } catch (err) {
    log.warn(`Unable to trigger Hugo refresh after unpublish for ${docId}`, err);
  }

  await removeSyncEntry(docId);
  return { success: true, message: `Dépublié : ${entry.hugoPath}`, hugoPath: entry.hugoPath };
}

/**
 * Computes the current publish status for a SiYuan document.
 */
export async function getDocStatus(
  docId: string,
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<StatusResult> {
  const entry = await getSyncEntry(docId);
  if (!entry?.hugoPath) {
    return { status: "not-published", currentHash: "" };
  }

  const hugoPath = `${adapter.hugoBase}/${entry.hugoPath}`;
  const exists = await adapter.fileExists(hugoPath);
  if (!exists) {
    return {
      status: "not-published",
      currentHash: entry.hash,
      lastSync: entry.lastSync,
      hugoPath: entry.hugoPath,
    };
  }

  return {
    status: "synced",
    currentHash: entry.hash,
    lastSync: entry.lastSync,
    hugoPath: entry.hugoPath,
  };
}

export interface OrphanResult {
  removed: string[];
  errors: string[];
}

/**
 * Removes published Hugo pages whose backing SiYuan documents no longer exist or moved.
 */
export async function reconcileOrphanDocs(
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<OrphanResult> {
  const removed: string[] = [];
  const errors: string[] = [];

  const destination = buildHugoDestination(config, adapter);

  async function scanDir(dirPath: string): Promise<void> {
    const entries = await adapter.listDir(dirPath);
    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (entry.isDir) { await scanDir(fullPath); continue; }
      if (!entry.name.endsWith(".md")) continue;

      let content: string;
      try {
        content = await adapter.readText(fullPath);
      } catch (err) {
        log.warn(`Unable to read candidate orphan file ${fullPath}`, err);
        continue;
      }

      const match = content.match(/^siyuan_id:\s*"([^"]+)"/m);
      if (!match) continue;
      const siyuanId = match[1];

      const relPath = fullPath.startsWith(`${adapter.hugoBase}/`)
        ? fullPath.slice(`${adapter.hugoBase}/`.length)
        : fullPath;

      const { docExists } = await import("./api");
      const exists = await docExists(siyuanId);
      const syncEntry = await getSyncEntry(siyuanId);
      const isStale = exists && !!syncEntry?.hugoPath && syncEntry.hugoPath !== relPath;
      if (!isStale && exists) continue;

      try {
        await removePublishedPageArtifacts(relPath, config, adapter);
        if (!exists) await removeSyncEntry(siyuanId);
        removed.push(relPath);
      } catch (err) {
        errors.push(`${fullPath}: ${getErrorMessage(err)}`);
      }
    }
  }

  try {
    await scanDir(destination.dirPath);
  } catch (err) {
    errors.push(`Scan error: ${getErrorMessage(err)}`);
  }

  if (removed.length > 0) {
    try {
      await triggerHugoRefresh(config, adapter);
    } catch (err) {
      log.warn("Unable to trigger Hugo refresh after orphan cleanup", err);
    }
  }

  return { removed, errors };
}

export interface RetreeResult {
  moved: number;
  errors: string[];
}

/**
 * Re-publishes all mirrored documents to update their Hugo paths.
 *
 * Called when `preserveDocTree` is toggled so existing notes are
 * reorganized in the Hugo content tree.
 */
export async function retreePublishedDocs(
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<RetreeResult> {
  const docIds = await getMirroredDocIds();
  let moved = 0;
  const errors: string[] = [];

  for (const docId of docIds) {
    try {
      const result = await publishDoc(docId, config, adapter);
      if (result.success) {
        moved++;
      } else {
        errors.push(`${docId}: ${result.message}`);
      }
    } catch (err) {
      errors.push(`${docId}: ${getErrorMessage(err)}`);
    }
  }

  return { moved, errors };
}

const log = createLogger("publisher");
