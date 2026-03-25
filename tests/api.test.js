const test = require("node:test");
const assert = require("node:assert/strict");

const { toWorkspacePath } = require("../.test-build/src/api.js");

/**
 * Verifies workspace-relative path normalization.
 */
function testWorkspacePathNormalization() {
  assert.equal(toWorkspacePath("/data/hugo-site"), "/data/hugo-site");
  assert.equal(toWorkspacePath("data/hugo-site/"), "/data/hugo-site");
}

/**
 * Verifies removal of the absolute SiYuan workspace prefix.
 */
function testWorkspacePrefixStripping() {
  assert.equal(
    toWorkspacePath("/siyuan/workspace/data/hugo-site/"),
    "/data/hugo-site"
  );
}

test("toWorkspacePath normalizes workspace-relative paths", testWorkspacePathNormalization);

test("toWorkspacePath strips absolute SiYuan workspace prefix", testWorkspacePrefixStripping);
