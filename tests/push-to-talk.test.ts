import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocketManager } from '../src/connection/socket-manager';
import { PushToTalk } from '../src/voice/push-to-talk';
import { WebSocketVoiceManager } from '../src/voice/websocket-voice';
import { LiveKitVoiceManager } from '../src/voice/livekit-voice';
import { Logger } from '../src/utils/logger';

const livekit = vi.hoisted(() => ({
  room: null as any,
  track: null as any,
  unmuteWait: null as Promise<void> | null,
}));

vi.mock('livekit-client', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    RoomEvent: {
      TrackSubscribed: 'trackSubscribed',
      TrackUnsubscribed: 'trackUnsubscribed',
      Disconnected: 'disconnected',
      ParticipantAttributesChanged: 'attributes',
    },
    Track: { Kind: { Audio: 'audio' }, Source: { Microphone: 'microphone' } },
    createLocalAudioTrack: vi.fn(async () => livekit.track),
    Room: class extends EventEmitter {
      localParticipant = {
        audioTrackPublications: new Map(),
        trackPublications: new Map(),
        publishTrack: vi.fn(async (track: any) => {
          expect(track.isMuted).toBe(true);
          expect(track.mediaStreamTrack.enabled).toBe(false);
          this.localParticipant.audioTrackPublications.set('mic', { track });
          this.localParticipant.trackPublications.set('mic', { track });
        }),
        setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
          if (enabled) await livekit.unmuteWait;
          livekit.track.isMuted = !enabled;
          livekit.track.mediaStreamTrack.enabled = enabled;
        }),
      };
      connect = vi.fn(async () => {});
      disconnect = vi.fn(() => this.emit('disconnected'));
      constructor() {
        super();
        livekit.room = this;
      }
    },
  };
});

