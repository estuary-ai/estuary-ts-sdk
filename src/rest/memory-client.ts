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
    this.basePath = `/api/agents/${agentId}/players/${playerId}/memories`;
  }

  async getMemories(options?: MemoryListOptions): Promise<MemoryListResponse> {
    return this.rest.get<MemoryListResponse>(this.basePath, options as Record<string, string | number | boolean | undefined>);
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
      if (options.includeEntities !== undefined) params.include_entities = options.includeEntities;
      if (options.includeCharacterMemories !== undefined) params.include_character_memories = options.includeCharacterMemories;
    }
    return this.rest.get<MemoryGraphResponse>(`${this.basePath}/graph`, params);
  }

  async search(query: string, limit?: number): Promise<MemorySearchResponse> {
    return this.rest.get<MemorySearchResponse>(`${this.basePath}/search`, { query, limit });
  }

  async deleteAll(confirm: boolean): Promise<{ message: string; deletedCount: number }> {
    return this.rest.delete<{ message: string; deletedCount: number }>(this.basePath, { confirm });
  }

  dispose(): void {
    // No persistent resources to clean up
  }
}
