import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toMemoryUpdatedEvent,
  WireMemoryUpdated,
  MemoryUpdatedEvent,
} from '../src/types';

describe('toMemoryUpdatedEvent', () => {
  it('converts wire format to public format', () => {
    const wire: WireMemoryUpdated = {
      agent_id: 'agent-A',
      player_id: 'player-1',
      memories_extracted: 3,
      facts_extracted: 1,
      conversation_id: 'conv-123',
      new_memories: [
        {
          id: 'mem-1',
          content: 'User likes hiking',
          memoryType: 'preference',
          confidence: 0.9,
          status: 'active',
          sourceConversationId: 'conv-123',
          sourceQuote: 'I love hiking in the mountains',
          topic: 'hobbies',
          createdAt: '2026-02-14T10:00:00Z',
        },
      ],
      timestamp: '2026-02-14T10:05:00Z',
    };

    const result = toMemoryUpdatedEvent(wire);

    expect(result.agentId).toBe('agent-A');
    expect(result.playerId).toBe('player-1');
    expect(result.memoriesExtracted).toBe(3);
    expect(result.factsExtracted).toBe(1);
    expect(result.conversationId).toBe('conv-123');
    expect(result.timestamp).toBe('2026-02-14T10:05:00Z');
    expect(result.newMemories).toHaveLength(1);
    expect(result.newMemories[0].content).toBe('User likes hiking');
    expect(result.newMemories[0].memoryType).toBe('preference');
  });

  it('handles empty new_memories gracefully', () => {
    const wire: WireMemoryUpdated = {
      agent_id: 'a',
      player_id: 'p',
      memories_extracted: 0,
      facts_extracted: 0,
      conversation_id: 'c',
      new_memories: [],
      timestamp: '2026-01-01T00:00:00Z',
    };

    const result = toMemoryUpdatedEvent(wire);
    expect(result.newMemories).toEqual([]);
  });

  it('handles undefined new_memories', () => {
    const wire = {
      agent_id: 'a',
      player_id: 'p',
      memories_extracted: 0,
      facts_extracted: 0,
      conversation_id: 'c',
      timestamp: '2026-01-01T00:00:00Z',
    } as WireMemoryUpdated;

    const result = toMemoryUpdatedEvent(wire);
    expect(result.newMemories).toEqual([]);
  });
});

describe('memory_updated socket event', () => {
  const mockSocket = {
    connected: false,
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('socket-manager binds memory_updated handler', async () => {
    vi.doMock('socket.io-client', () => ({
      io: vi.fn(() => mockSocket),
    }));

    const { SocketManager } = await import('../src/connection/socket-manager');
    const { Logger } = await import('../src/utils/logger');

    const manager = new SocketManager(
      {
        serverUrl: 'https://api.example.com',
        apiKey: 'est_test',
        characterId: 'c',
        playerId: 'p',
        autoReconnect: false,
      },
      new Logger(false),
    );

    const handlers: Record<string, (...args: unknown[]) => void> = {};
    mockSocket.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    });

    const memoryFn = vi.fn();
    manager.on('memoryUpdated', memoryFn);

    // Trigger connect flow so bindServerEvents runs
    const connectPromise = manager.connect();
    handlers['connect']();
    handlers['session_info']({
      session_id: 's',
      conversation_id: 'c',
      character_id: 'ch',
      player_id: 'p',
    });
    await connectPromise;

    // Simulate server pushing memory_updated
    handlers['memory_updated']({
      agent_id: 'agent-A',
      player_id: 'player-1',
      memories_extracted: 2,
      facts_extracted: 0,
      conversation_id: 'conv-1',
      new_memories: [],
      timestamp: '2026-02-14T00:00:00Z',
    });

    expect(memoryFn).toHaveBeenCalledOnce();
    const event = memoryFn.mock.calls[0][0] as MemoryUpdatedEvent;
    expect(event.agentId).toBe('agent-A');
    expect(event.memoriesExtracted).toBe(2);
  });
});
