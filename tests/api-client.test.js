const test = require("node:test");
const assert = require("node:assert/strict");

const { exportMdContent, fileExists, makeDir, readDir, removeFile } = require("../.test-build/src/api.js");
const {
  setSiyuanHttpClient,
  resetSiyuanHttpClient,
} = require("../.test-build/src/api-client.js");

/**
 * Restores the default injected HTTP client after each test.
 */
function restoreHttpClient() {
  resetSiyuanHttpClient();
}

/**
 * Verifies that JSON-based API wrappers delegate requests to the injected client.
 *
 * @returns {Promise<void>}
 */
async function testJsonApiWrappers() {
  const calls = [];
  setSiyuanHttpClient({
    /**
     * Captures JSON requests issued by the API wrapper under test.
     *
     * @param {string} endpoint
     * @param {unknown} body
     * @returns {Promise<Response>}
     */
    async postJson(endpoint, body) {
      calls.push({ endpoint, body });
      return new Response(JSON.stringify({
        code: 0,
        data: { hPath: "/Blog/Doc", content: "Hello" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    /**
     * Rejects unexpected multipart requests in this test scenario.
     *
     * @returns {Promise<Response>}
     */
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
}

/**
 * Verifies that `fileExists` maps HTTP status codes to booleans.
 *
 * @returns {Promise<void>}
 */
async function testFileExistsStatusMapping() {
  setSiyuanHttpClient({
    /**
     * Simulates a successful file lookup.
     *
     * @returns {Promise<Response>}
     */
    async postJson() {
      return new Response("", { status: 200 });
    },
    /**
     * Rejects unexpected multipart requests in this test scenario.
     *
     * @returns {Promise<Response>}
     */
    async postForm() {
      throw new Error("not expected");
    },
  });
  assert.equal(await fileExists("/data/hugo-site/content/posts/doc.md"), true);

  setSiyuanHttpClient({
    /**
     * Simulates a missing file lookup.
     *
     * @returns {Promise<Response>}
     */
    async postJson() {
      return new Response("", { status: 404 });
    },
    /**
     * Rejects unexpected multipart requests in this test scenario.
     *
     * @returns {Promise<Response>}
     */
    async postForm() {
      throw new Error("not expected");
    },
  });
  assert.equal(await fileExists("/data/hugo-site/content/posts/doc.md"), false);
}

/**
 * Verifies that `readDir` returns an empty array for failing client payloads.
 *
 * @returns {Promise<void>}
 */
async function testReadDirFailurePayload() {
  setSiyuanHttpClient({
    /**
     * Simulates a successful HTTP response containing a failing SiYuan payload.
     *
     * @returns {Promise<Response>}
     */
    async postJson() {
      return new Response(JSON.stringify({ code: 1, data: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    /**
     * Rejects unexpected multipart requests in this test scenario.
     *
     * @returns {Promise<Response>}
     */
    async postForm() {
      throw new Error("not expected");
    },
  });

  assert.deepEqual(await readDir("/data/hugo-site/content/posts"), []);
}

/**
 * Verifies that file mutation helpers reject failing SiYuan payloads even on HTTP 200.
 *
 * @returns {Promise<void>}
 */
async function testMutationPayloadFailures() {
  setSiyuanHttpClient({
    async postJson() {
      return new Response(JSON.stringify({ code: 1, msg: "remove failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    async postForm() {
      return new Response(JSON.stringify({ code: 1, msg: "mkdir failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  await assert.rejects(removeFile("/data/hugo-site/content/posts/doc.md"), /removeFile: remove failed/);
  await assert.rejects(makeDir("/data/hugo-site/content/posts"), /makeDir: mkdir failed/);
}

test.afterEach(restoreHttpClient);

test("api wrappers use injected client for JSON calls", testJsonApiWrappers);

test("fileExists maps HTTP status from injected client", testFileExistsStatusMapping);

test("readDir returns empty array on injected client failure payload", testReadDirFailurePayload);

test("file mutation helpers reject failing SiYuan payloads", testMutationPayloadFailures);
