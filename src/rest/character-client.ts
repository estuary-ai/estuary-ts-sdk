import type { CharacterInfo } from '../types';
import type { RestClient } from './rest-client';

export class CharacterClient {
  private rest: RestClient;

  constructor(rest: RestClient) {
    this.rest = rest;
  }

  /** Fetch character details including 3D model and avatar URLs. */
  async getCharacter(characterId: string): Promise<CharacterInfo> {
    const raw = await this.rest.get<Record<string, unknown>>(`/api/agents/${characterId}`);
    return {
      id: raw.id as string,
      name: raw.name as string,
      tagline: (raw.tagline as string) ?? null,
      avatar: (raw.avatar as string) ?? null,
      modelUrl: (raw.modelUrl as string) ?? null,
      modelPreviewUrl: (raw.modelPreviewUrl as string) ?? null,
      modelStatus: (raw.modelStatus as string) ?? null,
      sourceImageUrl: (raw.sourceImageUrl as string) ?? null,
    };
  }

  dispose(): void {
    // No persistent resources to clean up
  }
}
