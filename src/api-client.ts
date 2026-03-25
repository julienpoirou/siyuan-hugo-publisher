import { getSiyuanApiToken } from "./siyuan-runtime";

const BASE = "http://127.0.0.1:6806";

export interface SiyuanHttpClient {
  postJson(endpoint: string, body: unknown, headers?: HeadersInit): Promise<Response>;
  postForm(endpoint: string, body: FormData, headers?: HeadersInit): Promise<Response>;
}

/**
 * Adds the SiYuan API token to an outgoing header set when one is available.
 *
 * @param headers Existing request headers.
 * @returns Headers augmented with the SiYuan authorization token.
 */
function withAuthHeaders(headers?: HeadersInit): HeadersInit {
  const token = getSiyuanApiToken();
  return token ? { ...headers, Authorization: `Token ${token}` } : (headers ?? {});
}

class FetchSiyuanHttpClient implements SiyuanHttpClient {
  /**
   * Sends a JSON POST request to the local SiYuan HTTP API.
   *
   * @param endpoint API path relative to the SiYuan base URL.
   * @param body JSON payload to serialize.
   * @param headers Optional extra request headers.
   * @returns The raw fetch response.
   */
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

  /**
   * Sends a multipart POST request to the local SiYuan HTTP API.
   *
   * @param endpoint API path relative to the SiYuan base URL.
   * @param body Form payload to send.
   * @param headers Optional extra request headers.
   * @returns The raw fetch response.
   */
  async postForm(endpoint: string, body: FormData, headers?: HeadersInit): Promise<Response> {
    return fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: withAuthHeaders(headers),
      body,
    });
  }
}

let siyuanHttpClient: SiyuanHttpClient = new FetchSiyuanHttpClient();

/**
 * Returns the active HTTP client used to communicate with SiYuan.
 *
 * @returns The current SiYuan HTTP client implementation.
 */
export function getSiyuanHttpClient(): SiyuanHttpClient {
  return siyuanHttpClient;
}

/**
 * Overrides the HTTP client used to communicate with SiYuan.
 *
 * @param client Replacement client implementation.
 */
export function setSiyuanHttpClient(client: SiyuanHttpClient): void {
  siyuanHttpClient = client;
}

/**
 * Restores the default fetch-based SiYuan HTTP client.
 */
export function resetSiyuanHttpClient(): void {
  siyuanHttpClient = new FetchSiyuanHttpClient();
}
