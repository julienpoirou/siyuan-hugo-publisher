const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildSyncSignature,
  cleanSiYuanMarkdown,
  convertDoc,
  normalizeTitleImageForHash,
  renderMarkdownFile,
  resolveIcon,
} = require("../.test-build/src/converter.js");

const config = {
  hugoProjectPath: "/data/hugo-site",
  contentDir: "content/posts",
  staticDir: "static/images",
  publishTag: "",
  defaultDraft: false,
  slugMode: "title",
  autoSyncOnSave: false,
  autoCleanOrphans: false,
  language: "",
  badgeRefreshDelayMs: 400,
};

/**
 * Verifies cleanup of SiYuan-specific Markdown constructs.
 */
function testMarkdownCleanup() {
  const input = `{: id="20240101010101-test"}\n---\ntitle: "Imported"\n---\n\nSee [Doc](siyuan://blocks/20240101010101-test)\n\n\nBody`;
  assert.equal(cleanSiYuanMarkdown(input), "See Doc\n\nBody");
}

/**
 * Verifies icon decoding for unicode strings and hex codepoints.
 */
function testIconResolution() {
  assert.equal(resolveIcon("1f389"), "🎉");
  assert.equal(resolveIcon("1f1eb-1f1f7"), "🇫🇷");
  assert.equal(resolveIcon("📝"), "📝");
}

/**
 * Verifies image rewriting and front matter generation during conversion.
 *
 * @returns {Promise<void>}
 */
async function testDocumentConversion() {
  const result = await convertDoc(
    "20240115143022-abc123",
    "# Hello\n\n![Alt](assets/photo.png)",
    "Mon Article",
    {
      title: "Mon Article",
      tags: "#tech #notes",
      categories: "blog",
      icon: "1f389",
      "title-img": "assets/banner.png",
      created: "20240115143022",
      updated: "20240120101500",
    },
    config
  );

  assert.equal(result.frontMatter.title, "Mon Article");
  assert.equal(result.frontMatter.slug, "mon-article");
  assert.equal(result.frontMatter.icon, "🎉");
  assert.equal(result.frontMatter.cover, "/images/banner.png");
  assert.deepEqual(result.frontMatter.tags, ["tech", "notes"]);
  assert.deepEqual(result.frontMatter.categories, ["blog"]);
  assert.match(result.body, /!\[Alt\]\(\/images\/photo\.png\)/);
  assert.equal(result.images.length, 2);

  const rendered = renderMarkdownFile(result);
  assert.match(rendered, /^---[\s\S]*slug: "mon-article"/);
  assert.match(rendered, /cover: "\/images\/banner\.png"/);
}

/**
 * Verifies support for Markdown image titles and URL-encoded asset paths.
 *
 * @returns {Promise<void>}
 */
async function testImagePathNormalization() {
  const result = await convertDoc(
    "20240115143022-image-paths",
    String.raw`![A](assets/My%20Photo%20%281%29.png "caption")`,
    "Doc",
    {
      title: "Doc",
      "title-img": String.raw`url("assets/Banner%20Image.png?cache=1#hero")`,
    },
    config
  );

  assert.match(result.body, /!\[A\]\(\/images\/My Photo \(1\)\.png\)/);
  assert.equal(result.frontMatter.cover, "/images/Banner Image.png");
  assert.deepEqual(
    result.images.map((image) => image.siyuanPath),
    ["assets/My Photo (1).png", "assets/Banner Image.png"]
  );
}

/**
 * Verifies that external and CSS-based covers are preserved.
 *
 * @returns {Promise<void>}
 */
async function testCoverPreservation() {
  const externalCover = await convertDoc(
    "20240115143022-cover1",
    "Body",
    "Doc",
    {
      title: "Doc",
      "title-img": "https://example.com/cover.png",
    },
    config
  );
  assert.equal(externalCover.frontMatter.cover, "https://example.com/cover.png");
  assert.equal(externalCover.frontMatter.cover_style, undefined);

  const cssCover = await convertDoc(
    "20240115143022-cover2",
    "Body",
    "Doc",
    {
      title: "Doc",
      "title-img": "background: linear-gradient(red, blue);",
    },
    config
  );
  assert.equal(cssCover.frontMatter.cover, undefined);
  assert.equal(cssCover.frontMatter.cover_style, "background: linear-gradient(red, blue);");
}

