const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveGeneratedPublicPaths,
  listPublishedDocIds,
  matchesPublishTagFilter,
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
 * Verifies discovery of already-published notes from the Hugo content tree.
 */
async function testListPublishedDocIds() {
  const entriesByPath = {
    "/git-root/content/posts": [{ isDir: false, name: "hello.md" }, { isDir: true, name: "nested" }],
    "/git-root/content/posts/nested": [{ isDir: false, name: "child.md" }],
  };
  const contentByPath = {
    "/git-root/content/posts/hello.md": '---\nslug: "hello"\nsiyuan_id: "20240101010101-hello"\nhash: "hash-1"\n---\n',
    "/git-root/content/posts/nested/child.md": '---\nslug: "child"\nsiyuan_id: "20240101010101-child"\nhash: "hash-2"\n---\n',
  };

  const ids = await listPublishedDocIds(
    {
      contentDir: "content/posts",
      language: "",
      preserveDocTree: false,
    },
    {
      hugoBase: "/git-root",
      listDir: async (path) => entriesByPath[path] ?? [],
      readText: async (path) => contentByPath[path] ?? "",
    }
  );

  assert.deepEqual(ids.sort(), ["20240101010101-child", "20240101010101-hello"]);
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

function testMatchesPublishTagFilter() {
  assert.equal(matchesPublishTagFilter("#alpha #test #omega", "test"), true);
  assert.equal(matchesPublishTagFilter("alpha,test,omega", "test"), true);
  assert.equal(matchesPublishTagFilter("alpha;test;omega", "test"), true);
  assert.equal(matchesPublishTagFilter("#alpha #omega", "test"), false);
}

test("resolveLocalizedContentDir injects language after content root", testLocalizedContentDirForDefaultContentRoot);

test("resolveLocalizedContentDir prefixes custom content dirs when needed", testLocalizedContentDirForCustomRoots);

test("deriveGeneratedPublicPaths returns the Hugo page artifacts to clean", testGeneratedPublicPaths);

test("listPublishedDocIds discovers notes already present in Hugo content", testListPublishedDocIds);

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

test("matchesPublishTagFilter accepts multi-tag SiYuan values", testMatchesPublishTagFilter);
