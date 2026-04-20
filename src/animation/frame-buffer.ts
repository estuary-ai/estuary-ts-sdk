import type { BotAnimation } from '../types';

// ─── Public Interfaces ─────────────────────────────────────────────────────

/**
 * Return value of `AnimationFrameBuffer.pairAt`.
 *
 * - `prev`: the last frame whose `timeCodeSec` is ≤ the query time, or `null`
 *   if the query is before the first buffered frame.
 * - `next`: the first frame whose `timeCodeSec` is strictly > the query time,
 *   or `null` if the query is at or past the last buffered frame.
 * - `alpha`: interpolation weight ∈ [0, 1].
 *   - 0 → use `prev` fully (query exactly at `prev.timeCodeSec`).
 *   - 1 → use `next` fully (query is past `prev` with no `next`).
 *   - Intermediate values when both `prev` and `next` are present.
 */
export interface FramePair {
  prev: BotAnimation | null;
  next: BotAnimation | null;
  /** Interpolation weight in [0, 1]. */
  alpha: number;
}

/**
 * Constructor options for `AnimationFrameBuffer`.
 */
export interface AnimationFrameBufferOptions {
  /**
   * GC window in seconds.
   * Frames whose `timeCodeSec` is strictly less than `(cursor - gcWindowSec)`
   * are removed by `gc(cursor)`.
   * Default: 0.5 s (≈15 frames at 30 fps).
   */
  gcWindowSec?: number;
}

// ─── AnimationFrameBuffer ──────────────────────────────────────────────────

/**
 * A sorted, GC-aware buffer of `BotAnimation` frames for audio-sync lookup.
 *
 * **Insertion** — O(log n) binary search to find position + O(n) `Array.splice`.
 * At 30 fps × 0.5 s GC window the buffer stays ≤ ~16 frames, well within
 * any render budget.
 *
 * **Lookup** — `pairAt(t)` returns the flanking pair of frames (prev, next)
 * and an interpolation weight alpha ∈ [0, 1].
 *
 * **GC** — Call `gc(tAudioSec)` on each clock tick (the hook does this) to
 * drop frames that have fallen behind the playback cursor.
 *
 * **Terminator frames** are never buffered: frames where `isFinal === true`
 * or `sequence === -1` are silently ignored on `insert`.
 */
export class AnimationFrameBuffer {
  private readonly gcWindowSec: number;
  private frames: BotAnimation[];
  private _last: BotAnimation | null;

  constructor(options: AnimationFrameBufferOptions = {}) {
    this.gcWindowSec = options.gcWindowSec ?? 0.5;
    this.frames = [];
    this._last = null;
  }

  // ─── Public Accessors ──────────────────────────────────────────────────

  /** Number of frames currently held in the buffer. */
  get length(): number {
    return this.frames.length;
  }

  /**
   * The most recently inserted non-terminator frame.
   * Useful for observability / health checks.
   * Not used internally for time-indexed lookup.
   */
  get last(): BotAnimation | null {
    return this._last;
  }

  // ─── Mutation Methods ──────────────────────────────────────────────────

  /**
   * Insert a frame into the buffer, maintaining ascending `timeCodeSec` order.
   *
   * Terminator frames (`isFinal === true` or `sequence === -1`) are silently
   * rejected — they carry no blendshape data and must never enter the time
   * index.
   *
   * Time complexity: O(log n) for binary search + O(n) for splice.
   */
  insert(frame: BotAnimation): void {
    // Terminator filter — must be the very first check
    if (frame.isFinal || frame.sequence === -1) return;

    // Binary-search insertion point by timeCodeSec (ascending).
    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.frames[mid].timeCodeSec < frame.timeCodeSec) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.frames.splice(lo, 0, frame);
    this._last = frame;
  }

  /**
   * Look up the flanking pair of frames at audio time `tAudioSec`.
   *
   * Returns `{prev, next, alpha}`:
   * - `prev` is the latest frame with `timeCodeSec ≤ tAudioSec`.
   * - `next` is the earliest frame with `timeCodeSec > tAudioSec`.
   * - `alpha` is clamped to [0, 1]; no extrapolation past the last frame.
   *
   * Special cases:
   * - Empty buffer → `{prev: null, next: null, alpha: 0}`.
   * - Before first frame → `{prev: null, next: first, alpha: 0}`.
   * - After last frame → `{prev: last, next: null, alpha: 1}`.
   * - Exact match → `alpha = 0` (use `prev` fully).
   * - Two frames at same `timeCodeSec` → `alpha = 0` (avoids divide-by-zero).
   *
   * Time complexity: O(log n).
   */
  pairAt(tAudioSec: number): FramePair {
    if (this.frames.length === 0) {
      return { prev: null, next: null, alpha: 0 };
    }

    // Binary search for first frame with timeCodeSec > tAudioSec.
    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.frames[mid].timeCodeSec <= tAudioSec) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const nextIdx = lo;
    const prevIdx = lo - 1;
    const prev: BotAnimation | null = prevIdx >= 0 ? this.frames[prevIdx] : null;
    const next: BotAnimation | null = nextIdx < this.frames.length ? this.frames[nextIdx] : null;

    if (!prev) {
      // Query is before the first frame — no interpolation possible yet.
      return { prev: null, next, alpha: 0 };
    }
    if (!next) {
      // Query is at or past the last frame — clamp to 1 (hold last pose).
      return { prev, next: null, alpha: 1 };
    }

    const span = next.timeCodeSec - prev.timeCodeSec;
    const rawAlpha = span > 0 ? (tAudioSec - prev.timeCodeSec) / span : 0;
    const alpha = Math.min(1, Math.max(0, rawAlpha));
    return { prev, next, alpha };
  }

  /**
   * Drop frames that have fallen behind the audio cursor.
   *
   * Removes all frames whose `timeCodeSec` is strictly less than
   * `(tAudioSec - gcWindowSec)`. Frames at exactly the threshold are retained.
   *
   * Should be called once per render tick (the hook is responsible for timing).
   *
   * Time complexity: O(k + n) where k is the number of dropped frames.
   */
  gc(tAudioSec: number): void {
    const threshold = tAudioSec - this.gcWindowSec;
    let i = 0;
    while (i < this.frames.length && this.frames[i].timeCodeSec < threshold) {
      i++;
    }
    if (i > 0) {
      this.frames.splice(0, i);
    }
  }

  /**
   * Empty the buffer completely.
   *
   * Use this when a new utterance starts or an interrupt arrives — clears all
   * buffered frames and resets the `last` accessor to `null`.
   */
  clear(): void {
    this.frames = [];
    this._last = null;
  }
}
