import { getSiyuanHttpClient } from "./api-client";

/**
 * Calls a SiYuan JSON API endpoint and unwraps its `data` payload.
 *
 * @typeParam T Expected payload shape.
 * @param endpoint API path to call.
 * @param body Request payload.
 * @returns The unwrapped SiYuan response data.
 */
async function request<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await getSiyuanHttpClient().postJson(endpoint, body);
  if (!res.ok) throw new Error(`SiYuan API ${endpoint} → HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`SiYuan API ${endpoint} → ${json.msg}`);
  return json.data as T;
}

/**
 * Exports a SiYuan document as Markdown.
 *
 * @param id Document identifier.
 * @returns The exported content and original hierarchical path.
 */
export async function exportMdContent(id: string): Promise<{ hPath: string; content: string }> {
  return request("/api/export/exportMdContent", { id });
}

/**
 * Reads custom block attributes for a SiYuan block.
 *
 * @param blockId Block identifier.
 * @returns The attribute map returned by SiYuan.
 */
export async function getBlockAttrs(blockId: string): Promise<Record<string, string>> {
  return request("/api/attr/getBlockAttrs", { id: blockId });
}

/**
 * Writes custom block attributes for a SiYuan block.
 *
 * @param blockId Block identifier.
 * @param attrs Attribute values to persist.
 */
export async function setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
  await request("/api/attr/setBlockAttrs", { id: blockId, attrs });
}

/**
 * Normalizes a filesystem path so it is rooted in the SiYuan workspace.
 *
 * @param p Raw path from settings or runtime.
 * @returns A normalized absolute workspace path.
 */
export function toWorkspacePath(p: string): string {
  const normalized = p.replace(/^\/siyuan\/workspace/, "").replace(/\/+$/, "");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

/**
 * Writes a UTF-8 text file through the SiYuan file API.
 *
 * @param path Destination path.
 * @param content File contents.
 */
export async function putFile(path: string, content: string): Promise<void> {
  const blob = new Blob([content], { type: "text/plain" });
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", String(Math.floor(Date.now() / 1000)));
  form.append("file", blob, "file");

  const res = await getSiyuanHttpClient().postForm("/api/file/putFile", form);
  if (!res.ok) throw new Error(`putFile HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`putFile: ${json.msg}`);
}

/**
 * Writes a blob file through the SiYuan file API.
 *
 * @param path Destination path.
 * @param blob File payload to upload.
 */
export async function putFileBlob(path: string, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "false");
  form.append("modTime", String(Math.floor(Date.now() / 1000)));
  form.append("file", blob, "file");

  const res = await getSiyuanHttpClient().postForm("/api/file/putFile", form);
  if (!res.ok) throw new Error(`putFileBlob HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`putFileBlob: ${json.msg}`);
}

/**
 * Creates a directory through the SiYuan file API.
 *
 * @param path Directory path to create.
 */
export async function makeDir(path: string): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "true");
  form.append("modTime", String(Math.floor(Date.now() / 1000)));

  const res = await getSiyuanHttpClient().postForm("/api/file/putFile", form);
  if (!res.ok) throw new Error(`makeDir HTTP ${res.status}`);
}

/**
 * Checks whether a workspace file exists.
 *
 * @param path File path to probe.
 * @returns `true` when the file can be fetched.
 */
export async function fileExists(path: string): Promise<boolean> {
  const res = await getSiyuanHttpClient().postJson("/api/file/getFile", { path });
  return res.status === 200;
}

/**
 * Reads a workspace file as text.
 *
 * @param path File path to read.
 * @returns The file contents as text.
 */
export async function readFileText(path: string): Promise<string> {
  const res = await getSiyuanHttpClient().postJson("/api/file/getFile", { path });
  if (!res.ok) throw new Error(`readFile HTTP ${res.status}`);
  return res.text();
}

/**
 * Removes a workspace file.
 *
 * @param path File path to delete.
 */
export async function removeFile(path: string): Promise<void> {
  const res = await getSiyuanHttpClient().postJson("/api/file/removeFile", { path });
  if (!res.ok) throw new Error(`removeFile HTTP ${res.status}`);
}

/**
 * Reads a workspace file as a blob.
 *
 * @param path File path to read.
 * @returns The file contents as a blob.
 */
export async function readFileBlob(path: string): Promise<Blob> {
  const res = await getSiyuanHttpClient().postJson("/api/file/getFile", { path });
  if (!res.ok) throw new Error(`readFileBlob HTTP ${res.status}`);
  return res.blob();
}

/**
 * Checks whether a SiYuan document still exists outside of trash.
 *
 * @param docId Document identifier.
 * @returns `true` when the document is still present.
 */
export async function docExists(docId: string): Promise<boolean> {
  try {
    const rows = await request<Array<{ id: string }>>(
      "/api/query/sql",
      { stmt: `SELECT id FROM blocks WHERE id = '${docId.replace(/'/g, "''")}' AND type = 'd' AND box NOT LIKE '%.trash%' LIMIT 1` }
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Lists the entries of a workspace directory.
 *
 * @param path Directory path to read.
 * @returns Directory entries or an empty list on failure.
 */
export async function readDir(path: string): Promise<Array<{ isDir: boolean; name: string }>> {
  try {
    const res = await getSiyuanHttpClient().postJson("/api/file/readDir", { path });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.code !== 0 || !Array.isArray(json.data)) return [];
    return json.data as Array<{ isDir: boolean; name: string }>;
  } catch {
    return [];
  }
}
