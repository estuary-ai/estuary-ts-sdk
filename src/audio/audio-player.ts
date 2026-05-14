import type { BotVoice } from '../types';

export type AudioPlaybackEvent =
  | { type: 'started'; messageId: string }
  | { type: 'complete'; messageId: string };

export class AudioPlayer {
  private sampleRate: number;
  private onEvent: (event: AudioPlaybackEvent) => void;
  private audioContext: AudioContext | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private audioElement: HTMLAudioElement | null = null;
  private queue: { buffer: AudioBuffer; messageId: string }[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private currentMessageId: string | null = null;
  private isPlaying = false;
  private _isCleared = false;
  private _interruptedMessageId: string | null = null;
  private _drainTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Per-message audio-clock tracking ──────────────────────────────
  // Reports how long audio has ACTUALLY been playing through the graph
  // for the current message. ctx.currentTime advances continuously
  // (even during inter-chunk silence gaps), so we can't use a single
  // anchor-and-elapsed approach: the previous "cap at total buffered
  // duration" design failed because total buffered grows ahead of
  // playback when a fresh burst arrives, producing a forward jump at
  // burst resume = the spurious slot-N motion skip downstream.
  //
  // We accumulate played duration segment by segment instead:
  //   - _msgPlayedTime: sum of buffer durations that have already
  //     finished playing for this message (precise, sample-accurate
  //     since we use the buffer's intrinsic duration).
  //   - _msgCurrentSegmentStart: ctx.currentTime captured at every
  //     source.start(), or null when nothing is playing (silence
  //     between bursts; pre-first-chunk).
  //
  // getAudioElapsedForMessage returns _msgPlayedTime + (currently-
  // playing offset). Pauses during silence; resumes from where it
  // left off — no jump.
  private _msgId: string | null = null;
  private _msgPlayedTime = 0;
  private _msgCurrentSegmentStart: number | null = null;

  /**
   * How long to wait for more chunks before declaring playback complete (ms).
   *
   * Must be larger than the worst-case mid-utterance gap between backend audio
   * chunks (MIN_AUDIO_CHUNK_BYTES = 200ms of audio + network + jitter). If set
   * below that, a single slow chunk fires 'complete' mid-speech, the consumer
   * resets per-utterance state (e.g. clock, animation buffers), and when the
   * next chunk arrives we get a spurious 'started' + wrong-timebase frame lookup.
   * 1500ms gives generous headroom on resource-constrained rigs (WSL2, shared
   * GPU running a local A2F NIM) without visibly delaying end-of-turn UX.
   */
  private static readonly DRAIN_DELAY_MS = 1500;

  constructor(sampleRate: number, onEvent: (event: AudioPlaybackEvent) => void) {
    this.sampleRate = sampleRate;
    this.onEvent = onEvent;
  }

  /** Whether audio is currently playing */
  get playing(): boolean {
    return this.isPlaying;
  }

  /** The messageId of the currently playing audio, or null */
  get playingMessageId(): string | null {
    return this.currentMessageId;
  }

  /** Mark a messageId as interrupted so late-arriving chunks are dropped */
  setInterruptedMessageId(id: string | null): void {
    this._interruptedMessageId = id;
  }

  enqueue(voice: BotVoice): void {
    // LiveKit metadata events have no audio payload — caller should route those separately
    if (!voice.audio) return;
    // Drop chunks belonging to the interrupted message
    if (voice.messageId === this._interruptedMessageId) return;
    // Clear the filter once a new message arrives
    if (this._interruptedMessageId && voice.messageId !== this._interruptedMessageId) {
      this._interruptedMessageId = null;
    }

    this._isCleared = false;
    // Cancel pending drain — more audio is arriving
    this.cancelDrain();

    const ctx = this.getAudioContext();
    if (!ctx) return;

    const pcm16 = base64ToInt16Array(voice.audio);
    const float32 = int16ToFloat32(pcm16);

    const buffer = ctx.createBuffer(1, float32.length, this.sampleRate);
    buffer.getChannelData(0).set(float32);

    // New message — reset the played-time accumulator. Any in-flight
    // source for the previous message has its onended fire-and-forget;
    // the messageId check inside onended skips accumulating into the
    // new message's clock so there's no cross-message contamination.
    if (voice.messageId !== this._msgId) {
      this._msgId = voice.messageId;
      this._msgPlayedTime = 0;
      this._msgCurrentSegmentStart = null;
    }

    this.queue.push({ buffer, messageId: voice.messageId });

    // New data arrived — cancel any pending drain timeout so we don't
    // fire a spurious 'complete' between chunks. If we were draining
    // (waiting to declare complete), we need to kick playNext because
    // no active source will trigger it — the previous source already ended.
    const wasDraining = this._drainTimer !== null;
    this.cancelDrain();

    if (!this.isPlaying || wasDraining) {
      this.playNext();
    }
  }

  clear(): void {
    this._isCleared = true;
    this.cancelDrain();
    this.queue.length = 0;
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {
        // Already stopped
      }
      this.currentSource = null;
    }
    // Push silence through mediaStreamDest to flush the <audio> element's
    // internal pipeline buffer. Without this, mobile browsers replay the last
    // buffered frames. We can't touch the <audio> element directly (pause or
    // srcObject reassignment revokes the autoplay privilege on mobile).
    if (this.audioContext && this.mediaStreamDest) {
      const silence = this.audioContext.createBuffer(
        1,
        this.sampleRate * 0.25,
        this.sampleRate,
      );
      const src = this.audioContext.createBufferSource();
      src.buffer = silence;
      src.connect(this.mediaStreamDest);
      src.start();
    }
    this.isPlaying = false;
    this.currentMessageId = null;
    this._msgId = null;
    this._msgPlayedTime = 0;
    this._msgCurrentSegmentStart = null;
  }

