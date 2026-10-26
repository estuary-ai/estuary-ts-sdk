import type {
  MemoryListOptions,
  MemoryListResponse,
  MemoryTimelineOptions,
  MemoryTimelineResponse,
  MemoryStatsResponse,
  CoreFactsResponse,
  MemoryGraphOptions,
  MemoryGraphResponse,
  MemorySearchResponse,
} from '../types';
import type { RestClient } from './rest-client';

export class MemoryClient {
  private rest: RestClient;
  private basePath: string;

  constructor(rest: RestClient, agentId: string, playerId: string) {
    this.rest = rest;
    this.basePath = `/api/v1/characters/${agentId}/players/${playerId}/memories`;
  }

  async getMemories(options?: MemoryListOptions): Promise<MemoryListResponse> {
    // The v1 list route has no sort parameters (the legacy route accepted and ignored them).
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options) {
      params.memoryType = options.memoryType;
      params.status = options.status;
      params.limit = options.limit;
      params.offset = options.offset;
    }
    return this.rest.get<MemoryListResponse>(this.basePath, params);
  }

  async getTimeline(options?: MemoryTimelineOptions): Promise<MemoryTimelineResponse> {
    return this.rest.get<MemoryTimelineResponse>(`${this.basePath}/timeline`, options as Record<string, string | number | boolean | undefined>);
  }

  async getStats(): Promise<MemoryStatsResponse> {
    return this.rest.get<MemoryStatsResponse>(`${this.basePath}/stats`);
  }

  async getCoreFacts(): Promise<CoreFactsResponse> {
    return this.rest.get<CoreFactsResponse>(`${this.basePath}/core-facts`);
  }

  async getGraph(options?: MemoryGraphOptions): Promise<MemoryGraphResponse> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options) {
      if (options.includeEntities !== undefined) params.includeEntities = options.includeEntities;
      if (options.includeCharacterMemories !== undefined) params.includeCharacterMemories = options.includeCharacterMemories;
    }
    return this.rest.get<MemoryGraphResponse>(`${this.basePath}/graph`, params);
  }

  async search(query: string, limit?: number): Promise<MemorySearchResponse> {
    // POST with a JSON body: the gateway has never accepted GET ?q= here (405).
    const body: { query: string; limit?: number } = { query };
    if (limit !== undefined) body.limit = limit;
    return this.rest.post<MemorySearchResponse>(`${this.basePath}/search`, body);
  }

  async deleteAll(confirm: boolean): Promise<{ message: string; deletedCount: number }> {
    // v1 returns only { deletedCount }; the legacy message was derived from the same count.
    const raw = await this.rest.delete<{ deletedCount: number; message?: string }>(this.basePath, { confirm });
    return {
      message: raw.message ?? `Deleted ${raw.deletedCount} records`,
      deletedCount: raw.deletedCount,
    };
  }

  dispose(): void {
    // No persistent resources to clean up
  }
}
