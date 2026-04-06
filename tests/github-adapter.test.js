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

test("GitHubAdapter flushes rename delete and write via contents API", async () => {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });

    if (url.includes("/contents/content/posts/old-title.md?ref=feat%2Fgit")) {
      return jsonResponse({ sha: "old-file-sha" });
    }
    if (url.includes("/contents/content/posts/new-title.md?ref=feat%2Fgit")) {
      return jsonResponse({ sha: "new-file-sha" });
    }
    if (url.endsWith("/contents/content/posts/old-title.md") && options.method === "DELETE") {
      return jsonResponse({});
    }
    if (url.endsWith("/contents/content/posts/new-title.md") && options.method === "PUT") {
      return jsonResponse({});
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

  const deleteCall = calls.find((call) =>
    call.url.endsWith("/contents/content/posts/old-title.md") && call.options.method === "DELETE"
  );
  assert.ok(deleteCall, "missing delete call");
  assert.deepEqual(JSON.parse(deleteCall.options.body), {
    message: "unpublish: content/posts/old-title.md",
    sha: "old-file-sha",
    branch: "feat/git",
  });

  const putCall = calls.find((call) =>
    call.url.endsWith("/contents/content/posts/new-title.md") && call.options.method === "PUT"
  );
  assert.ok(putCall, "missing put call");
  const body = JSON.parse(putCall.options.body);
  assert.equal(body.message, "publish: content/posts/new-title.md");
  assert.equal(body.branch, "feat/git");
  assert.equal(body.sha, "new-file-sha");
  assert.equal(Buffer.from(body.content, "base64").toString("utf8"), "hello");
});
