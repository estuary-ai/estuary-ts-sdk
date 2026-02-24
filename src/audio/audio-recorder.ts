import { EstuaryError, ErrorCode } from '../errors';

export class AudioRecorder {
  private sampleRate: number;
  private onAudioData: (base64Pcm: string) => void;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private _isRecording = false;

  constructor(sampleRate: number, onAudioData: (base64Pcm: string) => void) {
    this.sampleRate = sampleRate;
    this.onAudioData = onAudioData;
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  async start(): Promise<void> {
    if (this._isRecording) return;

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
      throw new EstuaryError(ErrorCode.MICROPHONE_DENIED, 'Microphone access denied', err);
    }

    this.mediaStream = stream;
    const AudioCtx = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
    this.audioContext = new AudioCtx({ sampleRate: this.sampleRate });

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    const nativeRate = this.audioContext.sampleRate;
    const targetRate = this.sampleRate;

    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      const inputData = event.inputBuffer.getChannelData(0);
      let pcmFloat: Float32Array;

      if (nativeRate !== targetRate) {
        pcmFloat = resample(inputData, nativeRate, targetRate);
      } else {
        pcmFloat = inputData;
      }

      const pcm16 = float32ToInt16(pcmFloat);
      const base64 = uint8ArrayToBase64(new Uint8Array(pcm16.buffer));
      this.onAudioData(base64);
    };

    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
    this._isRecording = true;
  }

  stop(): void {
    if (!this._isRecording) return;

    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
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
    this._isRecording = false;
  }

  dispose(): void {
    this.stop();
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
  return Buffer.from(bytes).toString('base64');
}
