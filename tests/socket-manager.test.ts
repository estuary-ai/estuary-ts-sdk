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
      enable_animation: false,
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

describe('bot_animation wiring', () => {
  let manager: SocketManager;
  const baseConfig = {
    serverUrl: 'https://api.example.com',
    apiKey: 'est_test_key',
    characterId: 'char-123',
    playerId: 'player-456',
    autoReconnect: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    manager = new SocketManager(baseConfig, new Logger(false));
  });

  it('forwards bot_animation with camelCase conversion', async () => {
    const serverHandlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      serverHandlers[event] = handler;
    });

    // Spy on manager.emit
    const emitSpy = vi.spyOn(manager, 'emit');

    const connectPromise = manager.connect();
    // Trigger connect → authenticate
    serverHandlers['connect']();
    // Resolve session
    serverHandlers['session_info']({
      session_id: 'sess-anim',
      conversation_id: 'conv-anim',
      character_id: 'char-123',
      player_id: 'player-456',
    });
    await connectPromise;

    // Simulate server emitting bot_animation
    const wirePayload = {
      message_id: 'msg-001',
      sequence: 42,
      time_code_sec: 1.4,
      fps: 30,
      weights: { jawOpen: 0.42, eyeBlinkLeft: 0.1 },
      emit_epoch_ms: 1714300000000,
      is_final: false,
    };
    serverHandlers['bot_animation'](wirePayload);

    expect(emitSpy).toHaveBeenCalledWith('botAnimation', {
      messageId: 'msg-001',
      sequence: 42,
      timeCodeSec: 1.4,
      fps: 30,
      weights: { jawOpen: 0.42, eyeBlinkLeft: 0.1 },
      emitEpochMs: 1714300000000,
      isFinal: false,
    });
  });

  it('includes enable_animation=true in auth payload when config.enableAnimation=true', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const animManager = new SocketManager(
      { ...baseConfig, enableAnimation: true },
      new Logger(false),
    );

    animManager.connect();
    handlers['connect']();

    const authenticateCalls = mockSocket.emit.mock.calls.filter(
      (call: unknown[]) => call[0] === 'authenticate',
    );
    expect(authenticateCalls.length).toBeGreaterThanOrEqual(1);
    const authPayload = authenticateCalls[authenticateCalls.length - 1][1] as Record<string, unknown>;
    expect(authPayload.enable_animation).toBe(true);
  });

  it('defaults enable_animation=false when config.enableAnimation is omitted', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    manager.connect();
    handlers['connect']();

    const authenticateCalls = mockSocket.emit.mock.calls.filter(
      (call: unknown[]) => call[0] === 'authenticate',
    );
    expect(authenticateCalls.length).toBeGreaterThanOrEqual(1);
    const authPayload = authenticateCalls[authenticateCalls.length - 1][1] as Record<string, unknown>;
    expect(authPayload.enable_animation).toBe(false);
  });

  it('defaults enable_animation=false when config.enableAnimation=false', async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const noAnimManager = new SocketManager(
      { ...baseConfig, enableAnimation: false },
      new Logger(false),
    );

    noAnimManager.connect();
    handlers['connect']();

    const authenticateCalls = mockSocket.emit.mock.calls.filter(
      (call: unknown[]) => call[0] === 'authenticate',
    );
    expect(authenticateCalls.length).toBeGreaterThanOrEqual(1);
    const authPayload = authenticateCalls[authenticateCalls.length - 1][1] as Record<string, unknown>;
    expect(authPayload.enable_animation).toBe(false);
  });
});
