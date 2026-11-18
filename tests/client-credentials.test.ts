import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (...args: unknown[]) => void> = {};
const emitWithAck = vi.fn();
const mockSocket = {
  connected: false,
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => { handlers[event] = handler; }),
  emit: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
  timeout: vi.fn(() => ({ emitWithAck })),
};
const io = vi.fn(() => mockSocket);
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...(args as [])) }));

import { CredentialProvider, type ClientCredential } from '../src/credentials';
import { SocketManager } from '../src/connection/socket-manager';
import { RestClient } from '../src/rest/rest-client';
import { EstuaryClient } from '../src/client';
import { Logger } from '../src/utils/logger';
import { ConnectionState } from '../src/types';

const NOW = 1_800_000_000;
const credential = (token = 'ect_first', expiresAt = NOW + 900, playerId = 'app_canonical'): ClientCredential => ({ token, playerId, expiresAt });
const config = { serverUrl: 'https://api.example.com', characterId: 'char-1', playerId: 'ignored-player', autoReconnect: false };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CredentialProvider', () => {
  const clock = () => NOW;

  it('shares one provider call between concurrent callers, and caches the grant', async () => {
    const provider = vi.fn(async () => credential());
    const cache = new CredentialProvider(provider, clock);
    const results = await Promise.all(Array.from({ length: 5 }, () => cache.get()));
    expect(provider).toHaveBeenCalledOnce();
    expect(results.every(r => r.token === 'ect_first')).toBe(true);
    await cache.get();
    expect(provider).toHaveBeenCalledOnce();
  });

  it('refreshes a grant within 30 s of expiry, or when forced', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(credential('ect_first', NOW + 20))
      .mockResolvedValueOnce(credential('ect_second'))
      .mockResolvedValueOnce(credential('ect_third'));
    const cache = new CredentialProvider(provider, clock);
    expect((await cache.get()).token).toBe('ect_first');
    expect((await cache.get()).token).toBe('ect_second');
    expect((await cache.get(true)).token).toBe('ect_third');
  });

  it.each([
    ['a developer key', credential('est_developer')],
    ['an expired grant', credential('ect_x', NOW - 1)],
    ['no player', credential('ect_x', NOW + 900, '')],
    ['an endless grant', credential('ect_x', Infinity)],
    ['a header injection', credential('ect_x\r\nX-Evil: 1')],
  ])('refuses %s', async (_, value) => {
    await expect(new CredentialProvider(async () => value, clock).get()).rejects.toThrow('invalid credentials');
  });

  it('refuses a change of profile', async () => {
    const provider = vi.fn().mockResolvedValueOnce(credential()).mockResolvedValueOnce(credential('ect_b', NOW + 900, 'app_other'));
    const cache = new CredentialProvider(provider, clock);
    await cache.get();
    await expect(cache.get(true)).rejects.toThrow('profiles');
  });
});

