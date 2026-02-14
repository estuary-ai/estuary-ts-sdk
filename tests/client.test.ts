import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { EstuaryClient } from '../src/client';
import { ConnectionState } from '../src/types';

describe('EstuaryClient', () => {
  let client: EstuaryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    client = new EstuaryClient({
      serverUrl: 'https://api.example.com',
      apiKey: 'est_test_key',
      characterId: 'char-123',
      playerId: 'player-456',
      autoReconnect: false,
    });
  });

  it('should initialize with disconnected state', () => {
    expect(client.connectionState).toBe(ConnectionState.Disconnected);
    expect(client.isConnected).toBe(false);
    expect(client.session).toBeNull();
  });

  it('should expose memory client', () => {
    expect(client.memory).toBeDefined();
    expect(typeof client.memory.getMemories).toBe('function');
    expect(typeof client.memory.getCoreFacts).toBe('function');
    expect(typeof client.memory.getGraph).toBe('function');
  });

  it('should throw when sendText before connect', () => {
    expect(() => client.sendText('hello')).toThrow('Not connected');
  });

  it('should throw when interrupt before connect', () => {
    expect(() => client.interrupt()).toThrow('Not connected');
  });

  it('should have voice methods', () => {
    expect(typeof client.startVoice).toBe('function');
    expect(typeof client.stopVoice).toBe('function');
    expect(typeof client.toggleMute).toBe('function');
    expect(client.isMuted).toBe(false);
    expect(client.isVoiceActive).toBe(false);
  });

  it('should connect and forward events', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const connectedFn = vi.fn();
    client.on('connected', connectedFn);

    const connectPromise = client.connect();

    handlers['connect']();
    handlers['session_info']({
      session_id: 'sess-1',
      conversation_id: 'conv-1',
      character_id: 'char-123',
      player_id: 'player-456',
    });

    const session = await connectPromise;
    expect(session.sessionId).toBe('sess-1');
    expect(connectedFn).toHaveBeenCalled();
  });

  it('should forward memoryUpdated event from socket manager', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const memoryFn = vi.fn();
    client.on('memoryUpdated', memoryFn);

    const connectPromise = client.connect();
    handlers['connect']();
    handlers['session_info']({
      session_id: 'sess-1',
      conversation_id: 'conv-1',
      character_id: 'char-123',
      player_id: 'player-456',
    });
    await connectPromise;

    handlers['memory_updated']({
      agent_id: 'agent-A',
      player_id: 'player-1',
      memories_extracted: 2,
      facts_extracted: 1,
      conversation_id: 'conv-1',
      new_memories: [],
      timestamp: '2026-02-14T00:00:00Z',
    });

    expect(memoryFn).toHaveBeenCalledOnce();
    expect(memoryFn.mock.calls[0][0].agentId).toBe('agent-A');
  });

  it('should disconnect cleanly', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const connectPromise = client.connect();
    handlers['connect']();
    handlers['session_info']({
      session_id: 's',
      conversation_id: 'c',
      character_id: 'ch',
      player_id: 'p',
    });
    await connectPromise;

    client.disconnect();
    expect(client.session).toBeNull();
    expect(client.connectionState).toBe(ConnectionState.Disconnected);
  });
});
