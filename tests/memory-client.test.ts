import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryClient } from '../src/rest/memory-client';
import { RestClient } from '../src/rest/rest-client';

vi.mock('../src/rest/rest-client');

describe('MemoryClient', () => {
  let rest: RestClient;
  let client: MemoryClient;

  beforeEach(() => {
    rest = new RestClient('https://api.example.com', 'est_test');
    client = new MemoryClient(rest, 'agent-123', 'player-456');
  });

  it('should call getMemories with correct path and params', async () => {
    const mockResponse = { memories: [], total: 0, limit: 50, offset: 0 };
    vi.mocked(rest.get).mockResolvedValue(mockResponse);

    const result = await client.getMemories({ status: 'active', limit: 10 });

    expect(rest.get).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories',
      expect.objectContaining({ status: 'active', limit: 10 }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('should call getTimeline with correct path', async () => {
    const mockResponse = { timeline: [], totalMemories: 0, groupBy: 'day' };
    vi.mocked(rest.get).mockResolvedValue(mockResponse);

    await client.getTimeline({ groupBy: 'week' });

    expect(rest.get).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories/timeline',
      expect.objectContaining({ groupBy: 'week' }),
    );
  });

  it('should call getStats with correct path', async () => {
    vi.mocked(rest.get).mockResolvedValue({});
    await client.getStats();
    expect(rest.get).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories/stats',
    );
  });

  it('should call getCoreFacts with correct path', async () => {
    vi.mocked(rest.get).mockResolvedValue({ coreFacts: [] });
    await client.getCoreFacts();
    expect(rest.get).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories/core-facts',
    );
  });

  it('should call getGraph with correct path and params', async () => {
    vi.mocked(rest.get).mockResolvedValue({ nodes: [], edges: [], stats: {} });
    await client.getGraph({ includeEntities: true });
    expect(rest.get).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories/graph',
      expect.objectContaining({ include_entities: true }),
    );
  });

  it('should call search with query param', async () => {
    vi.mocked(rest.get).mockResolvedValue({ results: [], query: 'test', total: 0 });
    await client.search('test', 20);
    expect(rest.get).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories/search',
      { q: 'test', limit: 20 },
    );
  });

  it('should call deleteAll with confirm param', async () => {
    vi.mocked(rest.delete).mockResolvedValue({ message: 'ok', deletedCount: 5 });
    const result = await client.deleteAll(true);
    expect(rest.delete).toHaveBeenCalledWith(
      '/api/agents/agent-123/players/player-456/memories',
      { confirm: true },
    );
    expect(result.deletedCount).toBe(5);
  });
});
