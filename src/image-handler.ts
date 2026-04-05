import type { ImageRef, HugoConfig } from "./types";
import type { StorageAdapter } from "./storage-adapter";
import { fileExists, readFileBlob } from "./api";

export interface ImageCopyResult {
  ref: ImageRef;
  success: boolean;
  error?: string;
}

/**
 * Copies referenced SiYuan assets into the configured Hugo static directory.
 *
 * Source files are always read from the SiYuan workspace via the local file API.
 * Destination writes are routed through the storage adapter (filesystem or git).
 *
 * @param images Image references extracted from a converted document.
 * @param config Active Hugo publishing configuration.
 * @param adapter Active storage adapter.
 * @returns Per-image copy results.
 */
export async function copyImagesToHugo(
  images: ImageRef[],
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<ImageCopyResult[]> {
  if (images.length === 0) return [];

  const results: ImageCopyResult[] = [];

  for (const img of images) {
    try {
      const srcPath = `/data/assets/${img.siyuanPath.replace(/^assets\//, "")}`;
      const destPath = `${adapter.hugoBase}/${img.targetPath}`;
      const destDir = destPath.slice(0, destPath.lastIndexOf("/"));

      await adapter.ensureDir(destDir);

      const srcExists = await fileExists(srcPath);
      if (!srcExists) {
        results.push({ ref: img, success: false, error: `Source introuvable: ${srcPath}` });
        continue;
      }

      const blob = await readFileBlob(srcPath);
      await adapter.putBlobFile(destPath, blob);

      results.push({ ref: img, success: true });
    } catch (err) {
      results.push({
        ref: img,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Validates the Hugo project through the active storage adapter.
 *
 * @param config Active Hugo publishing configuration (used for error messages).
 * @param adapter Active storage adapter.
 * @returns Validation status and an optional error message.
 */
export async function validateHugoProject(
  config: HugoConfig,
  adapter: StorageAdapter
): Promise<{ valid: boolean; error?: string }> {
  return adapter.validateHugoProject();
}
