import { describe, it, expect, vi } from 'vitest';

describe('guardrail_event', () => {
  it('forwards metadata without sending an interrupt', async () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket = { connected: false, on: vi.fn((name, fn) => { handlers[name] = fn; }),
      emit: vi.fn(), disconnect: vi.fn(), removeAllListeners: vi.fn() };
    vi.doMock('socket.io-client', () => ({ io: vi.fn(() => socket) }));
    const { SocketManager } = await import('../src/connection/socket-manager');
    const { Logger } = await import('../src/utils/logger');
    const manager = new SocketManager({ serverUrl: 'http://localhost:4001', apiKey: 'key',
      characterId: 'a1', playerId: 'p1', autoReconnect: false }, new Logger(false));
    const received = vi.fn();
    manager.on('guardrailEvent', received);
    const connected = manager.connect();
    handlers.connect();
    handlers.session_info({ session_id: 's1', conversation_id: 'c1', character_id: 'a1', player_id: 'p1' });
    await connected;
    socket.emit.mockClear();
    handlers.guardrail_event({ event_id: 'e1', message_id: 'm1', character_id: 'a1',
      action: 'fallback', attempt: 1, categories: ['Threat'] });
    expect(received).toHaveBeenCalledWith({ eventId: 'e1', messageId: 'm1', characterId: 'a1',
      action: 'fallback', attempt: 1, categories: ['Threat'] });
    expect(socket.emit).not.toHaveBeenCalled();
    manager.disconnect();
  });
});
