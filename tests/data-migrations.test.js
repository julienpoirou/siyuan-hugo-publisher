const test = require("node:test");
const assert = require("node:assert/strict");

const {
  migrateConfig,
  migrateImageRefStore,
  migrateSyncMirrorStore,
  wrapVersionedPayload,
} = require("../.test-build/src/data-migrations.js");

/**
 * Verifies that config migration accepts both legacy and versioned payloads.
 */
function testConfigMigration() {
  const legacy = migrateConfig({ hugoProjectPath: "/data/hugo-site", slugMode: "id" });
  assert.equal(legacy.hugoProjectPath, "/data/hugo-site");
  assert.equal(legacy.slugMode, "id");
  assert.equal(legacy.badgeRefreshDelayMs, 400);

  const versioned = migrateConfig(wrapVersionedPayload({ hugoProjectPath: "/data/other-site" }));
  assert.equal(versioned.hugoProjectPath, "/data/other-site");
  assert.equal(versioned.badgeRefreshDelayMs, 400);
}

/**
 * Verifies that image reference migration filters invalid values and duplicates.
 */
function testImageRefStoreMigration() {
  const store = migrateImageRefStore({
    "static/images/a.png": ["doc-1", 42, "doc-1", "doc-2"],
  });
  assert.deepEqual(store, {
    "static/images/a.png": ["doc-1", "doc-2"],
  });
}

/**
 * Verifies that sync mirror migration supports versioned payloads.
 */
function testSyncMirrorStoreMigration() {
  const store = migrateSyncMirrorStore(wrapVersionedPayload({
    "doc-1": {
      hash: "abc",
      lastSync: "2024-01-01T00:00:00.000Z",
      hugoPath: "content/posts/doc-1.md",
      slug: "doc-1",
      images: ["static/images/a.png", 42],
    },
  }));

  assert.deepEqual(store, {
    "doc-1": {
      hash: "abc",
      lastSync: "2024-01-01T00:00:00.000Z",
      hugoPath: "content/posts/doc-1.md",
      slug: "doc-1",
      images: ["static/images/a.png"],
    },
  });
}

test("migrateConfig supports legacy and versioned payloads", testConfigMigration);

test("migrateImageRefStore filters invalid values", testImageRefStoreMigration);

test("migrateSyncMirrorStore supports versioned payloads", testSyncMirrorStoreMigration);
