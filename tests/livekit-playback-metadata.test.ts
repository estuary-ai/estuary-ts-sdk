import { describe, expect, it } from 'vitest';

import { readLiveKitPlaybackMetadata } from '../src/voice/livekit-voice';

describe('LiveKit playback correlation metadata', () => {
  it('reads the real utterance id and worker TTS timestamp', () => {
    expect(readLiveKitPlaybackMetadata({
      'estuary.message_id': 'message-123',
      'estuary.tts_first_pcm_epoch_ms': '1777000000123',
    })).toEqual({
      transport: 'livekit',
      messageId: 'message-123',
      ttsFirstPcmEpochMs: 1_777_000_000_123,
    });
  });

  it('falls back to the participant snapshot when only state changed', () => {
    expect(readLiveKitPlaybackMetadata(
      { 'estuary.state': 'speaking' },
      {
        'estuary.message_id': 'message-456',
        'estuary.tts_first_pcm_epoch_ms': '1777000000456',
      },
    )).toMatchObject({
      messageId: 'message-456',
      ttsFirstPcmEpochMs: 1_777_000_000_456,
    });
  });

  it('drops malformed timestamps without dropping the message id', () => {
    expect(readLiveKitPlaybackMetadata({
      'estuary.message_id': 'message-789',
      'estuary.tts_first_pcm_epoch_ms': 'not-a-number',
    })).toEqual({
      transport: 'livekit',
      messageId: 'message-789',
    });
  });
});
