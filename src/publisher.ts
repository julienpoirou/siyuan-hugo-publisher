import type { HugoConfig, SyncStatus } from "./types";
import { exportMdContent, getBlockAttrs, putFile, makeDir, toWorkspacePath, fileExists, readFileText, removeFile, docExists, readDir } from "./api";
import { convertDoc, renderMarkdownFile } from "./converter";
import { copyImagesToHugo, validateHugoProject } from "./image-handler";
import { computeSyncStatus, setSyncEntry, getSyncEntry, removeSyncEntry, reconcileImageRefsForDoc } from "./sync-state";
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
 *
 * @param value Raw path segment.
 * @returns The trimmed segment.
 */
function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Resolves the effective Hugo content directory, optionally inserting a language prefix.
 *
 * @param contentDir Configured Hugo content directory.
 * @param language Optional language code.
 * @returns The localized content directory path.
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
 * @param config Active Hugo publishing configuration.
 * @returns Resolved destination helpers.
 */
function buildHugoDestination(config: HugoConfig): HugoDestination {
  const hugoBase = toWorkspacePath(config.hugoProjectPath);
  const contentDir = resolveLocalizedContentDir(config.contentDir, config.language);
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
 *
 * @param paths Candidate paths.
 * @returns Unique normalized paths.
 */
function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => trimSlashes(path)).filter(Boolean)));
}

/**
 * Normalizes rendered Markdown before status comparison.
 *
 * `lastmod` can drift after publish because writing block attributes in SiYuan
 * may update the document metadata timestamp without changing the actual note
 * content. That should not flip a freshly synced badge back to `Modified`.
 *
 * @param content Rendered Markdown file content.
 * @returns Comparable content with volatile metadata removed.
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
 *
 * @param hugoRelPath Relative Hugo content path.
 * @returns Candidate generated public artifact paths.
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
 * Removes published files relative to the configured Hugo project root.
 *
 * @param paths Relative file paths to remove.
 * @param config Active Hugo publishing configuration.
 */
async function removePublishedFiles(paths: string[], config: HugoConfig): Promise<void> {
  const hugoBase = toWorkspacePath(config.hugoProjectPath);
  for (const relPath of uniquePaths(paths)) {
    try {
      await removeFile(`${hugoBase}/${relPath}`);
    } catch (err) {
      log.warn(`Non-blocking cleanup failure for ${relPath}`, err);
    }
  }
}

/**
 * Removes a published content file and its likely generated public artifacts.
 *
 * @param hugoRelPath Relative Hugo content path.
 * @param config Active Hugo publishing configuration.
 */
async function removePublishedPageArtifacts(hugoRelPath: string, config: HugoConfig): Promise<void> {
  await removePublishedFiles(
    [hugoRelPath, ...deriveGeneratedPublicPaths(hugoRelPath)],
    config
  );
}

/**
 * Writes a marker file used to trigger a Hugo-side refresh.
 *
 * @param config Active Hugo publishing configuration.
 */
async function triggerHugoRefresh(config: HugoConfig): Promise<void> {
  const hugoBase = toWorkspacePath(config.hugoProjectPath);
  const markerDir = `${hugoBase}/data`;
  const markerPath = `${markerDir}/siyuan-hugo-publisher-refresh.json`;
  const markerContent = JSON.stringify({
    refreshedAt: new Date().toISOString(),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  }, null, 2);
  await makeDir(markerDir);
  await putFile(markerPath, `${markerContent}\n`);
}

/**
 * Resolves a unique slug by probing the target directory for collisions.
 *
 * @param baseSlug Initial slug candidate.
 * @param docId SiYuan document identifier.
 * @param destDir Destination directory path ending with a slash.
 * @returns A slug that is unique for the target directory.
 */
