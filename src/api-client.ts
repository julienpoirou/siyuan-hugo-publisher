import { getSiyuanApiToken } from "./siyuan-runtime";

const BASE = "http://127.0.0.1:6806";

export interface SiyuanHttpClient {
  postJson(endpoint: string, body: unknown, headers?: HeadersInit): Promise<Response>;
  postForm(endpoint: string, body: FormData, headers?: HeadersInit): Promise<Response>;
}

function withAuthHeaders(headers?: HeadersInit): HeadersInit {
  const token = getSiyuanApiToken();
  return token ? { ...headers, Authorization: `Token ${token}` } : (headers ?? {});
}

class FetchSiyuanHttpClient implements SiyuanHttpClient {
  async postJson(endpoint: string, body: unknown, headers?: HeadersInit): Promise<Response> {
    return fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...withAuthHeaders(headers),
      },
      body: JSON.stringify(body),
    });
  }

  async postForm(endpoint: string, body: FormData, headers?: HeadersInit): Promise<Response> {
    return fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: withAuthHeaders(headers),
      body,
    });
  }
}

let siyuanHttpClient: SiyuanHttpClient = new FetchSiyuanHttpClient();

export function getSiyuanHttpClient(): SiyuanHttpClient {
  return siyuanHttpClient;
}

export function setSiyuanHttpClient(client: SiyuanHttpClient): void {
  siyuanHttpClient = client;
}

export function resetSiyuanHttpClient(): void {
  siyuanHttpClient = new FetchSiyuanHttpClient();
}
