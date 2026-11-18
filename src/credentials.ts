/**
 * Restricted client credentials (SDK_CONTRACT v1.31). The app's own backend
 * holds the Estuary API key and mints short-lived `ect_` grants through
 * `POST /api/v1/client-tokens`; the SDK only ever sees the grant. A port of
 * the Python SDK's `estuary_sdk/credentials.py`.
 */
import { EstuaryError, ErrorCode } from './errors';

/** One grant from the app's backend. */
export interface ClientCredential {
  /** The `ect_` client token. Never logged. */
  token: string;
  /** The application-scoped `playerId` `/client-tokens` returned. Use it unchanged. */
  playerId: string;
  /** Unix time in seconds, as `/client-tokens` returns `expiresAt`. */
  expiresAt: number;
}

/**
 * Fetches a grant from the app's backend, with the app's own auth (cookies,
 * headers). To renew rather than start over, the backend passes the same
 * `sessionId` to `/client-tokens` that the first grant returned.
 */
export type TokenProvider = () => Promise<ClientCredential>;

/** A grant this close to expiring is replaced before use. */
export const REFRESH_MARGIN_SECONDS = 30;
const PROVIDER_TIMEOUT_MS = 15_000;

/** Caches the provider's grant and serializes calls to it. */
export class CredentialProvider {
  private cached: ClientCredential | null = null;
  private inFlight: Promise<ClientCredential> | null = null;

  constructor(private provider: TokenProvider, private now: () => number = () => Date.now() / 1000) {}

  /** The cached grant, or a fresh one when it's missing, close to expiring, or `force` is set. */
  get(force = false): Promise<ClientCredential> {
    if (!force && this.cached && this.cached.expiresAt > this.now() + REFRESH_MARGIN_SECONDS) {
      return Promise.resolve(this.cached);
    }
    // Concurrent callers share one provider call.
    this.inFlight ??= this.fetch().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** The canonical player, once a grant has been fetched. */
  get playerId(): string | null {
    return this.cached?.playerId ?? null;
  }

  private async fetch(): Promise<ClientCredential> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EstuaryError(ErrorCode.AUTH_FAILED, 'The token provider timed out')), PROVIDER_TIMEOUT_MS);
    });
    let credential: ClientCredential;
    try {
      credential = await Promise.race([this.provider(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    const { token, playerId, expiresAt } = credential ?? ({} as Partial<ClientCredential>);
    if (
      typeof token !== 'string' || !token.startsWith('ect_') || /[\r\n]/.test(token)
      || typeof playerId !== 'string' || !playerId
      || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= this.now()
    ) {
      throw new EstuaryError(ErrorCode.AUTH_FAILED, 'The token provider returned invalid credentials');
    }
    if (this.cached && playerId !== this.cached.playerId) {
      throw new EstuaryError(ErrorCode.AUTH_FAILED, 'Changing profiles requires a new client');
    }
    this.cached = { token, playerId, expiresAt };
    return this.cached;
  }
}
