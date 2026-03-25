const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveGeneratedPublicPaths,
  resolveLocalizedContentDir,
} = require("../.test-build/src/publisher.js");

/**
 * Verifies language insertion after the `content` root directory.
 */
function testLocalizedContentDirForDefaultContentRoot() {
  assert.equal(resolveLocalizedContentDir("content/posts", "fr"), "content/fr/posts");
  assert.equal(resolveLocalizedContentDir("/content/posts/", "/fr/"), "content/fr/posts");
}

/**
 * Verifies language prefix behavior for custom content directories.
 */
function testLocalizedContentDirForCustomRoots() {
  assert.equal(resolveLocalizedContentDir("posts", "fr"), "fr/posts");
  assert.equal(resolveLocalizedContentDir("content/posts", ""), "content/posts");
}

/**
 * Verifies derivation of generated Hugo public artifacts for cleanup.
 */
function testGeneratedPublicPaths() {
  assert.deepEqual(deriveGeneratedPublicPaths("content/posts/hello-world.md"), [
    "public/posts/hello-world",
    "public/posts/hello-world/index.html",
    "public/posts/hello-world.html",
  ]);
  assert.deepEqual(deriveGeneratedPublicPaths("static/images/photo.png"), []);
}

test("resolveLocalizedContentDir injects language after content root", testLocalizedContentDirForDefaultContentRoot);

test("resolveLocalizedContentDir prefixes custom content dirs when needed", testLocalizedContentDirForCustomRoots);

test("deriveGeneratedPublicPaths returns the Hugo page artifacts to clean", testGeneratedPublicPaths);
