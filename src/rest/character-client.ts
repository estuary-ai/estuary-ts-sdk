import type { CharacterInfo } from '../types';
import type { RestClient } from './rest-client';

export class CharacterClient {
  private rest: RestClient;

  constructor(rest: RestClient) {
    this.rest = rest;
  }

  /** Fetch character details including 3D model and avatar URLs. */
  async getCharacter(characterId: string): Promise<CharacterInfo> {
    // The v1 CharacterResponse is snake_case; map it onto the camelCase public type.
    const raw = await this.rest.get<Record<string, unknown>>(`/api/v1/characters/${characterId}`);
    return {
      id: raw.id as string,
      name: raw.name as string,
      tagline: (raw.tagline as string) ?? null,
      avatar: (raw.avatar as string) ?? null,
      modelUrl: (raw.model_url as string) ?? null,
      modelPreviewUrl: (raw.model_preview_url as string) ?? null,
      modelStatus: (raw.model_status as string) ?? null,
      sourceImageUrl: (raw.source_image_url as string) ?? null,
    };
  }

  dispose(): void {
    // No persistent resources to clean up
  }
}
