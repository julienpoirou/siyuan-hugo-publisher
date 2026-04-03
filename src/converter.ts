import type { ConvertedDoc, FrontMatter, HugoConfig, ImageRef } from "./types";
import { hashContent } from "./hash";

/**
 * Converts a title into a Hugo-friendly slug fragment.
 *
 * @param text Source title.
 * @returns A normalized lowercase slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Generates the slug for a published document based on the configured mode.
 *
 * @param title Document title.
 * @param docId SiYuan document identifier.
 * @param mode Slug generation mode.
 * @returns The generated slug.
 */
function generateSlug(title: string, docId: string, mode: HugoConfig["slugMode"]): string {
  switch (mode) {
    case "id":
      return docId;
    case "title": {
      const slug = slugify(title);
      return slug || docId;
    }
    default: {
      const slug = slugify(title);
      return slug || docId;
    }
  }
}

/**
 * Rewrites embedded SiYuan asset images to Hugo static paths.
 *
 * @param markdown Source Markdown.
 * @param staticDir Hugo static directory.
 * @returns The rewritten Markdown and collected image references.
 */
function extractImages(markdown: string, staticDir: string): { markdown: string; images: ImageRef[] } {
  const images: ImageRef[] = [];
  const imgRegex = /!\[([^\]]*)\]\((assets\/[^)]+)\)/g;

  const urlDir = staticDir.replace(/^static\//, "");

  const processedMarkdown = markdown.replace(imgRegex, (match, alt, src) => {
    const filename = src.split("/").pop() ?? src;
    const hugoPath = `/${urlDir}/${filename}`;
    const targetPath = `${staticDir.replace(/\/+$/, "")}/${filename}`;
    images.push({
      siyuanPath: src,
      hugoPath,
      targetPath,
      markdownRef: match,
    });
    return `![${alt}](${hugoPath})`;
  });

  return { markdown: processedMarkdown, images };
}

/**
 * Extracts a banner image reference from SiYuan title-image metadata.
 *
 * @param titleImg Raw SiYuan title image attribute.
 * @param staticDir Hugo static directory.
 * @returns The corresponding image reference or `null`.
 */
function extractBannerImage(titleImg: string, staticDir: string): ImageRef | null {
  if (!titleImg) return null;
  const urlDir = staticDir.replace(/^static\//, "");
  const makeRef = (assetPath: string): ImageRef => {
    const filename = assetPath.split("/").pop() ?? assetPath;
    return {
      siyuanPath: assetPath,
      hugoPath: `/${urlDir}/${filename}`,
      targetPath: `${staticDir.replace(/\/+$/, "")}/${filename}`,
      markdownRef: "",
    };
  };

  const src = titleImg.replace(/^\//, "");
  if (src.startsWith("assets/")) return makeRef(src);

  const bgMatch = titleImg.match(/url\(["']?(assets\/[^"')]+)["']?\)/);
  if (bgMatch) return makeRef(bgMatch[1]);

  return null;
}

/**
 * Resolves a SiYuan icon attribute into a displayable string.
 *
 * @param raw Raw icon attribute value.
 * @returns The decoded icon string or the original value.
 */
export function resolveIcon(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (/^[0-9a-f]{4,6}$/i.test(trimmed)) {
    try { return String.fromCodePoint(parseInt(trimmed, 16)); } catch { }
  }
  if (/^[0-9a-f]{4,6}(-[0-9a-f]{4,6})+$/i.test(trimmed)) {
    try {
      return trimmed.split("-").map((hex) => String.fromCodePoint(parseInt(hex, 16))).join("");
    } catch { }
  }
  return raw;
}

/**
 * Removes SiYuan-specific Markdown constructs that should not reach Hugo.
 *
 * @param raw Raw exported Markdown.
 * @returns Cleaned Markdown ready for Hugo conversion.
 */
export function cleanSiYuanMarkdown(raw: string): string {
  let md = raw;

  md = md.replace(/\{:[^}]*\}/g, "");

  md = md.replace(/^\s*---[\s\S]*?---\s*\n?/, "");

  md = md.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, "$1");

  md = md.replace(/\n{3,}/g, "\n\n");

  return md.trim();
}

/**
 * Parses SiYuan IAL tag strings into normalized tag arrays.
 *
 * @param ialTags Raw tag string.
 * @returns Normalized tag values.
 */
function parseIALTags(ialTags: string): string[] {
  if (!ialTags) return [];
  return ialTags
    .split(/\s+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);
}

