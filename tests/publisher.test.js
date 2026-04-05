const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveGeneratedPublicPaths,
  normalizeRenderedContentForComparison,
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

/**
 * Verifies that volatile lastmod drift does not affect sync comparison.
 */
function testNormalizeRenderedContentForComparison() {
  const base = [
    "---",
    'title: "Hello"',
    'lastmod: "2026-04-03T10:00:00.000Z"',
    'hash: "abc"',
    "---",
    "",
    "Body",
    "",
  ].join("\n");
  const drifted = base
    .replace("2026-04-03T10:00:00.000Z", "2026-04-03T10:05:00.000Z")
    .replace('hash: "abc"', 'hash: "def"');

  assert.equal(
    normalizeRenderedContentForComparison(base),
    normalizeRenderedContentForComparison(drifted)
  );
}

test("resolveLocalizedContentDir injects language after content root", testLocalizedContentDirForDefaultContentRoot);

test("resolveLocalizedContentDir prefixes custom content dirs when needed", testLocalizedContentDirForCustomRoots);

test("deriveGeneratedPublicPaths returns the Hugo page artifacts to clean", testGeneratedPublicPaths);

/**
 * Verifies that shortcode escaping differences are ignored during comparison.
 *
 * Notes published before escapeHugoShortcodes was introduced have raw `{{<`
 * sequences. Re-rendering with the current code produces escaped variants.
 * The comparison must treat both forms as equivalent.
 */
function testNormalizeRenderedContentForComparisonShortcodes() {
  const unescaped = [
    "---",
    'title: "Hello"',
    'lastmod: "2026-04-03T10:00:00.000Z"',
    'hash: "abc"',
    "---",
    "",
    "Use {{< shortcode >}} and %}}",
    "",
  ].join("\n");
  const escaped = unescaped
    .replace("{{<", "&#123;&#123;<")
    .replace(">}}", ">&#125;&#125;")
    .replace("%}}", "%&#125;&#125;")
    .replace('lastmod: "2026-04-03T10:00:00.000Z"', 'lastmod: "2026-04-03T10:05:00.000Z"')
    .replace('hash: "abc"', 'hash: "def"');

  assert.equal(
    normalizeRenderedContentForComparison(unescaped),
    normalizeRenderedContentForComparison(escaped)
  );
}

test("normalizeRenderedContentForComparison ignores lastmod drift", testNormalizeRenderedContentForComparison);

test("normalizeRenderedContentForComparison treats escaped and unescaped shortcodes as equal", testNormalizeRenderedContentForComparisonShortcodes);
