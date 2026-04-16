import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { SocketManager } from '../src/connection/socket-manager';
import { Logger } from '../src/utils/logger';
import { ConnectionState } from '../src/types';

describe('SocketManager', () => {
  let manager: SocketManager;
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
    manager = new SocketManager(config, new Logger(false));
  });

  it('should start in disconnected state', () => {
    expect(manager.state).toBe(ConnectionState.Disconnected);
    expect(manager.isConnected).toBe(false);
    expect(manager.session).toBeNull();
  });

  it('should connect and authenticate', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const connectPromise = manager.connect();
    handlers['connect']();

    expect(mockSocket.emit).toHaveBeenCalledWith('authenticate', {
      api_key: 'est_test_key',
      character_id: 'char-123',
      player_id: 'player-456',
      audio_sample_rate: 24000,
      realtime_memory: false,
    });

    handlers['session_info']({
      session_id: 'sess-1',
      conversation_id: 'conv-1',
      character_id: 'char-123',
      player_id: 'player-456',
    });

    const session = await connectPromise;
    expect(session.sessionId).toBe('sess-1');
    expect(manager.state).toBe(ConnectionState.Connected);
  });

  it('should reject on auth_error', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const connectPromise = manager.connect();
    handlers['connect']();
    handlers['auth_error']({ error: 'Invalid API key' });

    await expect(connectPromise).rejects.toThrow('Invalid API key');
    expect(manager.state).toBe(ConnectionState.Error);
  });

  it('should throw when emitting on disconnected socket', () => {
    expect(() => manager.emitEvent('text', { text: 'hi' })).toThrow('Not connected');
  });

  it('should disconnect cleanly', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const connectPromise = manager.connect();
    handlers['connect']();
    handlers['session_info']({
      session_id: 's',
      conversation_id: 'c',
      character_id: 'ch',
      player_id: 'p',
    });
    await connectPromise;

    manager.disconnect();
    expect(mockSocket.disconnect).toHaveBeenCalled();
    expect(manager.state).toBe(ConnectionState.Disconnected);
    expect(manager.session).toBeNull();
  });
});
