import { getSiyuanHttpClient } from "./api-client";

async function request<T>(endpoint: string, body: unknown): Promise<T> {
  const res = await getSiyuanHttpClient().postJson(endpoint, body);
  if (!res.ok) throw new Error(`SiYuan API ${endpoint} → HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`SiYuan API ${endpoint} → ${json.msg}`);
  return json.data as T;
}

export async function exportMdContent(id: string): Promise<{ hPath: string; content: string }> {
  return request("/api/export/exportMdContent", { id });
}

export async function getBlockAttrs(blockId: string): Promise<Record<string, string>> {
  return request("/api/attr/getBlockAttrs", { id: blockId });
}

export async function setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
  await request("/api/attr/setBlockAttrs", { id: blockId, attrs });
}

export function toWorkspacePath(p: string): string {
  const normalized = p.replace(/^\/siyuan\/workspace/, "").replace(/\/+$/, "");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

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

export async function makeDir(path: string): Promise<void> {
  const form = new FormData();
  form.append("path", path);
  form.append("isDir", "true");
  form.append("modTime", String(Math.floor(Date.now() / 1000)));

  const res = await getSiyuanHttpClient().postForm("/api/file/putFile", form);
  if (!res.ok) throw new Error(`makeDir HTTP ${res.status}`);
}

export async function fileExists(path: string): Promise<boolean> {
  const res = await getSiyuanHttpClient().postJson("/api/file/getFile", { path });
  return res.status === 200;
}

export async function readFileText(path: string): Promise<string> {
  const res = await getSiyuanHttpClient().postJson("/api/file/getFile", { path });
  if (!res.ok) throw new Error(`readFile HTTP ${res.status}`);
  return res.text();
}

export async function removeFile(path: string): Promise<void> {
  const res = await getSiyuanHttpClient().postJson("/api/file/removeFile", { path });
  if (!res.ok) throw new Error(`removeFile HTTP ${res.status}`);
}

export async function readFileBlob(path: string): Promise<Blob> {
  const res = await getSiyuanHttpClient().postJson("/api/file/getFile", { path });
  if (!res.ok) throw new Error(`readFileBlob HTTP ${res.status}`);
  return res.blob();
}

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
