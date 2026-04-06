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
  sha: string;
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

  /**
   * Creates a Git blob on GitHub and returns its SHA.
   * Content must already be base64-encoded.
   */
  private async createBlob(base64Content: string): Promise<string> {
    const res = await fetch(
      `${this.apiBase}/repos/${this.owner}/${this.repo}/git/blobs`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ content: base64Content, encoding: "base64" }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub create blob → HTTP ${res.status}: ${detail}`);
    }
    const json = await res.json() as { sha: string };
    return json.sha;
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
    const sha = await this.createBlob(encoded);
    this.pendingEntries.push({ path: repoPath, mode: "100644", type: "blob", sha });
    log.info(`Blob queued: ${repoPath}`);
  }

  async putBlobFile(absolutePath: string, blob: Blob): Promise<void> {
    const repoPath = toRepoPath(absolutePath);
    const encoded = await this.blobToBase64(blob);
    const sha = await this.createBlob(encoded);
    this.pendingEntries.push({ path: repoPath, mode: "100644", type: "blob", sha });
    log.info(`Blob queued: ${repoPath}`);
  }

  /**
   * Commits all queued blobs as a single Git commit using the Trees API.
   */
  async flush(): Promise<void> {
    if (this.pendingEntries.length === 0) return;

    const entries = [...this.pendingEntries];

    // 1. Get current branch ref (null on empty repos)
    const refUrl = `${this.apiBase}/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(this.branch)}`;
    const refRes = await fetch(refUrl, { headers: this.headers() });

    let parentSha: string | null = null;
    let baseTreeSha: string | null = null;

    if (refRes.ok) {
      const refJson = await refRes.json() as { object: { sha: string } };
      parentSha = refJson.object.sha;

      const commitRes = await fetch(
        `${this.apiBase}/repos/${this.owner}/${this.repo}/git/commits/${parentSha}`,
        { headers: this.headers() }
      );
      if (!commitRes.ok) {
        const detail = await commitRes.text().catch(() => "");
        throw new Error(`GitHub get commit → HTTP ${commitRes.status}: ${detail}`);
      }
      const commitJson = await commitRes.json() as { tree: { sha: string } };
      baseTreeSha = commitJson.tree.sha;
    } else if (refRes.status !== 404 && refRes.status !== 422) {
      const detail = await refRes.text().catch(() => "");
      throw new Error(`GitHub get ref → HTTP ${refRes.status}: ${detail}`);
    }

    // 2. Create tree
    const treeBody: Record<string, unknown> = { tree: entries };
    if (baseTreeSha) treeBody.base_tree = baseTreeSha;

    const treeRes = await fetch(
      `${this.apiBase}/repos/${this.owner}/${this.repo}/git/trees`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(treeBody) }
    );
    if (!treeRes.ok) {
      const detail = await treeRes.text().catch(() => "");
      throw new Error(`GitHub create tree → HTTP ${treeRes.status}: ${detail}`);
    }
    const treeJson = await treeRes.json() as { sha: string };

    // 3. Create commit
    const commitBody: Record<string, unknown> = {
      message: `publish: ${entries.length} file(s)`,
      tree: treeJson.sha,
    };
    if (parentSha) commitBody.parents = [parentSha];

    const newCommitRes = await fetch(
      `${this.apiBase}/repos/${this.owner}/${this.repo}/git/commits`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(commitBody) }
    );
    if (!newCommitRes.ok) {
      const detail = await newCommitRes.text().catch(() => "");
      throw new Error(`GitHub create commit → HTTP ${newCommitRes.status}: ${detail}`);
    }
    const newCommitJson = await newCommitRes.json() as { sha: string };

    // 4. Advance or create the branch ref
    //    On 422 (not fast-forward) the branch moved between step 1 and now:
    //    re-fetch the new tip, rebuild the commit on top of it, retry once.
    if (parentSha) {
      // force: true lets GitHub accept the update even if our commit's parent
      // is stale due to CDN propagation delay. Safe here because this repo is
      // dedicated to Hugo content and only this plugin writes to it.
      const updateRes = await fetch(refUrl, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ sha: newCommitJson.sha, force: true }),
      });
      if (!updateRes.ok) {
        const detail = await updateRes.text().catch(() => "");
        throw new Error(`GitHub update ref → HTTP ${updateRes.status}: ${detail}`);
      }
    } else {
      const createRefRes = await fetch(
        `${this.apiBase}/repos/${this.owner}/${this.repo}/git/refs`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ ref: `refs/heads/${this.branch}`, sha: newCommitJson.sha }),
        }
      );
      if (!createRefRes.ok) {
        const detail = await createRefRes.text().catch(() => "");
        throw new Error(`GitHub create ref → HTTP ${createRefRes.status}: ${detail}`);
      }
    }

    // Clear queue only after full success
    this.pendingEntries.length = 0;
    log.info(`Committed ${entries.length} file(s) via Trees API`);
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
    const sha = await this.getFileSha(repoPath);
    if (!sha) return;

    const res = await fetch(this.endpoint(repoPath), {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify({
        message: `unpublish: ${repoPath}`,
        sha,
        branch: this.branch,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub DELETE ${repoPath} → HTTP ${res.status}: ${detail}`);
    }
    log.info(`DELETE ${repoPath}`);
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
