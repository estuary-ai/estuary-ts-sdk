import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSocket = {
  connected: true,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
};
vi.mock('socket.io-client', () => ({ io: vi.fn(() => mockSocket) }));

import { EstuaryClient } from '../src/client';

type Handlers = Record<string, (...a: unknown[]) => void>;

async function connect(client: EstuaryClient, handlers: Handlers): Promise<void> {
  mockSocket.on.mockImplementation((e: string, h: (...a: unknown[]) => void) => {
    handlers[e] = h;
  });
  const p = client.connect();
  handlers['connect']();
  handlers['session_info']({ session_id: 's', conversation_id: 'c', character_id: 'ch', player_id: 'p' });
  await p;
}

function emittedSayLines(): Array<{ text: string; text_only: boolean }> {
  return mockSocket.emit.mock.calls
    .filter((c) => c[0] === 'say_line')
    .map((c) => c[1] as { text: string; text_only: boolean });
}

describe('EstuaryClient scripting', () => {
  let client: EstuaryClient;
  let handlers: Handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    handlers = {};
    client = new EstuaryClient({
      serverUrl: 'https://x',
      apiKey: 'est_k',
      characterId: 'ch',
      playerId: 'p',
      autoReconnect: false,
    });
  });

  it('throws when playScript called before connect', () => {
    expect(() => client.playScript(['a'])).toThrow('Not connected');
  });

  it('issues say_line for line 1 and advances on a forwarded bot_response', async () => {
    await connect(client, handlers);
    const script = client.playScript(['hello', 'world']);
    await Promise.resolve(); // flush autoStart microtask
    expect(emittedSayLines()).toEqual([{ text: 'hello', text_only: false }]);

    handlers['bot_response']({
      text: 'hello',
      is_final: true,
      partial: '',
      message_id: 'm1',
      chunk_index: 0,
      is_interjection: false,
    });
    expect(emittedSayLines()).toEqual([
      { text: 'hello', text_only: false },
      { text: 'world', text_only: false },
    ]);

    handlers['bot_response']({
      text: 'world',
      is_final: true,
      partial: '',
      message_id: 'm2',
      chunk_index: 0,
      is_interjection: false,
    });
    await expect(script.done).resolves.toEqual({ reason: 'finished' });
  });

  it('sayLines is an alias of playScript', async () => {
    await connect(client, handlers);
    const script = client.sayLines(['only']);
    await Promise.resolve();
    expect(emittedSayLines()).toEqual([{ text: 'only', text_only: false }]);
    handlers['bot_response']({
      text: 'only',
      is_final: true,
      partial: '',
      message_id: 'm1',
      chunk_index: 0,
      is_interjection: false,
    });
    await expect(script.done).resolves.toEqual({ reason: 'finished' });
  });

  it('emits scriptLineStarted with the server message id', async () => {
    await connect(client, handlers);
    const started: Array<{ index: number; text: string; messageId: string }> = [];
    client.on('scriptLineStarted', (i) => started.push(i));
    client.playScript(['hello']);
    await Promise.resolve();
    handlers['bot_response']({
      text: 'hello',
      is_final: true,
      partial: '',
      message_id: 'm1',
      chunk_index: 0,
      is_interjection: false,
    });
    expect(started).toEqual([{ index: 0, text: 'hello', messageId: 'm1' }]);
  });

  it('starting a new script stops the previous one', async () => {
    await connect(client, handlers);
    const first = client.playScript(['a', 'b']);
    await Promise.resolve();
    const second = client.playScript(['c']);
    await expect(first.done).resolves.toEqual({ reason: 'stopped' });
    await Promise.resolve();
    expect(emittedSayLines().some((s) => s.text === 'c')).toBe(true);
    second.stop();
  });
});
