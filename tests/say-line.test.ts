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

describe('sayLine', () => {
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

  it('emits say_line with text_only=false by default', async () => {
    await connect(client, handlers);
    client.sayLine('Hello there');
    expect(mockSocket.emit).toHaveBeenCalledWith('say_line', { text: 'Hello there', text_only: false });
  });

  it('emits text_only=true when requested', async () => {
    await connect(client, handlers);
    client.sayLine('Quiet line', true);
    expect(mockSocket.emit).toHaveBeenCalledWith('say_line', { text: 'Quiet line', text_only: true });
  });

  it('is a no-op for empty/whitespace text', async () => {
    await connect(client, handlers);
    client.sayLine('   ');
    expect(mockSocket.emit).not.toHaveBeenCalledWith('say_line', expect.anything());
  });

  it('throws NOT_CONNECTED before connect', () => {
    expect(() => client.sayLine('hi')).toThrow('Not connected');
  });
});
