import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { EstuaryClient } from '../client';
import { AnimationFrameBuffer } from '../animation/frame-buffer';
import type { BotAnimation, InterruptData } from '../types';

// ─── Public Types ──────────────────────────────────────────────────────────────

/**
 * Liveness indicator for the animation stream.
 *
 * - `'idle'`      — no frames received yet, or buffer was cleared by an interrupt
 * - `'receiving'` — a frame arrived within the last `stallTimeoutMs` milliseconds
 * - `'stalled'`   — the hook has a `currentMessageId` but no frame has arrived for
 *                   longer than `stallTimeoutMs` (network hiccup / worker backlog)
 *
 * Consumers can use this to show a degraded-state UI indicator.
 */
export type AnimationHealthStatus = 'idle' | 'receiving' | 'stalled';

/**
 * Options for `useAnimationStream`.
 */
export interface UseAnimationStreamOptions {
  /** Connected EstuaryClient to subscribe to. */
  client: EstuaryClient;

  /**
   * Returns the current audio playback position in seconds (utterance-relative).
   *
   * **For LiveKit transport (HTMLAudioElement):**
   * `HTMLAudioElement.currentTime` resets to 0 on each new track, so it is already
   * utterance-relative. Pass `() => audioElement.currentTime`.
   *
   * **For WebSocket transport (AudioContext / Web Audio API):**
   * `AudioContext.currentTime` is an ABSOLUTE monotonic clock — it does NOT reset
   * between utterances. Subtract the time you captured when audio started playing:
   * ```ts
   * let utteranceStart = 0;
   * client.on('audioPlaybackStarted', () => {
   *   utteranceStart = audioCtx.currentTime;
   * });
   * const getClock = () => audioCtx.currentTime - utteranceStart;
   * ```
   *
   * The hook never reads `getClock` during event handling — it is only called
   * inside the GC interval tick. A throwing clock (e.g., `AudioContext` not yet
   * resumed on Safari) is caught and silently skipped for that tick.
   */
  getClock: () => number;

  /**
   * GC window passed to `AnimationFrameBuffer`.
   * Frames whose `timeCodeSec` falls more than `gcWindowSec` behind the current
   * clock reading are discarded on each GC tick.
   * Default: `0.5` seconds (≈ 15 frames at 30 fps).
   */
  gcWindowSec?: number;

  /**
   * Interval between GC ticks in milliseconds.
   * Default: `100` ms (10 Hz — sufficient for the dev harness requirement).
   */
  gcIntervalMs?: number;

  /**
   * Milliseconds without a frame before `healthStatus` flips to `'stalled'`.
   * Default: `500` ms.
   */
  stallTimeoutMs?: number;
}

/**
 * Return value of `useAnimationStream`.
 */
export interface UseAnimationStreamReturn {
  /**
   * Stable ref to the internal `AnimationFrameBuffer`.
   *
   * Call `bufferRef.current.pairAt(getClock())` inside a `requestAnimationFrame`
   * loop to obtain the interpolation pair for the current playback position.
   * Reading the ref does NOT trigger React re-renders — that is the whole point.
   */
  bufferRef: MutableRefObject<AnimationFrameBuffer>;

  /**
   * The `messageId` of the most recently received (non-terminator) frame.
   * `null` before the first frame arrives or after an interrupt clears state.
   */
  currentMessageId: string | null;

  /**
   * Cumulative count of non-terminator frames inserted since mount.
   * Does NOT reset on interrupt — use as a liveness counter.
   */
  framesReceived: number;

