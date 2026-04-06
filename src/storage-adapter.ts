import type { HugoConfig } from "./types";
import { fileExists, makeDir, putFile, putFileBlob, readFileText, removeFile, readDir, toWorkspacePath } from "./api";
import { GitHubAdapter } from "./github-adapter";

/**
 * Virtual Hugo project root used in git mode to keep path computation uniform.
 * The git adapter strips this prefix when building repo-relative paths.
 */
export const GIT_VIRTUAL_BASE = "/git-root";

/**
 * Unified storage interface for Hugo content operations.
 *
 * All methods receive the same absolute paths that publisher.ts computes
 * (e.g. `/data/hugo-site/content/posts/slug.md`).
 * Each adapter interprets those paths according to its backend:
 * - FilesystemAdapter passes them straight to the SiYuan file API.
 * - GitHubAdapter strips the virtual base prefix and calls the GitHub REST API.
 */
export interface StorageAdapter {
  readonly mode: "filesystem" | "git";
  /** Absolute base for this adapter (hugoProjectPath or GIT_VIRTUAL_BASE). */
  readonly hugoBase: string;
  putTextFile(absolutePath: string, content: string): Promise<void>;
  putBlobFile(absolutePath: string, blob: Blob): Promise<void>;
  fileExists(absolutePath: string): Promise<boolean>;
  readText(absolutePath: string): Promise<string>;
  deleteFile(absolutePath: string): Promise<void>;
  ensureDir(absolutePath: string): Promise<void>;
  listDir(absolutePath: string): Promise<Array<{ isDir: boolean; name: string }>>;
  validateHugoProject(): Promise<{ valid: boolean; error?: string }>;
  flush?(): Promise<void>;
}

/**
 * Filesystem-backed adapter using the SiYuan file API.
 */
class FilesystemAdapter implements StorageAdapter {
  readonly mode = "filesystem" as const;
  readonly hugoBase: string;

  constructor(config: HugoConfig) {
    this.hugoBase = toWorkspacePath(config.hugoProjectPath);
  }

  putTextFile(path: string, content: string) { return putFile(path, content); }
  putBlobFile(path: string, blob: Blob) { return putFileBlob(path, blob); }
  fileExists(path: string) { return fileExists(path); }
  readText(path: string) { return readFileText(path); }
  deleteFile(path: string) { return removeFile(path); }
  ensureDir(path: string) { return makeDir(path); }
  listDir(path: string) { return readDir(path); }

  async validateHugoProject(): Promise<{ valid: boolean; error?: string }> {
    if (!this.hugoBase || this.hugoBase === "/") {
      return { valid: false, error: "Hugo project path not configured" };
    }
    const candidates = ["hugo.toml", "hugo.yaml", "config.toml", "config.yaml"];
    for (const f of candidates) {
      if (await fileExists(`${this.hugoBase}/${f}`)) return { valid: true };
    }
    return {
      valid: false,
      error: `No Hugo config file found in ${this.hugoBase}\n(hugo.toml / config.toml expected)`,
    };
  }
}

/**
 * Returns the appropriate storage adapter for the current publish mode.
 *
 * @param config Active plugin configuration.
 * @returns A StorageAdapter for filesystem or GitHub.
 */
export function createStorageAdapter(config: HugoConfig): StorageAdapter {
  if (config.publishMode === "git") {
    return new GitHubAdapter(config);
  }
  return new FilesystemAdapter(config);
}
