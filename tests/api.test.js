const test = require("node:test");
const assert = require("node:assert/strict");

const { toWorkspacePath } = require("../.test-build/src/api.js");

test("toWorkspacePath normalizes workspace-relative paths", () => {
  assert.equal(toWorkspacePath("/data/hugo-site"), "/data/hugo-site");
  assert.equal(toWorkspacePath("data/hugo-site/"), "/data/hugo-site");
});

test("toWorkspacePath strips absolute SiYuan workspace prefix", () => {
  assert.equal(
    toWorkspacePath("/siyuan/workspace/data/hugo-site/"),
    "/data/hugo-site"
  );
});
