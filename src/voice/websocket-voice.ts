import type { VoiceManager, VoiceMode } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';
import { EstuaryError, ErrorCode } from '../errors';
import { resample, float32ToInt16, uint8ArrayToBase64 } from '../audio/audio-utils';
import { PushToTalk } from './push-to-talk';

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
  private ptt: PushToTalk | null = null;
  private pttTransmitting = false;
  private finishPttFrame?: () => void;
  private pttDrain: Promise<void> | null = null;

  constructor(socketManager: SocketManager, sampleRate: number, logger: Logger, private voiceMode: VoiceMode = 'continuous') {
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

  get isPushToTalkActive(): boolean { return this.ptt?.isHeld ?? false; }

  async beginPushToTalk(): Promise<void> {
    if (!this._isActive || !this.ptt) {
      throw new EstuaryError(ErrorCode.VOICE_NOT_ACTIVE, 'PTT voice is not active');
    }
    await this.ptt.begin();
  }

  async endPushToTalk(): Promise<void> { await this.ptt?.end(); }

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
    this.scriptProcessor = this.audioContext.createScriptProcessor(this.voiceMode === 'push_to_talk' ? 1024 : 4096, 1, 1);

    const nativeRate = this.audioContext.sampleRate;
    const targetRate = this.sampleRate;

    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this._isActive || this._isMuted || this._isSuppressed ||
          (this.voiceMode === 'push_to_talk' && !this.pttTransmitting)) {
        this.finishPttFrame?.();
        return;
      }

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
      // Release includes the last partially captured block before stop_voice.
      this.finishPttFrame?.();
    };

    this.sourceNode.connect(this.scriptProcessor);
    this.zeroGainNode = this.audioContext.createGain();
    this.zeroGainNode.gain.value = 0;
    this.scriptProcessor.connect(this.zeroGainNode);
    this.zeroGainNode.connect(this.audioContext.destination);

    this._isActive = true;
    if (this.voiceMode === 'push_to_talk') {
      this.ptt = new PushToTalk(this.socketManager, (enabled) => this.setPttTransmitting(enabled));
    } else {
      this.socketManager.emitEvent('start_voice');
    }
    this.logger.debug('WebSocket voice started');
  }

  async stop(): Promise<void> {
    if (!this._isActive) return;

    let closed: Promise<void> | undefined;
    if (this.ptt) {
      closed = this.ptt.dispose();
      this.ptt = null;
    } else {
      try {
        this.socketManager.emitEvent('stop_voice');
      } catch {
        // May not be connected
      }
    }

    this.cleanup();
    this._isActive = false;
    this._isMuted = false;
    this._isSuppressed = false;
    this.logger.debug('WebSocket voice stopped');
    await closed;
  }

  toggleMute(): void {
    if (!this._isActive) return;
    this._isMuted = !this._isMuted;
    // Mute is enforced purely in the onaudioprocess gate (alongside _isSuppressed).
    // We intentionally do NOT touch track.enabled — toggling the track conflicts
    // with suppressMicDuringPlayback, which also gates via _isSuppressed in the
    // same callback. Disabling the track would prevent audio from resuming when
    // suppression lifts, and re-enabling it from suppression would override mute.
    this.logger.debug('Mute toggled:', this._isMuted);
  }

  setSuppressed(suppressed: boolean): void {
    this._isSuppressed = suppressed;
    this.logger.debug('Audio suppression:', suppressed ? 'on' : 'off');
  }

  dispose(): void {
    this.ptt?.dispose();
    this.ptt = null;
    this.cleanup();
    this._isActive = false;
    this._isMuted = false;
    this._isSuppressed = false;
  }

  private cleanup(): void {
    this.finishPttFrame?.();
    this.pttTransmitting = false;
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

  private setPttTransmitting(enabled: boolean): void | Promise<void> {
    if (enabled) {
      this.pttTransmitting = true;
      return;
    }
    if (this.pttDrain) return this.pttDrain;
    if (!this.pttTransmitting) return;
    this.pttDrain = new Promise<void>((resolve) => {
      // A suspended AudioContext may never deliver the trailing callback.
      const timer = setTimeout(() => this.finishPttFrame?.(), 100);
      this.finishPttFrame = () => {
        clearTimeout(timer);
        this.pttTransmitting = false;
        this.finishPttFrame = undefined;
        this.pttDrain = null;
        resolve();
      };
    });
    return this.pttDrain;
  }
}
