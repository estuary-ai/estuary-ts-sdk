import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryClient } from '../src/rest/memory-client';
import { RestClient } from '../src/rest/rest-client';

vi.mock('../src/rest/rest-client');

describe('MemoryClient', () => {
  let rest: RestClient;
  let client: MemoryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    rest =new RestClient('https://api.example.com', 'est_test');
    client = new MemoryClient(rest, 'agent-123', 'player-456');
  });

  it('should call getMemories with correct path and params', async () => {
    const mockResponse = { memories: [], total: 0, limit: 50, offset: 0 };
    vi.mocked(rest.get).mockResolvedValue(mockResponse);

    const result = await client.getMemories({ status: 'active', limit: 10 });

    expect(rest.get).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories',
      expect.objectContaining({ status: 'active', limit: 10 }),
    );
    expect(result).toEqual(mockResponse);
  });

  it('should call getTimeline with correct path', async () => {
    const mockResponse = { timeline: [], totalMemories: 0, groupBy: 'day' };
    vi.mocked(rest.get).mockResolvedValue(mockResponse);

    await client.getTimeline({ groupBy: 'week' });

    expect(rest.get).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories/timeline',
      expect.objectContaining({ groupBy: 'week' }),
    );
  });

  it('should call getStats with correct path', async () => {
    vi.mocked(rest.get).mockResolvedValue({});
    await client.getStats();
    expect(rest.get).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories/stats',
    );
  });

  it('should call getCoreFacts with correct path', async () => {
    vi.mocked(rest.get).mockResolvedValue({ coreFacts: [] });
    await client.getCoreFacts();
    expect(rest.get).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories/core-facts',
    );
  });

  it('should call getGraph with correct path and params', async () => {
    vi.mocked(rest.get).mockResolvedValue({ nodes: [], edges: [], stats: {} });
    await client.getGraph({ includeEntities: true });
    expect(rest.get).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories/graph',
      { includeEntities: true },
    );
  });

  it('should not send the sort options the gateway never honoured', async () => {
    vi.mocked(rest.get).mockResolvedValue({ memories: [], total: 0, limit: 50, offset: 0 });
    await client.getMemories({ memoryType: 'fact', sortBy: 'confidence', sortOrder: 'asc' });
    const params = vi.mocked(rest.get).mock.calls[0][1] as Record<string, unknown>;
    expect(params.memoryType).toBe('fact');
    expect(params).not.toHaveProperty('sortBy');
    expect(params).not.toHaveProperty('sortOrder');
  });

  it('should POST search with a JSON body', async () => {
    vi.mocked(rest.post).mockResolvedValue({ results: [], query: 'test', total: 0 });
    await client.search('test', 20);
    expect(rest.post).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories/search',
      { query: 'test', limit: 20 },
    );
    expect(rest.get).not.toHaveBeenCalled();
  });

  it('should omit limit from the search body when not given', async () => {
    vi.mocked(rest.post).mockResolvedValue({ results: [], query: 'test', total: 0 });
    await client.search('test');
    expect(rest.post).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories/search',
      { query: 'test' },
    );
  });

  it('should keep the deleteAll message when the v1 route omits it', async () => {
    vi.mocked(rest.delete).mockResolvedValue({ deletedCount: 3 });
    const result = await client.deleteAll(true);
    expect(result).toEqual({ message: 'Deleted 3 records', deletedCount: 3 });
  });

  it('should call deleteAll with confirm param', async () => {
    vi.mocked(rest.delete).mockResolvedValue({ message: 'ok', deletedCount: 5 });
    const result = await client.deleteAll(true);
    expect(rest.delete).toHaveBeenCalledWith(
      '/api/v1/characters/agent-123/players/player-456/memories',
      { confirm: true },
    );
    expect(result.deletedCount).toBe(5);
  });
});
