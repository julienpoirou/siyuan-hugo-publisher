import type { HugoConfig } from "./types";
import type { StorageAdapter } from "./storage-adapter";
import { GIT_VIRTUAL_BASE } from "./storage-adapter";
import { createLogger } from "./logger";

const log = createLogger("github-adapter");

interface GitHubEntry {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
}

/**
 * Extracts the GitHub owner and repository name from a remote URL.
 *
 * @param url Repository URL (HTTPS or .git suffixed).
 * @returns Owner and repo name, or null if unparseable.
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Converts an absolute publisher path to a repository-relative path.
 *
 * Publisher paths are rooted at GIT_VIRTUAL_BASE (e.g. "/git-root/content/posts/slug.md").
 * The adapter strips that prefix to obtain the repo-relative form ("content/posts/slug.md").
 *
 * @param absolutePath Publisher-computed absolute path.
 * @returns Repo-relative path suitable for the GitHub Contents API.
 */
function toRepoPath(absolutePath: string): string {
  const prefix = `${GIT_VIRTUAL_BASE}/`;
  if (absolutePath.startsWith(prefix)) return absolutePath.slice(prefix.length);
  return absolutePath.replace(/^\/+/, "");
}

/**
 * GitHub REST API-backed storage adapter.
 *
 * Each file operation (create/update/delete) produces one Git commit on the
 * configured branch. Files are addressed as repo-relative paths.
 */
export class GitHubAdapter implements StorageAdapter {
  readonly mode = "git" as const;
  readonly hugoBase = GIT_VIRTUAL_BASE;

  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly token: string;
  private readonly apiBase = "https://api.github.com";

  constructor(private readonly config: HugoConfig) {
    const parsed = parseGitHubUrl(config.gitRepoUrl);
    this.owner  = parsed?.owner ?? "";
    this.repo   = parsed?.repo  ?? "";
    this.branch = config.gitBranch || "main";
    this.token  = config.gitToken;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private endpoint(repoPath: string): string {
    const encoded = repoPath.split("/").map(encodeURIComponent).join("/");
    return `${this.apiBase}/repos/${this.owner}/${this.repo}/contents/${encoded}`;
  }

  /**
   * Fetches the SHA of a file at a given repo path, or null if it does not exist.
   *
   * @param repoPath Repo-relative path.
   * @returns The file SHA or null.
   */
  private async getFileSha(repoPath: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.endpoint(repoPath)}?ref=${encodeURIComponent(this.branch)}`, {
        headers: this.headers(),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${repoPath} → HTTP ${res.status}`);
      const json = await res.json() as { sha?: string };
      return json.sha ?? null;
    } catch (err) {
      if (err instanceof Error && err.message.includes("HTTP 404")) return null;
      throw err;
    }
  }

  /**
   * Converts a Blob to a base64-encoded string (browser-compatible).
   *
   * @param blob Source blob.
   * @returns Base64 string.
   */
  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // ---------------------------------------------------------------------------
  // StorageAdapter implementation
  // ---------------------------------------------------------------------------

  async putTextFile(absolutePath: string, content: string): Promise<void> {
    const repoPath = toRepoPath(absolutePath);
    const sha = await this.getFileSha(repoPath);
    const encoded = btoa(unescape(encodeURIComponent(content)));

    const body: Record<string, unknown> = {
      message: `publish: ${repoPath}`,
      content: encoded,
      branch: this.branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(this.endpoint(repoPath), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub PUT ${repoPath} → HTTP ${res.status}: ${detail}`);
    }
    log.info(`PUT ${repoPath} (${sha ? "update" : "create"})`);
  }

  async putBlobFile(absolutePath: string, blob: Blob): Promise<void> {
    const repoPath = toRepoPath(absolutePath);
    const sha = await this.getFileSha(repoPath);
    const encoded = await this.blobToBase64(blob);

    const body: Record<string, unknown> = {
      message: `asset: ${repoPath}`,
      content: encoded,
      branch: this.branch,
    };
    if (sha) body.sha = sha;

    const res = await fetch(this.endpoint(repoPath), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub PUT blob ${repoPath} → HTTP ${res.status}: ${detail}`);
    }
    log.info(`PUT blob ${repoPath}`);
  }

  async fileExists(absolutePath: string): Promise<boolean> {
    const repoPath = toRepoPath(absolutePath);
    return (await this.getFileSha(repoPath)) !== null;
  }

  async readText(absolutePath: string): Promise<string> {
    const repoPath = toRepoPath(absolutePath);
    const res = await fetch(`${this.endpoint(repoPath)}?ref=${encodeURIComponent(this.branch)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GitHub GET ${repoPath} → HTTP ${res.status}`);
    const json = await res.json() as { content?: string; encoding?: string };
    if (json.encoding !== "base64" || !json.content) {
      throw new Error(`Unexpected encoding for ${repoPath}: ${json.encoding}`);
    }
    return decodeURIComponent(escape(atob(json.content.replace(/\n/g, ""))));
  }

  async deleteFile(absolutePath: string): Promise<void> {
    const repoPath = toRepoPath(absolutePath);
    const sha = await this.getFileSha(repoPath);
    if (!sha) return; // already gone — not an error

    const body = {
      message: `unpublish: ${repoPath}`,
      sha,
      branch: this.branch,
    };

    const res = await fetch(this.endpoint(repoPath), {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub DELETE ${repoPath} → HTTP ${res.status}: ${detail}`);
    }
    log.info(`DELETE ${repoPath}`);
  }

  /** No-op: GitHub creates parent tree entries automatically. */
  async ensureDir(_absolutePath: string): Promise<void> { /* no-op */ }

  async listDir(absolutePath: string): Promise<Array<{ isDir: boolean; name: string }>> {
    const repoPath = toRepoPath(absolutePath);
    const res = await fetch(`${this.endpoint(repoPath)}?ref=${encodeURIComponent(this.branch)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return [];
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return (json as GitHubEntry[]).map((e) => ({ isDir: e.type === "dir", name: e.name }));
  }

  async validateHugoProject(): Promise<{ valid: boolean; error?: string }> {
    if (!this.owner || !this.repo) {
      return { valid: false, error: "Invalid or missing Git repository URL" };
    }
    if (!this.token) {
      return { valid: false, error: "Git token is required" };
    }

    const configFiles = ["hugo.toml", "hugo.yaml", "config.toml", "config.yaml"];
    for (const f of configFiles) {
      if (await this.fileExists(`${GIT_VIRTUAL_BASE}/${f}`)) return { valid: true };
    }
    return {
      valid: false,
      error: `No Hugo config file found in ${this.owner}/${this.repo} (hugo.toml / config.toml expected)`,
    };
  }
}
