export interface SiYuanBlock {
  id: string;
  parent_id: string;
  root_id: string;
  hash: string;
  box: string;
  path: string;
  hpath: string;
  name: string;
  alias: string;
  memo: string;
  tag: string;
  content: string;
  fcontent: string;
  markdown: string;
  length: number;
  type: string;
  subtype: string;
  ial: Record<string, string>;
  sort: number;
  created: string;
  updated: string;
}

export interface SiYuanDoc {
  id: string;
  rootID: string;
  name: string;
  content: string;
  path: string;
  box: string;
  ial: Record<string, string>;
}

export interface HugoConfig {
  hugoProjectPath: string;
  contentDir: string;
  staticDir: string;
  publishTag: string;
  defaultDraft: boolean;
  slugMode: "title" | "id";
  autoSyncOnSave: boolean;
  autoCleanOrphans: boolean;
  language: string;
  badgeRefreshDelayMs: number;
}

export const DEFAULT_CONFIG: HugoConfig = {
  hugoProjectPath: "",
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

export type SyncStatus = "synced" | "modified" | "not-published";

export interface DocSyncEntry {
  hash: string;
  lastSync: string;
  hugoPath: string;
  slug: string;
  images: string[];
}

export interface ImageRefStore {
  [imagePath: string]: string[];
}

export interface SyncMirrorStore {
  [docId: string]: DocSyncEntry;
}

export interface ConvertedDoc {
  frontMatter: FrontMatter;
  body: string;
  images: ImageRef[];
}

export interface FrontMatter {
  title: string;
  date: string;
  lastmod: string;
  tags: string[];
  categories: string[];
  draft: boolean;
  siyuan_id: string;
  hash: string;
  slug: string;
  icon?: string;
  cover?: string;
  cover_style?: string;
  [key: string]: unknown;
}

export interface ImageRef {
  siyuanPath: string;
  hugoPath: string;
  targetPath: string;
  markdownRef: string;
}
