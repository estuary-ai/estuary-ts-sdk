import type {
  BotResponse,
  EstuaryEventMap,
  InterruptData,
  ScriptController,
  ScriptEndReason,
  ScriptLine,
  ScriptLineStartedInfo,
  ScriptOptions,
  ScriptState,
} from '../types';

/**
 * Seam between ScriptPlayer and EstuaryClient. Minimal on purpose so the player
 * can be unit-tested against a fake host with no socket/audio dependencies.
 */
export interface ScriptHost {
  sayLine(text: string, textOnly: boolean): void;
  interrupt(): void;
  on<K extends keyof EstuaryEventMap>(event: K, listener: EstuaryEventMap[K]): unknown;
  off<K extends keyof EstuaryEventMap>(event: K, listener: EstuaryEventMap[K]): unknown;
  readonly isConnected: boolean;
  /** True when the SDK itself plays say_line TTS audio (→ audioPlaybackComplete will fire). */
  readonly willPlayScriptedAudio: boolean;
  emitScriptLineStarted(info: ScriptLineStartedInfo): void;
  emitScriptComplete(info: { reason: ScriptEndReason }): void;
  log(msg: string): void;
}

interface NormalizedLine {
  text: string;
  textOnly: boolean;
}

const DEFAULT_LINE_TIMEOUT_MS = 30_000;

/**
 * Drives a sequence of `say_line` calls. Because the server interrupts any in-progress
 * response when it receives a `say_line`, lines must be paced one at a time — the player
 * sends a line, waits for it to complete, then sends the next.
 */
export class ScriptPlayer implements ScriptController {
  private readonly host: ScriptHost;
  private readonly lines: NormalizedLine[];
  private readonly lineGapMs: number;
  private readonly loop: boolean;
  private readonly lineTimeoutMs: number;

  private _index = -1;
  private _state: ScriptState = 'idle';

  private currentMessageId: string | null = null;
  private lineAcked = false;
  private readonly retiredIds = new Set<string>();
  private selfInterruptPending = false;
  private pauseRequested = false;
  // Number of stray bot_responses still expected from text-only lines that were superseded
  // (via next()/stop()) BEFORE they were acked. Their server messageId isn't known yet, so we
  // can't retire them by id — instead we swallow that many fresh responses by arrival order.
  private pendingStaleResponses = 0;

  private lineTimer: ReturnType<typeof setTimeout> | null = null;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;

  private resolveDone!: (info: { reason: ScriptEndReason }) => void;
  readonly done: Promise<{ reason: ScriptEndReason }>;

  private readonly onBotResponse = (r: BotResponse): void => this.handleBotResponse(r);
  private readonly onAudioComplete = (messageId: string): void =>
    this.handleAudioComplete(messageId);
  private readonly onInterrupt = (data: InterruptData): void => this.handleExternalInterrupt(data);
  private readonly onDisconnected = (): void => this.finish('disconnected');

