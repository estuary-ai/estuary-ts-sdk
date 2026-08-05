import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSocket = {
  connected: true,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { io } from 'socket.io-client';
import { EstuaryClient } from '../src/client';
import { SocketManager } from '../src/connection/socket-manager';
import { Logger } from '../src/utils/logger';

/** Minimal EventTarget stand-in for document/window in the node test env. */
class FakeEventTarget {
  private handlers: Record<string, Array<() => void>> = {};
  visibilityState = 'visible';
  addEventListener(type: string, fn: () => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.handlers[type] = (this.handlers[type] ?? []).filter((h) => h !== fn);
  }
  dispatch(type: string): void {
    for (const fn of this.handlers[type] ?? []) fn();
  }
  listenerCount(type: string): number {
    return (this.handlers[type] ?? []).length;
  }
}

function makeFakeVoiceManager() {
  return {
    isActive: true,
    stop: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

const SESSION_WIRE = {
  session_id: 'sess-1',
  conversation_id: 'conv-1',
  character_id: 'char-123',
  player_id: 'player-456',
};

describe('EstuaryClient page lifecycle', () => {
  let client: EstuaryClient;
  let fakeDocument: FakeEventTarget;
  let fakeWindow: FakeEventTarget;
  let handlers: Record<string, (...args: unknown[]) => void>;

  function makeClient(extraConfig: Record<string, unknown> = {}): EstuaryClient {
    return new EstuaryClient({
      serverUrl: 'https://api.example.com',
      apiKey: 'est_test_key',
      characterId: 'char-123',
      playerId: 'player-456',
      autoReconnect: false,
      ...extraConfig,
    });
  }

  async function connectClient(c: EstuaryClient): Promise<void> {
    const connectPromise = c.connect();
    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);
    await connectPromise;
  }

  function installFakeVoice(c: EstuaryClient) {
    const fake = makeFakeVoiceManager();
    (c as unknown as { voiceManager: unknown }).voiceManager = fake;
    return fake;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    handlers = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });
    fakeDocument = new FakeEventTarget();
    fakeWindow = new FakeEventTarget();
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('window', fakeWindow);
    client = makeClient();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('binds visibilitychange/pagehide/pageshow listeners in browsers', () => {
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(1);
    expect(fakeWindow.listenerCount('pagehide')).toBe(1);
    expect(fakeWindow.listenerCount('pageshow')).toBe(1);
  });

  it('does not bind listeners when manageBrowserLifecycle is false', () => {
    const before = fakeDocument.listenerCount('visibilitychange');
    makeClient({ manageBrowserLifecycle: false });
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(before);
  });

  it('releases voice when the page is hidden', async () => {
    await connectClient(client);
    const fake = installFakeVoice(client);
    const voiceStopped = vi.fn();
    client.on('voiceStopped', voiceStopped);

    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');

    await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());
    expect(fake.stop).toHaveBeenCalled();
    expect(client.isVoiceActive).toBe(false);
    expect(voiceStopped).toHaveBeenCalled();

    // A second hidden event (pagehide after visibilitychange) is a no-op
    fakeWindow.dispatch('pagehide');
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it('resumes voice on page show over a healthy socket without reconnecting', async () => {
    await connectClient(client);
    installFakeVoice(client);
    const startVoice = vi.spyOn(client, 'startVoice').mockResolvedValue(undefined);

    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');
    await vi.waitFor(() => expect(client.isVoiceActive).toBe(false));

    fakeDocument.visibilityState = 'visible';
    fakeDocument.dispatch('visibilitychange');
    fakeWindow.dispatch('pageshow'); // both fire on iOS return — must not double-start

    await vi.waitFor(() => expect(startVoice).toHaveBeenCalled());
    expect(startVoice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(io)).toHaveBeenCalledTimes(1); // no forced reconnect
  });

  it('reconnects over a fresh socket when the page was hidden past the stale threshold', async () => {
    await connectClient(client);
    installFakeVoice(client);
    const startVoice = vi.spyOn(client, 'startVoice').mockResolvedValue(undefined);

    const t0 = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);
    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');
    await vi.waitFor(() => expect(client.isVoiceActive).toBe(false));

    // Return 31s later: the socket still claims connected but is a zombie
    nowSpy.mockReturnValue(t0 + 31_000);
    fakeDocument.visibilityState = 'visible';
    fakeDocument.dispatch('visibilitychange');

    // Forced fresh connection: old socket torn down, new io() created
    await vi.waitFor(() => expect(vi.mocked(io)).toHaveBeenCalledTimes(2));
    expect(mockSocket.disconnect).toHaveBeenCalled();
    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);

    await vi.waitFor(() => expect(startVoice).toHaveBeenCalled());
  });

  it('does nothing on page show when voice was not active at hide time', async () => {
    await connectClient(client);
    const startVoice = vi.spyOn(client, 'startVoice').mockResolvedValue(undefined);

    fakeDocument.visibilityState = 'hidden';
    fakeDocument.dispatch('visibilitychange');
    fakeDocument.visibilityState = 'visible';
    fakeDocument.dispatch('visibilitychange');

    await new Promise((r) => setTimeout(r, 10));
    expect(startVoice).not.toHaveBeenCalled();
  });

  it('dispose() unbinds the lifecycle listeners', async () => {
    await client.dispose();
    expect(fakeDocument.listenerCount('visibilitychange')).toBe(0);
    expect(fakeWindow.listenerCount('pagehide')).toBe(0);
    expect(fakeWindow.listenerCount('pageshow')).toBe(0);
  });
});