/**
 * Verifies that duplicated banner images are removed from the Markdown body.
 *
 * @returns {Promise<void>}
 */
async function testBannerDeduplication() {
  const result = await convertDoc(
    "20240115143022-banner",
    "![Banner](assets/banner.png)\n\nBody",
    "Doc",
    {
      title: "Doc",
      "title-img": "assets/banner.png",
    },
    config
  );

  assert.equal(result.frontMatter.cover, "/images/banner.png");
  assert.equal(result.body, "Body");
}

/**
 * Verifies that non-Latin titles fall back to the document identifier for slug generation.
 *
 * @returns {Promise<void>}
 */
async function testNonLatinSlugFallback() {
  const result = await convertDoc(
    "20240115143022-nonlatin",
    "Body",
    "标题",
    {
      title: "标题",
    },
    config
  );

  assert.equal(result.frontMatter.slug, "20240115143022-nonlatin");
}

/**
 * Verifies deterministic date fallbacks when SiYuan timestamps are missing.
 *
 * @returns {Promise<void>}
 */
async function testDeterministicTimestampFallbacks() {
  const result = await convertDoc(
    "20240115143022-nodates",
    "Body",
    "Doc",
    {
      title: "Doc",
    },
    config
  );

  assert.equal(result.frontMatter.date, "2024-01-15T14:30:22");
  assert.equal(result.frontMatter.lastmod, "2024-01-15T14:30:22");
}

/**
 * Verifies stable hashing normalization for title images.
 */
function testTitleImageHashNormalization() {
  assert.equal(
    normalizeTitleImageForHash(String.raw`url("assets/Banner%20Image.png?cache=1#hero")`),
    "assets/Banner Image.png"
  );
  assert.equal(
    normalizeTitleImageForHash("https://example.com/cover.png?cache=1#hero"),
    "https://example.com/cover.png?cache=1"
  );
  assert.equal(
    buildSyncSignature("Body", { icon: "1f389", "title-img": String.raw`url("assets/Banner%20Image.png?cache=1#hero")` }),
    "Body\n\n\n"
  );
  assert.equal(
    buildSyncSignature("Body", { title: "Doc", tags: "#a #b", categories: "cat" }),
    "Body\nDoc\na,b\ncat"
  );
}

/**
 * Verifies that JSON conversion fixtures still match the converter output.
 *
 * @returns {Promise<void>}
 */
async function testConverterFixtures() {
  const fixturesDir = path.join(__dirname, "fixtures", "converter");
  for (const fixtureFile of fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".json"))) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, fixtureFile), "utf8"));
    const result = await convertDoc(
      fixture.docId,
      fixture.markdown,
      fixture.docName,
      fixture.ial,
      config
    );

    assert.equal(result.frontMatter.slug, fixture.expected.slug, `${fixtureFile}: slug`);
    assert.equal(result.frontMatter.cover ?? null, fixture.expected.cover ?? null, `${fixtureFile}: cover`);
    assert.equal(result.frontMatter.cover_style ?? null, fixture.expected.cover_style ?? null, `${fixtureFile}: cover_style`);
    assert.equal(result.frontMatter.icon ?? null, fixture.expected.icon ?? null, `${fixtureFile}: icon`);

    for (const snippet of fixture.expected.bodyIncludes) {
      assert.match(result.body, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${fixtureFile}: include ${snippet}`);
    }
    for (const snippet of fixture.expected.bodyExcludes) {
      assert.doesNotMatch(result.body, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${fixtureFile}: exclude ${snippet}`);
    }
  }
}

test("cleanSiYuanMarkdown removes IAL, front matter and internal block links", testMarkdownCleanup);

test("resolveIcon supports raw unicode and hex codepoints", testIconResolution);

test("convertDoc rewrites images and emits expected front matter fields", testDocumentConversion);

test("convertDoc keeps external cover URLs and CSS cover styles", testCoverPreservation);

test("convertDoc removes duplicate banner image from markdown body", testBannerDeduplication);

test("convertDoc normalizes titled and encoded asset paths", testImagePathNormalization);

test("convertDoc falls back to doc id when title slugifies to empty", testNonLatinSlugFallback);

test("convertDoc uses deterministic fallbacks for missing timestamps", testDeterministicTimestampFallbacks);

test("title image values are normalized for sync hashing", testTitleImageHashNormalization);

test("converter fixtures remain stable", testConverterFixtures);