  /**
   * Liveness indicator — see `AnimationHealthStatus` for the full state machine.
   */
  healthStatus: AnimationHealthStatus;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to `bot_animation` events and buffer frames for lipsync interpolation.
 *
 * The hook is deliberately re-render-minimal: the `AnimationFrameBuffer` lives in
 * a `useRef` and does NOT trigger re-renders on frame insertion. Only
 * `currentMessageId`, `framesReceived`, and `healthStatus` are React state — and
 * they change infrequently compared to the 30 fps frame rate.
 *
 * **NOTE: A2F gate** — Frames only arrive when the gateway session was created
 * with `audioSampleRate: 16000` AND the server has `ENABLE_A2F=true`. Without
 * both, the worker A2F pipeline is bypassed and no `bot_animation` events are
 * emitted. Set `enableAnimation: true` in `EstuaryConfig` to propagate the
 * `enable_animation` flag to the gateway.
 *
 * @example
 * ```tsx
 * // getClock for WebSocket transport (AudioContext):
 * const getClock = () => audioCtx.currentTime - utteranceStartRef.current;
 *
 * // getClock for LiveKit transport (HTMLAudioElement):
 * const getClock = () => audioElement.currentTime;
 *
 * const { bufferRef, currentMessageId, framesReceived, healthStatus } =
 *   useAnimationStream({ client, getClock });
 * ```
 */
export function useAnimationStream(
  options: UseAnimationStreamOptions,
): UseAnimationStreamReturn {
  const {
    client,
    getClock,
    gcWindowSec = 0.5,
    gcIntervalMs = 100,
    stallTimeoutMs = 500,
  } = options;

  // Stable ref to the buffer — never triggers re-renders on frame insertion
  const bufferRef = useRef<AnimationFrameBuffer>(
    new AnimationFrameBuffer({ gcWindowSec }),
  );

  // Timestamp (ms) of the most recently inserted frame.
  // Using Date.now() so vitest fake timers (which mock Date.now) can advance
  // this in tests. Date.now() is NOT mocked by vi.useFakeTimers().
  const lastFrameAtRef = useRef<number>(0);

  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [framesReceived, setFramesReceived] = useState(0);
  const [healthStatus, setHealthStatus] = useState<AnimationHealthStatus>('idle');

  // ─── Event subscription ──────────────────────────────────────────────────
  // Depends only on `client` — listener re-registration happens only when the
  // client instance changes, not on every `getClock` / options change.
  //
  // StrictMode safety: each effect call creates a fresh `handleAnimation` and
  // `handleInterrupt` function; the cleanup removes exactly that instance, so
  // double-mount produces exactly one active listener per event.
  useEffect(() => {
    // Tracks the most recently inserted frame's messageId so we can detect
    // message-boundary transitions WITHOUT waiting for the React state update
    // (which lands one render tick later — too slow to keep stale frames out).
    let lastInsertedMessageId: string | null = null;

    const handleAnimation = (frame: BotAnimation): void => {
      // Terminator frames carry no blendshape data — silently discard.
      // (AnimationFrameBuffer.insert also guards, but filtering here avoids
      //  touching React state for terminators.)
      if (frame.isFinal || frame.sequence === -1) return;

      // Clear buffer on message-id transition. Each utterance re-bases
      // timeCodeSec to 0, so old-utterance frames mixed with new-utterance
      // frames produce a sorted buffer where two messages' 0.025s frames
      // interleave — pairAt() then returns nonsense pairs or forces the
      // interpolation to bridge across utterance boundaries. Flushing
      // guarantees the buffer contains only the current utterance's frames.
      // Interrupts still go through handleInterrupt below (defense-in-depth).
      if (lastInsertedMessageId !== null && lastInsertedMessageId !== frame.messageId) {
        bufferRef.current.clear();
      }
      lastInsertedMessageId = frame.messageId;

      bufferRef.current.insert(frame);
      lastFrameAtRef.current = Date.now();

      // Functional-update pattern is StrictMode-safe and avoids stale closures
      setFramesReceived((n) => n + 1);
      setCurrentMessageId((prev) =>
        prev === frame.messageId ? prev : frame.messageId,
      );
      setHealthStatus('receiving');
    };

    const handleInterrupt = (_data: InterruptData): void => {
      // Always clear on interrupt regardless of messageId — defense-in-depth.
      bufferRef.current.clear();
      lastFrameAtRef.current = 0;
      setCurrentMessageId(null);
      setHealthStatus('idle');
      // framesReceived is intentionally NOT reset — it is a cumulative liveness counter
    };

    client.on('botAnimation', handleAnimation);
    client.on('interrupt', handleInterrupt);

    return () => {
      client.off('botAnimation', handleAnimation);
      client.off('interrupt', handleInterrupt);
    };
  }, [client]);

  // ─── GC tick + stall detection ───────────────────────────────────────────
  // Re-registers when getClock, gcIntervalMs, or stallTimeoutMs change.
  // Wrapping getClock() in try/catch so a throwing clock (e.g., AudioContext
  // not resumed on Safari) does not crash the hook.
  useEffect(() => {
    const id = setInterval(() => {
      // GC
      try {
        const t = getClock();
        if (Number.isFinite(t)) {
          bufferRef.current.gc(t);
        }
      } catch {
        // getClock threw — skip this GC tick silently
      }

      // Stall detection — only meaningful after at least one frame has arrived
      if (lastFrameAtRef.current > 0) {
        const elapsed = Date.now() - lastFrameAtRef.current;
        setHealthStatus((prev) => {
          if (prev === 'idle') return prev; // never flip idle → stalled without frames
          return elapsed > stallTimeoutMs ? 'stalled' : 'receiving';
        });
      }
    }, gcIntervalMs);

    return () => clearInterval(id);
  }, [getClock, gcIntervalMs, stallTimeoutMs]);

  return {
    bufferRef,
    currentMessageId,
    framesReceived,
    healthStatus,
  };
}
