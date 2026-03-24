const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveGeneratedPublicPaths,
  resolveLocalizedContentDir,
} = require("../.test-build/src/publisher.js");

test("resolveLocalizedContentDir injects language after content root", () => {
  assert.equal(resolveLocalizedContentDir("content/posts", "fr"), "content/fr/posts");
  assert.equal(resolveLocalizedContentDir("/content/posts/", "/fr/"), "content/fr/posts");
});

test("resolveLocalizedContentDir prefixes custom content dirs when needed", () => {
  assert.equal(resolveLocalizedContentDir("posts", "fr"), "fr/posts");
  assert.equal(resolveLocalizedContentDir("content/posts", ""), "content/posts");
});

test("deriveGeneratedPublicPaths returns the Hugo page artifacts to clean", () => {
  assert.deepEqual(deriveGeneratedPublicPaths("content/posts/hello-world.md"), [
    "public/posts/hello-world",
    "public/posts/hello-world/index.html",
    "public/posts/hello-world.html",
  ]);
  assert.deepEqual(deriveGeneratedPublicPaths("static/images/photo.png"), []);
});
