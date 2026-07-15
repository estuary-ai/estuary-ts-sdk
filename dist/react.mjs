import { useRef, useState, useEffect } from 'react';

// src/react/use-animation-stream.ts

// src/animation/frame-buffer.ts
var AnimationFrameBuffer = class {
  gcWindowSec;
  frames;
  _last;
  constructor(options = {}) {
    this.gcWindowSec = options.gcWindowSec ?? 0.5;
    this.frames = [];
    this._last = null;
  }
  // ─── Public Accessors ──────────────────────────────────────────────────
  /** Number of frames currently held in the buffer. */
  get length() {
    return this.frames.length;
  }
  /**
   * The most recently inserted non-terminator frame.
   * Useful for observability / health checks.
   * Not used internally for time-indexed lookup.
   */
  get last() {
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
  insert(frame) {
    if (frame.isFinal || frame.sequence === -1) return;
    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
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
  pairAt(tAudioSec) {
    if (this.frames.length === 0) {
      return { prev: null, next: null, alpha: 0 };
    }
    let lo = 0;
    let hi = this.frames.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (this.frames[mid].timeCodeSec <= tAudioSec) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const nextIdx = lo;
    const prevIdx = lo - 1;
    const prev = prevIdx >= 0 ? this.frames[prevIdx] : null;
    const next = nextIdx < this.frames.length ? this.frames[nextIdx] : null;
    if (!prev) {
      return { prev: null, next, alpha: 0 };
    }
    if (!next) {
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
  gc(tAudioSec) {
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
  clear() {
    this.frames = [];
    this._last = null;
  }
};

// src/react/use-animation-stream.ts
function useAnimationStream(options) {
  const {
    client,
    getClock,
    gcWindowSec = 0.5,
    gcIntervalMs = 100,
    stallTimeoutMs = 500
  } = options;
  const bufferRef = useRef(
    new AnimationFrameBuffer({ gcWindowSec })
  );
  const lastFrameAtRef = useRef(0);
  const [currentMessageId, setCurrentMessageId] = useState(null);
  const [framesReceived, setFramesReceived] = useState(0);
  const [healthStatus, setHealthStatus] = useState("idle");
  useEffect(() => {
    let lastInsertedMessageId = null;
    const handleAnimation = (frame) => {
      if (frame.isFinal || frame.sequence === -1) return;
      if (lastInsertedMessageId !== null && lastInsertedMessageId !== frame.messageId) {
        bufferRef.current.clear();
      }
      lastInsertedMessageId = frame.messageId;
      bufferRef.current.insert(frame);
      lastFrameAtRef.current = Date.now();
      setFramesReceived((n) => n + 1);
      setCurrentMessageId(
        (prev) => prev === frame.messageId ? prev : frame.messageId
      );
      setHealthStatus("receiving");
    };
    const handleInterrupt = (_data) => {
      bufferRef.current.clear();
      lastFrameAtRef.current = 0;
      setCurrentMessageId(null);
      setHealthStatus("idle");
    };
    client.on("botAnimation", handleAnimation);
    client.on("interrupt", handleInterrupt);
    return () => {
      client.off("botAnimation", handleAnimation);
      client.off("interrupt", handleInterrupt);
    };
  }, [client]);
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const t = getClock();
        if (Number.isFinite(t)) {
          bufferRef.current.gc(t);
        }
      } catch {
      }
      if (lastFrameAtRef.current > 0) {
        const elapsed = Date.now() - lastFrameAtRef.current;
        setHealthStatus((prev) => {
          if (prev === "idle") return prev;
          return elapsed > stallTimeoutMs ? "stalled" : "receiving";
        });
      }
    }, gcIntervalMs);
    return () => clearInterval(id);
  }, [getClock, gcIntervalMs, stallTimeoutMs]);
  return {
    bufferRef,
    currentMessageId,
    framesReceived,
    healthStatus
  };
}

export { useAnimationStream };
//# sourceMappingURL=react.mjs.map
//# sourceMappingURL=react.mjs.map