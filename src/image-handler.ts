import type { ImageRef, HugoConfig } from "./types";
import { fileExists, makeDir, readFileBlob, putFileBlob, toWorkspacePath } from "./api";

export interface ImageCopyResult {
  ref: ImageRef;
  success: boolean;
  error?: string;
}

export async function copyImagesToHugo(
  images: ImageRef[],
  config: HugoConfig
): Promise<ImageCopyResult[]> {
  if (images.length === 0) return [];

  const results: ImageCopyResult[] = [];

  for (const img of images) {
    try {
      const srcPath = `/data/assets/${img.siyuanPath.replace(/^assets\//, "")}`;

      const destPath = `${toWorkspacePath(config.hugoProjectPath)}/${img.targetPath}`;
      const destDir = destPath.slice(0, destPath.lastIndexOf("/"));

      await makeDir(destDir);

      const srcExists = await fileExists(srcPath);
      if (!srcExists) {
        results.push({ ref: img, success: false, error: `Source introuvable: ${srcPath}` });
        continue;
      }

      const blob = await readFileBlob(srcPath);
      await putFileBlob(destPath, blob);

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

export async function validateHugoProject(config: HugoConfig): Promise<{ valid: boolean; error?: string }> {
  if (!config.hugoProjectPath) {
    return { valid: false, error: "Chemin Hugo non configuré" };
  }

  const base = toWorkspacePath(config.hugoProjectPath);
  const candidates = [`${base}/hugo.toml`, `${base}/hugo.yaml`, `${base}/config.toml`, `${base}/config.yaml`];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    error: `Aucun fichier de config Hugo trouvé dans ${base}\n(hugo.toml / config.toml attendu)`,
  };
}
