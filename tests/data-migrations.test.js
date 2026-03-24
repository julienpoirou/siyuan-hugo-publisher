const test = require("node:test");
const assert = require("node:assert/strict");

const {
  migrateConfig,
  migrateImageRefStore,
  migrateSyncMirrorStore,
  wrapVersionedPayload,
} = require("../.test-build/src/data-migrations.js");

test("migrateConfig supports legacy and versioned payloads", () => {
  const legacy = migrateConfig({ hugoProjectPath: "/data/hugo-site", slugMode: "id" });
  assert.equal(legacy.hugoProjectPath, "/data/hugo-site");
  assert.equal(legacy.slugMode, "id");

  const versioned = migrateConfig(wrapVersionedPayload({ hugoProjectPath: "/data/other-site" }));
  assert.equal(versioned.hugoProjectPath, "/data/other-site");
});

test("migrateImageRefStore filters invalid values", () => {
  const store = migrateImageRefStore({
    "static/images/a.png": ["doc-1", 42, "doc-1", "doc-2"],
  });
  assert.deepEqual(store, {
    "static/images/a.png": ["doc-1", "doc-2"],
  });
});

test("migrateSyncMirrorStore supports versioned payloads", () => {
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
});