  /**
   * Audio-clock elapsed time (seconds) for a specific message. Returns
   * 0 if the message isn't the one currently being tracked. Pauses
   * during inter-chunk silence (no source playing) and resumes from
   * where it left off — no forward jump on burst resume. Consumers
   * that need a "true audio playback time" instead of wall clock use
   * this.
   */
  getAudioElapsedForMessage(messageId: string): number {
    if (this._msgId !== messageId) return 0;
    if (!this.audioContext) return 0;
    let total = this._msgPlayedTime;
    if (this._msgCurrentSegmentStart !== null) {
      total += this.audioContext.currentTime - this._msgCurrentSegmentStart;
    }
    return Math.max(0, total);
  }

  dispose(): void {
    this.cancelDrain();
    this.clear();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement.remove();
      this.audioElement = null;
    }
    if (this.mediaStreamDest) {
      this.mediaStreamDest.disconnect();
      this.mediaStreamDest = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }

  /** Schedule a deferred 'complete' event. Cancelled if new chunks arrive. */
  private scheduleDrain(): void {
    if (this._drainTimer !== null) return; // already scheduled
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      if (this._isCleared) return;
      // Queue is still empty after grace period — playback is truly done
      if (this.queue.length === 0 && this.isPlaying && this.currentMessageId) {
        this.onEvent({ type: 'complete', messageId: this.currentMessageId });
        this.isPlaying = false;
        this.currentMessageId = null;
      }
    }, AudioPlayer.DRAIN_DELAY_MS);
  }

  private cancelDrain(): void {
    if (this._drainTimer !== null) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
  }

  private getAudioContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;

    if (typeof AudioContext === 'undefined' && typeof (globalThis as any).webkitAudioContext === 'undefined') {
      return null;
    }

    const AudioCtx = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: this.sampleRate });
    this.audioContext = ctx;

    // Route through a MediaStreamDestination → hidden <audio> element so the
    // browser's AEC pipeline can see our playback as the echo reference signal.
    if (typeof document !== 'undefined') {
      this.mediaStreamDest = ctx.createMediaStreamDestination();
      const el = document.createElement('audio');
      el.srcObject = this.mediaStreamDest.stream;
      el.autoplay = true;
      // Hidden but in the DOM so the browser treats it as a real media element
      el.style.display = 'none';
      document.body.appendChild(el);
      el.play().catch(() => {});
      this.audioElement = el;
    }

    return ctx;
  }

  private playNext(): void {
    if (this._isCleared) return;

    const ctx = this.getAudioContext();
    if (!ctx || this.queue.length === 0) {
      // Don't fire complete immediately — more chunks may still be in flight.
      // Wait a short grace period before declaring playback done.
      if (this.isPlaying && this.currentMessageId) {
        this.scheduleDrain();
      }
      return;
    }

    // We have more data — cancel any pending drain timer
    this.cancelDrain();

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
    source.connect(this.mediaStreamDest ?? ctx.destination);
    this.currentSource = source;

    // Per-segment audio-clock anchor. ctx.currentTime is captured at
    // every source.start() (not just the first chunk of a message) so
    // getAudioElapsedForMessage can compute the currently-playing
    // offset. Accumulated into _msgPlayedTime when the buffer ends.
    const bufferDuration = buffer.duration;
    if (messageId === this._msgId) {
      this._msgCurrentSegmentStart = ctx.currentTime;
    }

    source.onended = () => {
      if (this._isCleared) return;
      // Accumulate this segment's duration into the running total, but
      // only if the message hasn't been switched out from under us
      // (interrupt + new utterance starting before this source ends).
      // Using bufferDuration (the buffer's intrinsic length) rather
      // than ctx.currentTime - segmentStart so the clock is precise to
      // the sample and not subject to ctx clock resolution.
      if (this._msgCurrentSegmentStart !== null && messageId === this._msgId) {
        this._msgPlayedTime += bufferDuration;
        this._msgCurrentSegmentStart = null;
      }
      this.currentSource = null;
      this.playNext();
    };

    if (this.audioElement) {
      this.audioElement.play().catch(() => {});
    }
    ctx.resume().catch(() => {});
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
