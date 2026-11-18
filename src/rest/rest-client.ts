import type { CredentialProvider } from '../credentials';
import { EstuaryError, ErrorCode } from '../errors';
import { CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE } from '../version';

const DEFAULT_TIMEOUT_MS = 10_000;

export class RestClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private credentials?: CredentialProvider;

  /**
   * With `credentials`, requests carry the client grant as
   * `Authorization: Bearer` plus its `X-Player-Id` (SDK_CONTRACT v1.31) and
   * never an `X-API-Key`.
   */
  constructor(baseUrl: string, apiKey: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, credentials?: CredentialProvider) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.credentials = credentials;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>(url, { method: 'GET' });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    return this.request<T>(url, init);
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>(url, { method: 'DELETE' });
  }

  dispose(): void {
    // No persistent resources to clean up
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.credentials) {
      const credential = await this.credentials.get();
      headers.delete('X-API-Key');
      headers.set('Authorization', `Bearer ${credential.token}`);
      headers.set('X-Player-Id', credential.playerId);
    } else {
      headers.set('X-API-Key', this.apiKey);
    }
    headers.set(CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE);

    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      let detail: unknown;
      try {
        detail = await response.json();
      } catch {
        detail = await response.text().catch(() => null);
      }
      throw new EstuaryError(
        ErrorCode.REST_ERROR,
        `HTTP ${response.status}: ${response.statusText}`,
        detail,
      );
    }

    return response.json() as Promise<T>;
  }
}
