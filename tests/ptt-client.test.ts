import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  socket: {
    connected: true,
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  createVoiceManager: vi.fn(),
}));
vi.mock('socket.io-client', () => ({ io: () => mocks.socket }));
vi.mock('../src/voice/voice-manager', () => ({ createVoiceManager: mocks.createVoiceManager }));

import { EstuaryClient, type EstuaryConfig } from '../src';

function voiceManager() {
  return {
    isActive: false,
    isPushToTalkActive: false,
    start: vi.fn(async function (this: any) {
      this.isActive = true;
    }),
    stop: vi.fn(async function (this: any) {
      this.isActive = false;
      this.isPushToTalkActive = false;
    }),
    dispose: vi.fn(),
    beginPushToTalk: vi.fn(async function (this: any) {
      this.isPushToTalkActive = true;
    }),
    endPushToTalk: vi.fn(async function (this: any) {
      this.isPushToTalkActive = false;
    }),
  };
}

const baseConfig: EstuaryConfig = {
  serverUrl: 'https://api.example.com',
  apiKey: 'est_test',
  characterId: 'char',
  playerId: 'player',
  voiceMode: 'push_to_talk',
  voiceTransport: 'livekit',
  autoReconnect: false,
};
let handlers: Record<string, (...args: any[]) => void>;
let voice: ReturnType<typeof voiceManager>;
let client: EstuaryClient;

async function connect() {
  const pending = client.connect();
  handlers.connect();
  handlers.session_info({
    session_id: 's',
    conversation_id: 'c',
    character_id: 'char',
    player_id: 'player',
  });
  await pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  mocks.socket.on.mockImplementation((event, cb) => {
    handlers[event] = cb;
  });
  voice = voiceManager();
  mocks.createVoiceManager.mockResolvedValue({ manager: voice, resolvedTransport: 'livekit' });
  client = new EstuaryClient(baseConfig);
});
afterEach(async () => {
  await client.dispose();
});

describe('EstuaryClient push-to-talk API', () => {
  it('requires a connected, prepared PTT voice session', async () => {
    await expect(client.beginPushToTalk()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await connect();
    await expect(client.beginPushToTalk()).rejects.toMatchObject({ code: 'VOICE_NOT_ACTIVE' });
    await expect(client.endPushToTalk()).resolves.toBeUndefined();
    expect(client.isPushToTalkActive).toBe(false);
  });

  it('passes mode to the transport and keeps the voice session active between presses', async () => {
    await connect();
    await client.startVoice();
    expect(mocks.createVoiceManager).toHaveBeenCalledWith(
      'livekit',
      expect.anything(),
      24000,
      expect.anything(),
      'push_to_talk',
    );
    await client.beginPushToTalk();
    expect(client.isPushToTalkActive).toBe(true);
    await client.endPushToTalk();
    expect(client.isPushToTalkActive).toBe(false);
    expect(client.isVoiceActive).toBe(true);
    expect(voice.stop).not.toHaveBeenCalled();
    await client.stopVoice();
    expect(voice.dispose).toHaveBeenCalled();
    await expect(client.endPushToTalk()).resolves.toBeUndefined();
  });

  it('rejects PTT methods in continuous mode', async () => {
    client = new EstuaryClient({ ...baseConfig, voiceMode: 'continuous' });
    await connect();
    await client.startVoice();
    await expect(client.beginPushToTalk()).rejects.toMatchObject({ code: 'VOICE_MODE_MISMATCH' });
    await expect(client.endPushToTalk()).rejects.toMatchObject({ code: 'VOICE_MODE_MISMATCH' });
    expect(voice.beginPushToTalk).not.toHaveBeenCalled();
  });

  it('keeps the selected mode fixed if the caller mutates its config', async () => {
    const config = { ...baseConfig };
    client = new EstuaryClient(config);
    config.voiceMode = 'continuous';
    await connect();
    await client.startVoice();
    await client.beginPushToTalk();
    expect(client.isPushToTalkActive).toBe(true);
  });

  it('reconnect prepares PTT again without resuming the old held button', async () => {
    await connect();
    await client.startVoice();
    await client.beginPushToTalk();
    handlers.disconnect('transport close');
    expect(client.isPushToTalkActive).toBe(false);
    await vi.waitFor(() => expect(voice.dispose).toHaveBeenCalled());
    const resumed = voiceManager();
    mocks.createVoiceManager.mockResolvedValue({ manager: resumed, resolvedTransport: 'livekit' });
    await connect();
    await vi.waitFor(() => expect(resumed.start).toHaveBeenCalled());
    expect(client.isPushToTalkActive).toBe(false);
    expect(resumed.beginPushToTalk).not.toHaveBeenCalled();
    expect(mocks.createVoiceManager.mock.calls.at(-1)?.[4]).toBe('push_to_talk');
  });

  it('voice timeout clears held state and permits a harmless late button release', async () => {
    await connect();
    await client.startVoice();
    await client.beginPushToTalk();
    handlers.voice_timeout({ reason: 'voice_inactivity', idle_seconds: 600, timeout_seconds: 600 });
    expect(client.isPushToTalkActive).toBe(false);
    await client.endPushToTalk();
    await vi.waitFor(() => expect(voice.dispose).toHaveBeenCalled());
    expect(client.isConnected).toBe(true);
  });
});