/**
 * Serializes front matter into YAML.
 *
 * @param fm Front matter object.
 * @returns YAML front matter block.
 */
function toYAML(fm: FrontMatter): string {
  const lines: string[] = ["---"];

  const escapeYamlDoubleQuoted = (value: string): string => {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  };

  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string") {
      lines.push(`${key}: "${escapeYamlDoubleQuoted(value)}"`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`${key}:`);
      value.forEach((v) => lines.push(`  - "${escapeYamlDoubleQuoted(String(v))}"`));
    } else {
      lines.push(`${key}: ${value}`);
    }
  };

  add("title", fm.title);
  add("date", fm.date);
  add("lastmod", fm.lastmod);
  add("slug", fm.slug);
  add("draft", fm.draft);
  add("tags", fm.tags);
  add("categories", fm.categories);
  add("siyuan_id", fm.siyuan_id);
  add("hash", fm.hash);
  add("icon", fm.icon);
  add("cover", fm.cover);
  add("cover_style", fm.cover_style);

  for (const [k, v] of Object.entries(fm)) {
    const skip = ["title","date","lastmod","slug","draft","tags","categories","siyuan_id","hash","icon","cover","cover_style"];
    if (!skip.includes(k)) add(k, v);
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Converts a SiYuan export into a Hugo-ready document model.
 *
 * @param docId SiYuan document identifier.
 * @param rawMarkdown Raw exported Markdown.
 * @param docName Fallback document name.
 * @param ial SiYuan block attributes.
 * @param config Active Hugo publishing configuration.
 * @returns Converted front matter, body, and image references.
 */
export async function convertDoc(
  docId: string,
  rawMarkdown: string,
  docName: string,
  ial: Record<string, string>,
  config: HugoConfig
): Promise<ConvertedDoc> {
  let body = cleanSiYuanMarkdown(rawMarkdown);

  const hash = await hashContent(`${body}\n${resolveIcon(ial["icon"] ?? "")}\n${ial["title-img"] ?? ""}`);

  const { markdown: bodyWithImages, images } = extractImages(body, config.staticDir);
  body = bodyWithImages;

  const tags = parseIALTags(ial["tags"] ?? "");
  const categories = parseIALTags(ial["categories"] ?? "");

  const now = new Date().toISOString();
  const created = ial["created"]
    ? formatSiYuanDate(ial["created"])
    : now;
  const updated = ial["updated"]
    ? formatSiYuanDate(ial["updated"])
    : now;

  const title = ial["title"] ?? docName ?? docId;
  const slug = generateSlug(title, docId, config.slugMode);

  const titleImg = ial["title-img"] ?? "";
  const bannerRef = extractBannerImage(titleImg, config.staticDir);
  if (bannerRef) {
    images.push(bannerRef);
    const escaped = bannerRef.hugoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    body = body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escaped}\\)`, "g"), "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const icon = resolveIcon(ial["icon"] ?? "");

  let cover = "";
  let coverStyle = "";
  if (bannerRef) {
    cover = bannerRef.hugoPath;
  } else if (titleImg.startsWith("http")) {
    cover = titleImg;
  } else if (titleImg.startsWith("background")) {
    coverStyle = titleImg;
  }

  const frontMatter: FrontMatter = {
    title,
    date: created,
    lastmod: updated,
    tags,
    categories,
    draft: config.defaultDraft,
    siyuan_id: docId,
    hash,
    slug,
  };
  if (icon)       frontMatter.icon        = icon;
  if (cover)      frontMatter.cover       = cover;
  if (coverStyle) frontMatter.cover_style = coverStyle;

  return { frontMatter, body, images };
}

/**
 * Renders a converted document into a complete Markdown file.
 *
 * @param doc Converted document.
 * @returns Markdown file content with YAML front matter.
 */
export function renderMarkdownFile(doc: ConvertedDoc): string {
  const yaml = toYAML(doc.frontMatter);
  return `${yaml}\n\n${doc.body}\n`;
}

/**
 * Converts a SiYuan timestamp string to an ISO-like datetime string.
 *
 * @param raw SiYuan timestamp in `YYYYMMDDhhmmss` format.
 * @returns A formatted datetime string.
 */
function formatSiYuanDate(raw: string): string {
  if (raw.length !== 14) return new Date().toISOString();
  const y = raw.slice(0, 4);
  const mo = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const h = raw.slice(8, 10);
  const mi = raw.slice(10, 12);
  const s = raw.slice(12, 14);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}