describe('SocketManager with a tokenProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(NOW * 1000);
    vi.clearAllMocks();
    for (const key of Object.keys(handlers)) delete handlers[key];
    mockSocket.connected = false;
  });
  afterEach(() => vi.useRealTimers());

  async function connected(provider: () => Promise<ClientCredential>) {
    const manager = new SocketManager(config, new Logger(false), new CredentialProvider(provider));
    const connecting = manager.connect();
    await vi.advanceTimersByTimeAsync(0);
    mockSocket.connected = true;
    handlers.connect();
    handlers.session_info({ session_id: 's', conversation_id: 'c', character_id: 'char-1', player_id: 'app_canonical' });
    await connecting;
    return manager;
  }

  it('authenticates with the grant and its canonical player, never an api_key', async () => {
    await connected(async () => credential());
    const auth = mockSocket.emit.mock.calls.find(([event]) => event === 'authenticate')?.[1] as Record<string, unknown>;
    expect(auth.client_token).toBe('ect_first');
    expect(auth.player_id).toBe('app_canonical');
    expect(auth).not.toHaveProperty('api_key');
  });

  it('renews on the live socket 30 s before expiry, then again before the next expiry', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(credential('ect_first', NOW + 900))
      .mockResolvedValueOnce(credential('ect_second', NOW + 1800))
      .mockResolvedValueOnce(credential('ect_third', NOW + 2700));
    emitWithAck.mockResolvedValueOnce({ ok: true, expiresAt: NOW + 1800 }).mockResolvedValueOnce({ ok: true, expiresAt: NOW + 2700 });
    const manager = await connected(provider);
    await vi.advanceTimersByTimeAsync((900 - 30) * 1000 - 1);
    expect(emitWithAck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(emitWithAck).toHaveBeenCalledWith('renew_authentication', { client_token: 'ect_second' });
    expect(mockSocket.timeout).toHaveBeenCalledWith(15_000);
    await vi.advanceTimersByTimeAsync(900 * 1000);
    expect(emitWithAck).toHaveBeenLastCalledWith('renew_authentication', { client_token: 'ect_third' });
    expect(manager.state).toBe(ConnectionState.Connected);
  });

  it('ends the session with credential_renewal_failed when the gateway refuses', async () => {
    const provider = vi.fn().mockResolvedValueOnce(credential()).mockResolvedValueOnce(credential('ect_second', NOW + 1800));
    emitWithAck.mockResolvedValueOnce({ ok: false });
    const manager = await connected(provider);
    const authErrors: string[] = [];
    const disconnects: string[] = [];
    manager.on('authError', e => authErrors.push(e));
    manager.on('disconnected', r => disconnects.push(r));
    await vi.advanceTimersByTimeAsync(900 * 1000);
    expect(authErrors).toEqual(['credential_renewal_failed']);
    expect(disconnects).toEqual(['manual']);
    expect(manager.state).toBe(ConnectionState.Disconnected);
  });

  it('ends the session when the app’s backend fails to renew', async () => {
    const provider = vi.fn().mockResolvedValueOnce(credential()).mockRejectedValueOnce(new Error('backend down'));
    const manager = await connected(provider);
    const authErrors: string[] = [];
    manager.on('authError', e => authErrors.push(e));
    await vi.advanceTimersByTimeAsync(900 * 1000);
    expect(authErrors).toEqual(['credential_renewal_failed']);
    expect(emitWithAck).not.toHaveBeenCalled();
  });

  it('opens no socket when disconnect() lands while the grant is being fetched', async () => {
    let answer: (value: ClientCredential) => void = () => {};
    const manager = new SocketManager(config, new Logger(false), new CredentialProvider(() => new Promise(resolve => { answer = resolve; })));
    const connecting = manager.connect();
    manager.disconnect();
    answer(credential());
    await expect(connecting).rejects.toThrow('aborted');
    expect(io).not.toHaveBeenCalled();
  });

  it('stops renewing after a disconnect', async () => {
    const provider = vi.fn(async () => credential());
    const manager = await connected(provider);
    manager.disconnect();
    await vi.advanceTimersByTimeAsync(2000 * 1000);
    expect(emitWithAck).not.toHaveBeenCalled();
  });
});

describe('REST with a tokenProvider', () => {
  it('sends the grant as Bearer with its player, and no X-API-Key', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const rest = new RestClient('https://api.example.com', '', undefined, new CredentialProvider(async () => credential('ect_rest', Date.now() / 1000 + 900)));
    await rest.get('/api/v1/characters/char-1');
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get('Authorization')).toBe('Bearer ect_rest');
    expect(headers.get('X-Player-Id')).toBe('app_canonical');
    expect(headers.has('X-API-Key')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('EstuaryClient with a tokenProvider', () => {
  it('needs no apiKey, and offers memory only once connected', () => {
    const client = new EstuaryClient({ ...config, tokenProvider: async () => credential() });
    expect(() => client.memory).toThrow('connect()');
    client.dispose();
  });

  it('still refuses a config with no credential at all', () => {
    expect(() => new EstuaryClient({ ...config })).toThrow('tokenProvider');
  });
});
