import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSocket = {
  connected: true,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { EstuaryClient } from '../src/client';
import type { BotVoice } from '../src/types';

/**
 * The gateway falls back to Socket.IO `bot_voice` (with real audio) when its
 * LiveKit send fails. In LiveKit mode the SDK has no AudioPlayer — an
 * AudioContext would compete with the WebRTC track for mobile audio resources
 * — so that audio used to vanish into `this.audioPlayer?.enqueue(voice)`
 * without a trace, which reads as the character skipping part of a line.
 */
describe('bot_voice audio with no AudioPlayer', () => {
  let client: EstuaryClient;
  let warn: ReturnType<typeof vi.spyOn>;

  const chunk = (messageId: string): BotVoice => ({
    audio: 'AAAA',
    messageId,
    chunkIndex: 0,
    isFinal: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    client = new EstuaryClient({
      serverUrl: 'https://api.example.com',
      apiKey: 'est_test_key',
      characterId: 'char-123',
      playerId: 'player-456',
      voiceTransport: 'livekit',
      autoReconnect: false,
    });
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('warns that unplayable audio arrived instead of dropping it silently', () => {
    (client as any).handleBotVoice(chunk('msg-1'));

    expect(warn).toHaveBeenCalledTimes(1);
    const text = warn.mock.calls[0].join(' ');
    expect(text).toContain('no AudioPlayer');
    expect(text).toContain('LiveKit audio send failed');
  });

  it('warns once per client, not once per chunk', () => {
    for (let i = 0; i < 5; i++) (client as any).handleBotVoice(chunk('msg-1'));
    (client as any).handleBotVoice(chunk('msg-2'));

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still emits botVoice and botAudioLevel so apps are not left blind', () => {
    const onVoice = vi.fn();
    const onLevel = vi.fn();
    client.on('botVoice', onVoice);
    client.on('botAudioLevel', onLevel);

    (client as any).handleBotVoice(chunk('msg-1'));

    expect(onVoice).toHaveBeenCalledTimes(1);
    expect(onLevel).toHaveBeenCalledTimes(1);
  });

  it('metadata-only events (the normal LiveKit path) stay silent', () => {
    (client as any).handleBotVoice({
      messageId: 'msg-1',
      chunkIndex: 0,
      isFinal: false,
      isLivekit: true,
    } as BotVoice);

    expect(warn).not.toHaveBeenCalled();
  });

  it('hands audio to the AudioPlayer and does not warn when one exists', () => {
    const enqueue = vi.fn();
    (client as any).audioPlayer = { enqueue };

    (client as any).handleBotVoice(chunk('msg-1'));

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
