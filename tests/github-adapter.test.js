const test = require("node:test");
const assert = require("node:assert/strict");

const { GitHubAdapter } = require("../.test-build/src/github-adapter.js");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test("GitHubAdapter batches rename delete and write into one tree", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes("/contents/content%2Fposts%2Fold-title.md?ref=feat%2Fgit")) {
      return jsonResponse({ sha: "old-file-sha" });
    }
    if (url.endsWith("/git/blobs")) {
      return jsonResponse({ sha: "new-blob-sha" });
    }
    if (url.endsWith("/git/refs/heads/feat%2Fgit")) {
      if (!options.method) return jsonResponse({ object: { sha: "parent-commit-sha" } });
      return jsonResponse({});
    }
    if (url.endsWith("/git/commits/parent-commit-sha")) {
      return jsonResponse({ tree: { sha: "base-tree-sha" } });
    }
    if (url.endsWith("/git/trees")) {
      return jsonResponse({ sha: "new-tree-sha" });
    }
    if (url.endsWith("/git/commits")) {
      return jsonResponse({ sha: "new-commit-sha" });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const adapter = new GitHubAdapter({
    hugoProjectPath: "",
    contentDir: "content/posts",
    staticDir: "static/images",
    publishTag: "",
    defaultDraft: false,
    slugMode: "title",
    autoSyncOnSave: false,
    autoCleanOrphans: false,
    language: "",
    badgeRefreshDelayMs: 400,
    preserveDocTree: false,
    publishMode: "git",
    gitRepoUrl: "https://github.com/acme/site.git",
    gitBranch: "feat/git",
    gitToken: "token",
  });

  await adapter.deleteFile("/git-root/content/posts/old-title.md");
  await adapter.putTextFile("/git-root/content/posts/new-title.md", "hello");
  await adapter.flush();

  const treeCall = calls.find((call) => call.url.endsWith("/git/trees"));
  assert.ok(treeCall, "missing tree creation call");

  const body = JSON.parse(treeCall.options.body);
  assert.equal(body.base_tree, "base-tree-sha");
  assert.deepEqual(body.tree, [
    { path: "content/posts/old-title.md", mode: "100644", type: "blob", sha: null },
    { path: "content/posts/new-title.md", mode: "100644", type: "blob", sha: "new-blob-sha" },
  ]);
});