describe('EstuaryClient voice release + resume across disconnects', () => {
  let client: EstuaryClient;
  let handlers: Record<string, (...args: unknown[]) => void>;

  function makeClient(extraConfig: Record<string, unknown> = {}): EstuaryClient {
    return new EstuaryClient({
      serverUrl: 'https://api.example.com',
      apiKey: 'est_test_key',
      characterId: 'char-123',
      playerId: 'player-456',
      autoReconnect: false,
      ...extraConfig,
    });
  }

  async function connectClient(c: EstuaryClient): Promise<void> {
    const connectPromise = c.connect();
    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);
    await connectPromise;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    handlers = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });
    client = makeClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases voice when the transport drops unexpectedly', async () => {
    await connectClient(client);
    const fake = makeFakeVoiceManager();
    (client as unknown as { voiceManager: unknown }).voiceManager = fake;
    const voiceStopped = vi.fn();
    client.on('voiceStopped', voiceStopped);

    handlers['disconnect']('transport close');

    await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());
    expect(fake.stop).toHaveBeenCalled();
    expect(client.isVoiceActive).toBe(false);
    expect(voiceStopped).toHaveBeenCalled();
  });

  it('restarts voice after the next successful connect when the drop was unexpected', async () => {
    await connectClient(client);
    const fake = makeFakeVoiceManager();
    (client as unknown as { voiceManager: unknown }).voiceManager = fake;
    const startVoice = vi.spyOn(client, 'startVoice').mockResolvedValue(undefined);

    handlers['disconnect']('transport close');
    await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());

    await connectClient(client); // stands in for the auto-reconnect succeeding
    await vi.waitFor(() => expect(startVoice).toHaveBeenCalled());
  });

  it('does not restart voice after a server-initiated disconnect', async () => {
    await connectClient(client);
    const fake = makeFakeVoiceManager();
    (client as unknown as { voiceManager: unknown }).voiceManager = fake;
    const startVoice = vi.spyOn(client, 'startVoice').mockResolvedValue(undefined);

    handlers['disconnect']('io server disconnect');
    await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());

    await connectClient(client);
    await new Promise((r) => setTimeout(r, 10));
    expect(startVoice).not.toHaveBeenCalled();
  });

  it('does not restart voice when resumeVoiceOnReconnect is false', async () => {
    client = makeClient({ resumeVoiceOnReconnect: false });
    await connectClient(client);
    const fake = makeFakeVoiceManager();
    (client as unknown as { voiceManager: unknown }).voiceManager = fake;
    const startVoice = vi.spyOn(client, 'startVoice').mockResolvedValue(undefined);

    handlers['disconnect']('transport close');
    await vi.waitFor(() => expect(fake.dispose).toHaveBeenCalled());

    await connectClient(client);
    await new Promise((r) => setTimeout(r, 10));
    expect(startVoice).not.toHaveBeenCalled();
  });
});

describe('SocketManager connect hardening', () => {
  let manager: SocketManager;
  let handlers: Record<string, (...args: unknown[]) => void>;
  const config = {
    serverUrl: 'https://api.example.com',
    apiKey: 'est_test_key',
    characterId: 'char-123',
    playerId: 'player-456',
    autoReconnect: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    handlers = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });
    manager = new SocketManager(config, new Logger(false));
  });

  it('dedupes concurrent connect() calls into one socket', async () => {
    const first = manager.connect();
    const second = manager.connect();
    expect(second).toBe(first);
    expect(vi.mocked(io)).toHaveBeenCalledTimes(1);

    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);
    await first;

    // Settled: a fresh connect() is allowed to run again (dedup cleared).
    // Connected + session present → resolves immediately without a new socket.
    mockSocket.connected = true;
    await manager.connect();
    expect(vi.mocked(io)).toHaveBeenCalledTimes(1);
  });

  it('tears down the previous socket before opening a new one', async () => {
    const first = manager.connect();
    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);
    await first;

    handlers['disconnect']('transport close'); // unexpected drop; socket object survives
    const second = manager.connect();
    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(vi.mocked(io)).toHaveBeenCalledTimes(2);

    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);
    await second;
  });

  it('rejects an in-flight connect when disconnect() aborts it', async () => {
    const pending = manager.connect();
    manager.disconnect();
    await expect(pending).rejects.toThrow('aborted');

    // The aborted attempt must not leave a hung dedup promise behind
    const retry = manager.connect();
    expect(vi.mocked(io)).toHaveBeenCalledTimes(2);
    handlers['connect']();
    handlers['session_info'](SESSION_WIRE);
    await retry;
  });
});
