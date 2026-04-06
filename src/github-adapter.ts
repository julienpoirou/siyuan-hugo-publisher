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

interface PendingTreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
  contentBase64?: string;
  delete?: boolean;
}

/**
 * Extracts the GitHub owner and repository name from a remote URL.
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Converts an absolute publisher path to a repository-relative path.
 */
function toRepoPath(absolutePath: string): string {
  const prefix = `${GIT_VIRTUAL_BASE}/`;
  if (absolutePath.startsWith(prefix)) return absolutePath.slice(prefix.length);
  return absolutePath.replace(/^\/+/, "");
}

/**
 * GitHub REST API-backed storage adapter.
 *
 * Write operations (putTextFile / putBlobFile) create Git blobs immediately
 * but defer the commit: all changes are batched into a single commit when
 * flush() is called. This means:
 *  - Blob creations can be parallelized by the caller.
 *  - One atomic commit per publish — no SHA-conflict 409 errors.
 *  - Hugo's git poller sees a single clean commit per published note.
 *
 * Delete operations (deleteFile) bypass the batch and commit directly via
 * the Contents API (they are rare — unpublish only).
 */
export class GitHubAdapter implements StorageAdapter {
  readonly mode = "git" as const;
  readonly hugoBase = GIT_VIRTUAL_BASE;

  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly token: string;
  private readonly apiBase = "https://api.github.com";

  private readonly pendingEntries: PendingTreeEntry[] = [];

  private queueTreeEntry(entry: PendingTreeEntry): void {
    const existingIndex = this.pendingEntries.findIndex((candidate) => candidate.path === entry.path);
    if (existingIndex >= 0) {
      this.pendingEntries.splice(existingIndex, 1, entry);
      return;
    }
    this.pendingEntries.push(entry);
  }

  constructor(private readonly config: HugoConfig) {
    const parsed = parseGitHubUrl(config.gitRepoUrl);
    this.owner = parsed?.owner ?? "";
    this.repo = parsed?.repo ?? "";
    this.branch = config.gitBranch || "main";
    this.token = config.gitToken;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private headers(): Record<string, string> {
    return {
      Authorization: `token ${this.token}`,
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
   * Used by fileExists, readText, and deleteFile.
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

  private async putContents(repoPath: string, base64Content: string): Promise<void> {
    const currentSha = await this.getFileSha(repoPath);
    const body: Record<string, unknown> = {
      message: `publish: ${repoPath}`,
      content: base64Content,
      branch: this.branch,
    };
    if (currentSha) body.sha = currentSha;

    const res = await fetch(this.endpoint(repoPath), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub PUT ${repoPath} → HTTP ${res.status}: ${detail}`);
    }
  }

  private async deleteContents(repoPath: string): Promise<void> {
    const currentSha = await this.getFileSha(repoPath);
    if (!currentSha) return;

    const res = await fetch(this.endpoint(repoPath), {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify({
        message: `unpublish: ${repoPath}`,
        sha: currentSha,
        branch: this.branch,
      }),
    });
    if (res.status === 404) return;
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub DELETE ${repoPath} → HTTP ${res.status}: ${detail}`);
    }
  }

  private async flushViaContents(entries: PendingTreeEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.delete) {
        await this.deleteContents(entry.path);
      } else if (entry.contentBase64) {
        await this.putContents(entry.path, entry.contentBase64);
      } else {
        throw new Error(`Missing content payload for ${entry.path}`);
      }
    }
    this.pendingEntries.length = 0;
    log.info(`Committed ${entries.length} file(s) via Contents API fallback`);
  }

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
  // StorageAdapter — write operations (batched via Trees API)
  // ---------------------------------------------------------------------------

  async putTextFile(absolutePath: string, content: string): Promise<void> {
    const repoPath = toRepoPath(absolutePath);
    const encoded = btoa(unescape(encodeURIComponent(content)));
    this.queueTreeEntry({ path: repoPath, mode: "100644", type: "blob", sha: "queued", contentBase64: encoded });
    log.info(`Write queued: ${repoPath}`);
  }

  async putBlobFile(absolutePath: string, blob: Blob): Promise<void> {
    const repoPath = toRepoPath(absolutePath);
    const encoded = await this.blobToBase64(blob);
    this.queueTreeEntry({ path: repoPath, mode: "100644", type: "blob", sha: "queued", contentBase64: encoded });
    log.info(`Write queued: ${repoPath}`);
  }

  /**
   * Commits all queued blobs as a single Git commit using the Trees API.
   */
  async flush(): Promise<void> {
    if (this.pendingEntries.length === 0) return;

    const entries = [...this.pendingEntries];
    await this.flushViaContents(entries);
    return;
  }

  // ---------------------------------------------------------------------------
  // StorageAdapter — read / delete operations (direct Contents API)
  // ---------------------------------------------------------------------------

  async fileExists(absolutePath: string): Promise<boolean> {
    return (await this.getFileSha(toRepoPath(absolutePath))) !== null;
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
    this.queueTreeEntry({ path: repoPath, mode: "100644", type: "blob", sha: null, delete: true });
    log.info(`Delete queued: ${repoPath}`);
  }

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
    const res = await fetch(
      `${this.apiBase}/repos/${this.owner}/${this.repo}`,
      { headers: { Authorization: `token ${this.token}`, Accept: "application/vnd.github+json" } }
    );
    if (res.status === 401) return { valid: false, error: "Invalid GitHub token (401 Unauthorized)" };
    if (res.status === 403) return { valid: false, error: "Token lacks repo access (403 Forbidden)" };
    if (res.status === 404) return { valid: false, error: `Repository ${this.owner}/${this.repo} not found (404)` };
    if (!res.ok) return { valid: false, error: `GitHub API error: ${res.status}` };
    return { valid: true };
  }
}
