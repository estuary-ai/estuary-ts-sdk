import type { BotVoice } from '../types';

export type AudioPlaybackEvent =
  | { type: 'started'; messageId: string }
  | { type: 'complete'; messageId: string };

export class AudioPlayer {
  private sampleRate: number;
  private onEvent: (event: AudioPlaybackEvent) => void;
  private audioContext: AudioContext | null = null;
  private queue: { buffer: AudioBuffer; messageId: string }[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private currentMessageId: string | null = null;
  private isPlaying = false;

  constructor(sampleRate: number, onEvent: (event: AudioPlaybackEvent) => void) {
    this.sampleRate = sampleRate;
    this.onEvent = onEvent;
  }

  enqueue(voice: BotVoice): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    const pcm16 = base64ToInt16Array(voice.audio);
    const float32 = int16ToFloat32(pcm16);

    const buffer = ctx.createBuffer(1, float32.length, this.sampleRate);
    buffer.getChannelData(0).set(float32);

    this.queue.push({ buffer, messageId: voice.messageId });

    if (!this.isPlaying) {
      this.playNext();
    }
  }

  clear(): void {
    this.queue.length = 0;
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
      } catch {
        // Already stopped
      }
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.currentMessageId = null;
  }

  dispose(): void {
    this.clear();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;

    if (typeof AudioContext === 'undefined' && typeof (globalThis as any).webkitAudioContext === 'undefined') {
      return null;
    }

    const AudioCtx = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });
    return this.audioContext;
  }

  private playNext(): void {
    const ctx = this.getAudioContext();
    if (!ctx || this.queue.length === 0) {
      if (this.isPlaying && this.currentMessageId) {
        this.onEvent({ type: 'complete', messageId: this.currentMessageId });
      }
      this.isPlaying = false;
      this.currentMessageId = null;
      return;
    }

    const { buffer, messageId } = this.queue.shift()!;

    // Emit started if this is a new message
    if (messageId !== this.currentMessageId) {
      if (this.currentMessageId) {
        this.onEvent({ type: 'complete', messageId: this.currentMessageId });
      }
      this.currentMessageId = messageId;
      this.onEvent({ type: 'started', messageId });
    }

    this.isPlaying = true;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.currentSource = source;

    source.onended = () => {
      this.currentSource = null;
      this.playNext();
    };

    source.start();
  }
}

function base64ToInt16Array(base64: string): Int16Array {
  let bytes: Uint8Array;
  if (typeof atob === 'function') {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    // Node.js fallback
    bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  }
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}