async function resolveUniqueSlug(
  baseSlug: string,
  docId: string,
  destDir: string
): Promise<string> {
  let slug = baseSlug;
  let counter = 0;
  while (true) {
    const filePath = `${destDir}${slug}.md`;
    if (!(await fileExists(filePath))) return slug;
    try {
      const content = await readFileText(filePath);
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
 * @returns The publish operation result.
 */
export async function publishDoc(
  docId: string,
  config: HugoConfig
): Promise<PublishResult> {
  const validation = await validateHugoProject(config);
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

  const imageResults = await copyImagesToHugo(converted.images, config);
  const imagesErrors = imageResults.filter((r) => !r.success).map((r) => r.error ?? "Erreur inconnue");
  const publishedImages = uniquePaths(
    imageResults
      .filter((r) => r.success)
      .map((r) => r.ref.targetPath)
  );

  const destination = buildHugoDestination(config);
  const previousEntry = await getSyncEntry(docId);

  const slug = await resolveUniqueSlug(converted.frontMatter.slug, docId, `${destination.dirPath}/`);
  converted.frontMatter.slug = slug;

  const hugoRelPath = destination.relativePath(slug);
  const destPath = destination.filePath(slug);

  try {
    await makeDir(destination.dirPath);
  } catch (err) {
    log.warn(`Unable to ensure destination directory ${destination.dirPath}`, err);
  }

  const fileContent = renderMarkdownFile(converted);

  try {
    await putFile(destPath, fileContent);
  } catch (err) {
    return {
      success: false,
      message: `Erreur écriture fichier: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (previousEntry?.hugoPath && previousEntry.hugoPath !== hugoRelPath) {
    await removePublishedPageArtifacts(previousEntry.hugoPath, config);
  }

  const orphanedImages = await reconcileImageRefsForDoc(docId, previousEntry?.images ?? [], publishedImages);
  await removePublishedFiles(orphanedImages, config);

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
    await triggerHugoRefresh(config);
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
 *
 * @param docId SiYuan document identifier.
 * @param config Active Hugo publishing configuration.
 * @returns The unpublish operation result.
 */
export async function unpublishDoc(docId: string, config: HugoConfig): Promise<UnpublishResult> {
  const entry = await getSyncEntry(docId);
  if (!entry?.hugoPath) {
    return { success: false, message: "Document non publié" };
  }

  await removePublishedPageArtifacts(entry.hugoPath, config);

  const orphanedImages = await reconcileImageRefsForDoc(docId, entry.images, []);
  await removePublishedFiles(orphanedImages, config);

  try {
    await triggerHugoRefresh(config);
  } catch (err) {
    log.warn(`Unable to trigger Hugo refresh after unpublish for ${docId}`, err);
  }

  await removeSyncEntry(docId);
  return { success: true, message: `Dépublié : ${entry.hugoPath}`, hugoPath: entry.hugoPath };
}

/**
 * Computes the current publish status for a SiYuan document.
 *
 * @param docId SiYuan document identifier.
 * @param config Active Hugo publishing configuration.
 * @returns The current sync status and related metadata.
 */
export async function getDocStatus(docId: string, config: HugoConfig): Promise<StatusResult> {
  const entry = await getSyncEntry(docId);
  if (!entry?.hugoPath) {
    return { status: "not-published", currentHash: "" };
  }

  const hugoPath = `${toWorkspacePath(config.hugoProjectPath)}/${entry.hugoPath}`;
  const exists = await fileExists(hugoPath);
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
 *
 * @param config Active Hugo publishing configuration.
 * @returns Lists of removed orphan paths and encountered errors.
 */
export async function reconcileOrphanDocs(config: HugoConfig): Promise<OrphanResult> {
  const removed: string[] = [];
  const errors: string[] = [];

  const destination = buildHugoDestination(config);
  const hugoBase = toWorkspacePath(config.hugoProjectPath);

  /**
   * Recursively scans the Hugo content tree for orphaned published files.
   *
   * @param dirPath Directory path to scan.
   */
  async function scanDir(dirPath: string): Promise<void> {
    const entries = await readDir(dirPath);
    for (const entry of entries) {
      const fullPath = `${dirPath}/${entry.name}`;
      if (entry.isDir) { await scanDir(fullPath); continue; }
      if (!entry.name.endsWith(".md")) continue;

      let content: string;
      try {
        content = await readFileText(fullPath);
      } catch (err) {
        log.warn(`Unable to read candidate orphan file ${fullPath}`, err);
        continue;
      }

      const match = content.match(/^siyuan_id:\s*"([^"]+)"/m);
      if (!match) continue;
      const siyuanId = match[1];

      const relPath = fullPath.startsWith(`${hugoBase}/`)
        ? fullPath.slice(`${hugoBase}/`.length)
        : fullPath;

      const exists = await docExists(siyuanId);
      const syncEntry = await getSyncEntry(siyuanId);
      const isStale = exists && !!syncEntry?.hugoPath && syncEntry.hugoPath !== relPath;
      if (!isStale && exists) continue;

      try {
        await removePublishedPageArtifacts(relPath, config);
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
      await triggerHugoRefresh(config);
    } catch (err) {
      log.warn("Unable to trigger Hugo refresh after orphan cleanup", err);
    }
  }

  return { removed, errors };
}
const log = createLogger("publisher");
