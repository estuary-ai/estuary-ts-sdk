import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterClient } from '../src/rest/character-client';
import { RestClient } from '../src/rest/rest-client';

vi.mock('../src/rest/rest-client');

describe('CharacterClient', () => {
  let rest: RestClient;
  let client: CharacterClient;

  beforeEach(() => {
    vi.clearAllMocks();
    rest = new RestClient('https://api.example.com', 'est_test');
    client = new CharacterClient(rest);
  });

  it('should map the snake_case v1 response onto CharacterInfo', async () => {
    vi.mocked(rest.get).mockResolvedValue({
      id: 'char-1',
      name: 'Paper-San',
      tagline: 'Folds under pressure',
      avatar: 'https://cdn.example.com/avatar.png',
      model_url: 'https://cdn.example.com/model.glb',
      model_preview_url: 'https://cdn.example.com/preview.glb',
      model_status: 'completed',
      source_image_url: 'https://cdn.example.com/source.png',
      system_prompt: 'not part of CharacterInfo',
    });

    const result = await client.getCharacter('char-1');

    expect(rest.get).toHaveBeenCalledWith('/api/v1/characters/char-1');
    expect(result).toEqual({
      id: 'char-1',
      name: 'Paper-San',
      tagline: 'Folds under pressure',
      avatar: 'https://cdn.example.com/avatar.png',
      modelUrl: 'https://cdn.example.com/model.glb',
      modelPreviewUrl: 'https://cdn.example.com/preview.glb',
      modelStatus: 'completed',
      sourceImageUrl: 'https://cdn.example.com/source.png',
    });
  });

  it('should default missing optional fields to null', async () => {
    vi.mocked(rest.get).mockResolvedValue({ id: 'char-2', name: 'Bare' });

    const result = await client.getCharacter('char-2');

    expect(result).toEqual({
      id: 'char-2',
      name: 'Bare',
      tagline: null,
      avatar: null,
      modelUrl: null,
      modelPreviewUrl: null,
      modelStatus: null,
      sourceImageUrl: null,
    });
  });
});