class SocketStub extends EventEmitter {
  connected = true;
  sent: { event: string; data?: any; ack?: () => void }[] = [];
  autoAck = false;
  emit(event: string, data?: any, ack?: () => void): boolean {
    this.sent.push({ event, data, ack });
    if (this.autoAck) ack?.();
    return true;
  }
  receive(event: string, data?: unknown): void {
    super.emit(event, data);
  }
  acknowledge(event: string): void {
    const call = this.sent.find((c) => c.event === event && c.ack);
    expect(call, `pending ${event}`).toBeDefined();
    const ack = call!.ack!;
    call!.ack = undefined;
    ack();
  }
  events(): string[] {
    return this.sent.map((c) => c.event);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function socketManager(raw: SocketStub): SocketManager {
  const events = new EventEmitter();
  let tokenCallback: (data: unknown) => void;
  return Object.assign(events, {
    rawSocket: raw,
    emitEvent(event: string, data?: unknown) {
      raw.emit(event, data);
      if (event === 'livekit_token')
        tokenCallback({ token: 'token', url: 'wss://example.com', room: 'room' });
      if (event === 'livekit_join') events.emit('livekitConnected', 'room');
    },
    onLiveKitToken(callback: (data: unknown) => void) {
      tokenCallback = callback;
    },
  }) as unknown as SocketManager;
}

let raw: SocketStub;
let manager: SocketManager;
const logger = new Logger(false);

beforeEach(() => {
  vi.useFakeTimers();
  raw = new SocketStub();
  manager = socketManager(raw);
  livekit.unmuteWait = null;
  livekit.track = {
    isMuted: false,
    mediaStreamTrack: { enabled: true },
    mute: vi.fn(async () => {
      livekit.track.isMuted = true;
      livekit.track.mediaStreamTrack.enabled = false;
    }),
    stop: vi.fn(),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PTT turn signaling', () => {
  it('declares PTT, waits for handler completion, and deduplicates presses/releases', async () => {
    const transmit = vi.fn();
    const ptt = new PushToTalk(manager, transmit);
    const first = ptt.begin();
    expect(ptt.begin()).toBe(first);
    await settle();
    expect(raw.sent[0].data).toEqual({ turn_mode: 'push_to_talk' });
    raw.receive('voice_started');
    expect(transmit).not.toHaveBeenCalledWith(true);
    raw.acknowledge('start_voice');
    await first;
    expect(transmit).toHaveBeenLastCalledWith(true);
    const released = ptt.end();
    const duplicate = ptt.end();
    expect(transmit).toHaveBeenLastCalledWith(false);
    await settle();
    raw.acknowledge('stop_voice');
    await Promise.all([released, duplicate]);
    expect(raw.events()).toEqual(['start_voice', 'stop_voice']);
  });

  it('release before readiness never opens the microphone', async () => {
    const transmit = vi.fn();
    const ptt = new PushToTalk(manager, transmit);
    const press = ptt.begin();
    await settle();
    const release = ptt.end();
    expect(ptt.isHeld).toBe(false);
    raw.acknowledge('start_voice');
    await settle();
    raw.acknowledge('stop_voice');
    await Promise.all([press, release]);
    expect(transmit).not.toHaveBeenCalledWith(true);
  });

  it('rapid re-press waits until the preceding stop finishes', async () => {
    const ptt = new PushToTalk(manager, vi.fn());
    const first = ptt.begin();
    await settle();
    raw.acknowledge('start_voice');
    await first;
    const release = ptt.end();
    const next = ptt.begin();
    await settle();
    raw.receive('voice_stopped'); // event alone must not allow a new stream
    await settle();
    expect(raw.events()).toEqual(['start_voice', 'stop_voice']);
    raw.acknowledge('stop_voice');
    await settle();
    expect(raw.events()).toEqual(['start_voice', 'stop_voice', 'start_voice']);
    raw.acknowledge('start_voice');
    await Promise.all([release, next]);
    raw.autoAck = true;
    await ptt.dispose();
  });

  it('teardown during start rejects the press and closes the late stream before a new manager presses', async () => {
    const transmit = vi.fn();
    const ptt = new PushToTalk(manager, transmit);
    const press = ptt.begin();
    const rejected = expect(press).rejects.toMatchObject({ code: 'VOICE_NOT_ACTIVE' });
    await settle();
    const closed = ptt.dispose();
    const next = new PushToTalk(manager, vi.fn());
    const nextPress = next.begin();
    await settle();
    expect(raw.events()).toEqual(['start_voice']);
    raw.acknowledge('start_voice');
    await settle();
    expect(raw.events()).toEqual(['start_voice', 'stop_voice']);
    raw.acknowledge('stop_voice');
    await settle();
    raw.acknowledge('start_voice');
    await Promise.all([rejected, closed, nextPress]);
    expect(transmit).not.toHaveBeenCalledWith(true);
    raw.autoAck = true;
    await next.dispose();
  });

  it('reports provider failures without enabling the microphone', async () => {
    const transmit = vi.fn();
    const ptt = new PushToTalk(manager, transmit);
    const press = ptt.begin();
    const rejected = expect(press).rejects.toThrow('soniox_failed');
    await settle();
    raw.receive('voice_error', { error: 'soniox_failed' });
    raw.acknowledge('start_voice');
    await rejected;
    expect(ptt.isHeld).toBe(false);
    expect(transmit).not.toHaveBeenCalledWith(true);
    expect(raw.listenerCount('voice_error')).toBe(0);
    raw.autoAck = true;
    await ptt.dispose();
  });

  it('times out safely, blocks retries on the ambiguous socket, and cleans up a late start', async () => {
    const ptt = new PushToTalk(manager, vi.fn());
    const press = ptt.begin();
    const rejected = expect(press).rejects.toMatchObject({ code: 'CONNECTION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(ptt.isHeld).toBe(false);
    await ptt.dispose();
    raw.acknowledge('start_voice');
    const freshVoice = new PushToTalk(manager, vi.fn());
    await expect(freshVoice.begin()).rejects.toThrow('reconnect');
    expect(raw.events().filter((event) => event === 'start_voice')).toHaveLength(1);
    expect(raw.listenerCount('disconnect')).toBe(0);
    await freshVoice.dispose();
  });

  it('disconnect cancels a pending press and removes listeners', async () => {
    const ptt = new PushToTalk(manager, vi.fn());
    const press = ptt.begin();
    const rejected = expect(press).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await settle();
    raw.connected = false;
    raw.receive('disconnect');
    await rejected;
    expect(ptt.isHeld).toBe(false);
    expect(raw.listenerCount('voice_error')).toBe(0);
    await ptt.dispose();
  });
});

function installMicrophone() {
  const processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as any };
  const track = { stop: vi.fn() };
  const context = {
    sampleRate: 24000,
    destination: {},
    createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
    createScriptProcessor: vi.fn(() => processor),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
    close: vi.fn(async () => {}),
  };
  vi.stubGlobal(
    'AudioContext',
    class {
      constructor() {
        return context;
      }
    },
  );
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  return {
    track,
    context,
    frame: () =>
      processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array([0.25, -0.25]) },
      }),
  };
}

describe('WebSocket PTT audio', () => {
  it('prepares silently, sends only held audio, flushes the tail, and reuses the mic', async () => {
    const mic = installMicrophone();
    const voice = new WebSocketVoiceManager(manager, 24000, logger, 'push_to_talk');
    await voice.start();
    mic.frame();
    expect(raw.events()).toEqual([]);
    const press = voice.beginPushToTalk();
    await settle();
    mic.frame();
    expect(raw.events()).toEqual(['start_voice']);
    raw.acknowledge('start_voice');
    await press;
    mic.frame();
    expect(raw.events()).toEqual(['start_voice', 'stream_audio']);
    const release = voice.endPushToTalk();
    await settle();
    expect(raw.events()).not.toContain('stop_voice');
    mic.frame(); // final partial block, then the release signal
    await settle();
    expect(raw.events()).toEqual(['start_voice', 'stream_audio', 'stream_audio', 'stop_voice']);
    mic.frame();
    raw.acknowledge('stop_voice');
    await release;
    expect(voice.isActive).toBe(true);
    expect(mic.track.stop).not.toHaveBeenCalled();
    raw.autoAck = true;
    await voice.beginPushToTalk();
    mic.frame();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    await voice.stop();
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
    expect(voice.isPushToTalkActive).toBe(false);
  });

  it('mute and suppression cannot enable audio between presses', async () => {
    const mic = installMicrophone();
    raw.autoAck = true;
    const voice = new WebSocketVoiceManager(manager, 24000, logger, 'push_to_talk');
    await voice.start();
    voice.toggleMute();
    voice.toggleMute();
    voice.setSuppressed(true);
    voice.setSuppressed(false);
    mic.frame();
    expect(raw.events()).toEqual([]);
    await voice.beginPushToTalk();
    voice.toggleMute();
    mic.frame();
    voice.toggleMute();
    voice.setSuppressed(true);
    mic.frame();
    expect(raw.events()).toEqual(['start_voice']);
    voice.setSuppressed(false);
    mic.frame();
    expect(raw.events()).toContain('stream_audio');
    await voice.stop();
  });

  it('release completes even when the audio context is suspended', async () => {
    installMicrophone();
    raw.autoAck = true;
    const voice = new WebSocketVoiceManager(manager, 24000, logger, 'push_to_talk');
    await voice.start();
    await voice.beginPushToTalk();
    const released = voice.endPushToTalk();
    await vi.advanceTimersByTimeAsync(100);
    await released;
    expect(raw.events()).toEqual(['start_voice', 'stop_voice']);
    await voice.stop();
  });

  it('keeps continuous mode start/stop behavior', async () => {
    const mic = installMicrophone();
    const voice = new WebSocketVoiceManager(manager, 24000, logger);
    await voice.start();
    mic.frame();
    await voice.stop();
    expect(raw.events()).toEqual(['start_voice', 'stream_audio', 'stop_voice']);
    expect(raw.sent[0].data).toBeUndefined();
  });
});

describe('LiveKit PTT audio', () => {
  it('declares PTT before STT setup, publishes muted, and keeps the room between turns', async () => {
    raw.autoAck = true;
    const voice = new LiveKitVoiceManager(manager, logger, 'push_to_talk');
    await voice.start();
    expect(raw.sent.slice(0, 2)).toMatchObject([
      { event: 'livekit_token', data: { turn_mode: 'push_to_talk' } },
      { event: 'livekit_join', data: { turn_mode: 'push_to_talk' } },
    ]);
    expect(livekit.room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    await voice.beginPushToTalk();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(true);
    await voice.endPushToTalk();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    expect(livekit.room.disconnect).not.toHaveBeenCalled();
    expect(voice.isActive).toBe(true);
    await voice.beginPushToTalk();
    await voice.endPushToTalk();
    expect(livekit.room.connect).toHaveBeenCalledTimes(1);
    await voice.stop();
    expect(raw.events().filter((e) => e === 'livekit_leave')).toHaveLength(1);
    expect(livekit.track.stop).toHaveBeenCalled();
  });

  it('a release during asynchronous unmute wins and cannot reopen the mic', async () => {
    raw.autoAck = true;
    const voice = new LiveKitVoiceManager(manager, logger, 'push_to_talk');
    await voice.start();
    let finishUnmute!: () => void;
    livekit.unmuteWait = new Promise((resolve) => {
      finishUnmute = resolve;
    });
    const press = voice.beginPushToTalk();
    await settle();
    const release = voice.endPushToTalk();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    finishUnmute();
    await Promise.all([press, release]);
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    expect(livekit.room.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    await voice.stop();
  });

  it('mute and suppression remain independent of the talk button', async () => {
    raw.autoAck = true;
    const voice = new LiveKitVoiceManager(manager, logger, 'push_to_talk');
    await voice.start();
    voice.toggleMute();
    voice.toggleMute();
    voice.setSuppressed(true);
    voice.setSuppressed(false);
    await settle();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    voice.toggleMute();
    await voice.beginPushToTalk();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    voice.toggleMute();
    await settle();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(true);
    voice.setSuppressed(true);
    await settle();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    await voice.endPushToTalk();
    voice.setSuppressed(false);
    await settle();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    await voice.stop();
  });

  it('stop during a pending press releases tracks and the room immediately', async () => {
    const voice = new LiveKitVoiceManager(manager, logger, 'push_to_talk');
    await voice.start();
    const press = voice.beginPushToTalk();
    const rejected = expect(press).rejects.toMatchObject({ code: 'VOICE_NOT_ACTIVE' });
    await settle();
    const stopped = voice.stop();
    expect(livekit.room.disconnect).toHaveBeenCalled();
    expect(livekit.track.mediaStreamTrack.enabled).toBe(false);
    expect(livekit.track.stop).toHaveBeenCalled();
    raw.acknowledge('start_voice');
    await settle();
    raw.acknowledge('stop_voice');
    await Promise.all([rejected, stopped]);
    expect(voice.isPushToTalkActive).toBe(false);
  });

  it('continuous mode still enables the mic immediately without PTT payloads', async () => {
    const voice = new LiveKitVoiceManager(manager, logger);
    await voice.start();
    expect(raw.sent[0].data).toBeUndefined();
    expect(raw.sent[1].data).toEqual({ room: 'room' });
    expect(livekit.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await voice.stop();
  });
});