  constructor(host: ScriptHost, lines: ScriptLine[], opts: ScriptOptions = {}) {
    this.host = host;
    const defaultTextOnly = opts.textOnly ?? false;
    this.lines = lines.map((line) =>
      typeof line === 'string'
        ? { text: line, textOnly: defaultTextOnly }
        : { text: line.text, textOnly: line.textOnly ?? defaultTextOnly },
    );
    this.lineGapMs = Math.max(0, opts.lineGapMs ?? 0);
    this.loop = opts.loop ?? false;
    this.lineTimeoutMs = opts.lineTimeoutMs ?? DEFAULT_LINE_TIMEOUT_MS;

    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });

    this.host.on('botResponse', this.onBotResponse);
    this.host.on('audioPlaybackComplete', this.onAudioComplete);
    this.host.on('interrupt', this.onInterrupt);
    this.host.on('disconnected', this.onDisconnected);

    if (opts.autoStart ?? true) {
      queueMicrotask(() => this.play());
    }
  }

  get length(): number {
    return this.lines.length;
  }

  get index(): number {
    return this._index;
  }

  get state(): ScriptState {
    return this._state;
  }

  play(): void {
    if (this._state === 'done' || this._state === 'playing') return;
    this.pauseRequested = false;
    this._state = 'playing';
    this.startNextLine();
  }

  resume(): void {
    this.play();
  }

  pause(): void {
    if (this._state === 'done') return;
    this.pauseRequested = true;
  }

  next(): void {
    if (this._state === 'done') return;
    if (this._state === 'idle') {
      this.play();
      return;
    }
    // When paused, the current line has already completed — advancing interrupts nothing.
    // When playing, advancing supersedes (and interrupts) the in-flight line.
    const expectInterrupt = this._state === 'playing';
    this.pauseRequested = false;
    this._state = 'playing';
    this.clearTimers();
    this.supersedeCurrentLine(expectInterrupt);
    this.startNextLine();
  }

  stop(): void {
    this.finish('stopped', true);
  }

  // ─── internals ────────────────────────────────────────────────

  private hasSpeakableLine(): boolean {
    return this.lines.some((l) => l.text.trim().length > 0);
  }

  private startNextLine(): void {
    if (this._state !== 'playing') return;
    if (!this.hasSpeakableLine()) {
      this.finish('finished');
      return;
    }

    let next = this._index + 1;
    // Advance to the next non-empty line, honoring loop. hasSpeakableLine() above
    // guarantees this terminates.
    for (;;) {
      if (next >= this.lines.length) {
        if (this.loop) {
          next = 0;
        } else {
          this.finish('finished');
          return;
        }
      }
      if (this.lines[next].text.trim()) break;
      next++;
    }

    this._index = next;
    this.currentMessageId = null;
    this.lineAcked = false;

    if (!this.host.isConnected) {
      this.finish('disconnected');
      return;
    }

    const line = this.lines[next];
    this.host.sayLine(line.text, line.textOnly);
    this.lineTimer = setTimeout(() => this.handleLineTimeout(), this.lineTimeoutMs);
  }

  private handleBotResponse(r: BotResponse): void {
    if (this._state === 'done' || this._index < 0) return;
    if (r.messageId && this.retiredIds.has(r.messageId)) return;
    if (r.isInterjection) return;

    if (!this.lineAcked) {
      // A line skipped before it was acked (next()/stop() in the window before its first
      // bot_response) still emits one stray text-only response. By ordered delivery it arrives
      // before the new line's response, so swallow it rather than mis-acking the new line.
      if (this.pendingStaleResponses > 0) {
        this.pendingStaleResponses--;
        if (r.messageId) this.retiredIds.add(r.messageId);
        return;
      }
      this.lineAcked = true;
      this.currentMessageId = r.messageId ?? null;
      this.selfInterruptPending = false; // the new line is now flowing
      this.host.emitScriptLineStarted({
        index: this._index,
        text: this.lines[this._index].text,
        messageId: r.messageId,
      });
    }

    if (this.currentMessageId && r.messageId && r.messageId !== this.currentMessageId) return;

    const line = this.lines[this._index];
    const completesOnResponse = line.textOnly || !this.host.willPlayScriptedAudio;
    if (completesOnResponse && r.isFinal) {
      this.onLineComplete();
    }
  }

  private handleAudioComplete(messageId: string): void {
    if (this._state === 'done' || this._index < 0) return;
    if (messageId && this.retiredIds.has(messageId)) return;
    const line = this.lines[this._index];
    if (line.textOnly || !this.host.willPlayScriptedAudio) return;
    if (this.currentMessageId && messageId && messageId !== this.currentMessageId) return;
    this.onLineComplete();
  }

  private handleLineTimeout(): void {
    if (this._state === 'done') return;
    this.host.log(`script line ${this._index} timed out after ${this.lineTimeoutMs}ms; advancing`);
    this.onLineComplete();
  }

  private onLineComplete(): void {
    this.clearTimers();
    if (this.lineGapMs > 0) {
      this.gapTimer = setTimeout(() => this.afterGap(), this.lineGapMs);
    } else {
      this.afterGap();
    }
  }

  private afterGap(): void {
    this.gapTimer = null;
    if (this._state === 'done') return;
    if (this.pauseRequested) {
      this._state = 'paused';
      return;
    }
    this.startNextLine();
  }

  private handleExternalInterrupt(data: InterruptData): void {
    if (this._state === 'done') return;
    if (data?.messageId && this.retiredIds.has(data.messageId)) return;
    if (this.selfInterruptPending) {
      this.selfInterruptPending = false;
      return;
    }
    this.finish('interrupted');
  }

  /**
   * Retire the current line because we're moving off it.
   * @param expectInterrupt true when the line is still in-flight (next()/stop() mid-line), so the
   *   server will emit a self-induced `interrupt` we must not treat as external. false when the
   *   line already completed (e.g. next() while paused), where no interrupt is coming.
   */
  private supersedeCurrentLine(expectInterrupt: boolean): void {
    if (this.lineAcked && this.currentMessageId) {
      // Known id — drop any further events for it.
      this.retiredIds.add(this.currentMessageId);
    } else if (expectInterrupt && this.lines[this._index]?.textOnly) {
      // Skipped before ack: a text-only line still sends one immediate bot_response whose id we
      // don't know yet. Expect to swallow it. (TTS lines interrupted before ack send no stray
      // response, so nothing to swallow there.)
      this.pendingStaleResponses++;
    }
    if (expectInterrupt) this.selfInterruptPending = true;
  }

  private clearTimers(): void {
    if (this.lineTimer) {
      clearTimeout(this.lineTimer);
      this.lineTimer = null;
    }
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }

  private finish(reason: ScriptEndReason, interrupt = false): void {
    if (this._state === 'done') return;
    this.clearTimers();
    if (interrupt) {
      this.selfInterruptPending = true;
      if (this.host.isConnected) this.host.interrupt();
    }
    this._state = 'done';
    this.host.off('botResponse', this.onBotResponse);
    this.host.off('audioPlaybackComplete', this.onAudioComplete);
    this.host.off('interrupt', this.onInterrupt);
    this.host.off('disconnected', this.onDisconnected);
    this.host.emitScriptComplete({ reason });
    this.resolveDone({ reason });
  }
}
