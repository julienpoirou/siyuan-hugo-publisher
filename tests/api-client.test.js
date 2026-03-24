const test = require("node:test");
const assert = require("node:assert/strict");

const { exportMdContent, fileExists, readDir } = require("../.test-build/src/api.js");
const {
  setSiyuanHttpClient,
  resetSiyuanHttpClient,
} = require("../.test-build/src/api-client.js");

test.afterEach(() => {
  resetSiyuanHttpClient();
});

test("api wrappers use injected client for JSON calls", async () => {
  const calls = [];
  setSiyuanHttpClient({
    async postJson(endpoint, body) {
      calls.push({ endpoint, body });
      return new Response(JSON.stringify({
        code: 0,
        data: { hPath: "/Blog/Doc", content: "Hello" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    async postForm() {
      throw new Error("not expected");
    },
  });

  const result = await exportMdContent("20240101010101-test");
  assert.deepEqual(result, { hPath: "/Blog/Doc", content: "Hello" });
  assert.deepEqual(calls, [{
    endpoint: "/api/export/exportMdContent",
    body: { id: "20240101010101-test" },
  }]);
});

test("fileExists maps HTTP status from injected client", async () => {
  setSiyuanHttpClient({
    async postJson() {
      return new Response("", { status: 200 });
    },
    async postForm() {
      throw new Error("not expected");
    },
  });
  assert.equal(await fileExists("/data/hugo-site/content/posts/doc.md"), true);

  setSiyuanHttpClient({
    async postJson() {
      return new Response("", { status: 404 });
    },
    async postForm() {
      throw new Error("not expected");
    },
  });
  assert.equal(await fileExists("/data/hugo-site/content/posts/doc.md"), false);
});

test("readDir returns empty array on injected client failure payload", async () => {
  setSiyuanHttpClient({
    async postJson() {
      return new Response(JSON.stringify({ code: 1, data: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    async postForm() {
      throw new Error("not expected");
    },
  });

  assert.deepEqual(await readDir("/data/hugo-site/content/posts"), []);
});
