import type { VoiceManager } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';
import { EstuaryError, ErrorCode } from '../errors';

export class WebSocketVoiceManager implements VoiceManager {
  private socketManager: SocketManager;
  private sampleRate: number;
  private logger: Logger;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private zeroGainNode: GainNode | null = null;
  private _isMuted = false;
  private _isSuppressed = false;
  private _isActive = false;

  constructor(socketManager: SocketManager, sampleRate: number, logger: Logger) {
    this.socketManager = socketManager;
    this.sampleRate = sampleRate;
    this.logger = logger;
  }

  get isMuted(): boolean {
    return this._isMuted;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  async start(): Promise<void> {
    if (this._isActive) {
      throw new EstuaryError(ErrorCode.VOICE_ALREADY_ACTIVE, 'Voice is already active');
    }

    if (typeof AudioContext === 'undefined' && typeof (globalThis as any).webkitAudioContext === 'undefined') {
      throw new EstuaryError(ErrorCode.VOICE_NOT_SUPPORTED, 'AudioContext is not available in this environment');
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      throw new EstuaryError(
        ErrorCode.MICROPHONE_DENIED,
        'Microphone access denied',
        err,
      );
    }

    this.mediaStream = stream;
    const AudioCtx = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    const nativeRate = this.audioContext.sampleRate;
    const targetRate = this.sampleRate;

    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (this._isMuted || this._isSuppressed) return;

      const inputData = event.inputBuffer.getChannelData(0);
      let pcmFloat: Float32Array;

      if (nativeRate !== targetRate) {
        pcmFloat = resample(inputData, nativeRate, targetRate);
      } else {
        pcmFloat = inputData;
      }

      const pcm16 = float32ToInt16(pcmFloat);
      const base64 = uint8ArrayToBase64(new Uint8Array(pcm16.buffer));

      try {
        this.socketManager.emitEvent('stream_audio', { audio: base64 });
      } catch {
        // Not connected — ignore, will be handled by disconnect logic
      }
    };

    this.sourceNode.connect(this.scriptProcessor);
    this.zeroGainNode = this.audioContext.createGain();
    this.zeroGainNode.gain.value = 0;
    this.scriptProcessor.connect(this.zeroGainNode);
    this.zeroGainNode.connect(this.audioContext.destination);

    this._isActive = true;
    this.socketManager.emitEvent('start_voice');
    this.logger.debug('WebSocket voice started');
  }

  async stop(): Promise<void> {
    if (!this._isActive) return;

    try {
      this.socketManager.emitEvent('stop_voice');
    } catch {
      // May not be connected
    }

    this.cleanup();
    this._isActive = false;
    this._isMuted = false;
    this._isSuppressed = false;
    this.logger.debug('WebSocket voice stopped');
  }

  toggleMute(): void {
    if (!this._isActive || !this.mediaStream) return;
    this._isMuted = !this._isMuted;
    for (const track of this.mediaStream.getAudioTracks()) {
      track.enabled = !this._isMuted;
    }
    this.logger.debug('Mute toggled:', this._isMuted);
  }

  setSuppressed(suppressed: boolean): void {
    this._isSuppressed = suppressed;
    this.logger.debug('Audio suppression:', suppressed ? 'on' : 'off');
  }

  dispose(): void {
    this.cleanup();
    this._isActive = false;
    this._isMuted = false;
    this._isSuppressed = false;
  }

  private cleanup(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.zeroGainNode) {
      this.zeroGainNode.disconnect();
      this.zeroGainNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIndex - low;
    output[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return output;
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return int16;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  // Node.js fallback
  return Buffer.from(bytes).toString('base64');
}
