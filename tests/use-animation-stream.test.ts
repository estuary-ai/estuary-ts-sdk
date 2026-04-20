/**
 * @vitest-environment jsdom
 *
 * Tests for `useAnimationStream` — the React hook that subscribes to
 * `bot_animation` events and buffers frames for audio-clock-anchored
 * interpolation lookup.
 *
 * All tests use a minimal fake EstuaryClient backed by TypedEventEmitter.
 * This avoids pulling in socket.io-client and audio APIs, and exercises
 * exactly the surface the hook uses: `client.on`, `client.off`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { useAnimationStream } from '../src/react/use-animation-stream';
import { TypedEventEmitter } from '../src/utils/event-emitter';
import type { EstuaryClient } from '../src/client';
import type { BotAnimation, InterruptData, EstuaryEventMap } from '../src/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal fake EstuaryClient — only the event emitter surface is needed. */
function makeFakeClient(): EstuaryClient {
  const emitter = new TypedEventEmitter<EstuaryEventMap>();
  // Expose emit publicly so tests can trigger events
  (emitter as unknown as { _emit: typeof emitter['emit'] })._emit =
    emitter['emit'].bind(emitter);
  return emitter as unknown as EstuaryClient;
}

function emitBotAnimation(client: EstuaryClient, frame: BotAnimation): void {
  (client as unknown as TypedEventEmitter<EstuaryEventMap>)['emit'](
    'botAnimation',
    frame,
  );
}

function emitInterrupt(client: EstuaryClient, data: InterruptData): void {
  (client as unknown as TypedEventEmitter<EstuaryEventMap>)['emit'](
    'interrupt',
    data,
  );
}

/** Build a non-terminator animation frame. */
function makeFrame(
  overrides: Partial<BotAnimation> & { messageId?: string } = {},
): BotAnimation {
  return {
    messageId: overrides.messageId ?? 'msg-1',
    sequence: overrides.sequence ?? 0,
    timeCodeSec: overrides.timeCodeSec ?? 0.0,
    fps: 30,
    weights: { jawOpen: 0.5, ...overrides.weights },
    emitEpochMs: Date.now(),
    isFinal: overrides.isFinal ?? false,
  };
}

/** Build a terminator frame (isFinal=true). */
function makeTerminator(messageId = 'msg-1'): BotAnimation {
  return makeFrame({ messageId, isFinal: true, sequence: -1 });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('subscribe/unsubscribe lifecycle', () => {
  let client: EstuaryClient & TypedEventEmitter<EstuaryEventMap>;

  beforeEach(() => {
    client = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
  });

  it('subscribes to botAnimation and interrupt on mount', () => {
    const getClock = () => 0;
    renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    expect(client.listenerCount('botAnimation')).toBe(1);
    expect(client.listenerCount('interrupt')).toBe(1);
  });

  it('unsubscribes on unmount', () => {
    const getClock = () => 0;
    const { unmount } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    unmount();

    expect(client.listenerCount('botAnimation')).toBe(0);
    expect(client.listenerCount('interrupt')).toBe(0);
  });

  it('handles StrictMode double-mount-unmount cleanly (idempotent listener count)', () => {
    const getClock = () => 0;
    renderHook(
      () => useAnimationStream({ client, getClock }),
      { wrapper: StrictMode },
    );

    // After StrictMode double-mount, should still have exactly 1 listener each
    expect(client.listenerCount('botAnimation')).toBe(1);
    expect(client.listenerCount('interrupt')).toBe(1);
  });
});

describe('frame ingestion', () => {
  let client: EstuaryClient & TypedEventEmitter<EstuaryEventMap>;

  beforeEach(() => {
    client = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
  });

  it('inserts non-terminator frames into the buffer', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      emitBotAnimation(client, makeFrame({ sequence: 0, timeCodeSec: 0.1 }));
    });

    expect(result.current.bufferRef.current.length).toBe(1);
    expect(result.current.framesReceived).toBe(1);
  });

  it('filters terminator frames (isFinal=true, sequence=-1)', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      emitBotAnimation(client, makeTerminator('msg-1'));
    });

    expect(result.current.bufferRef.current.length).toBe(0);
    expect(result.current.framesReceived).toBe(0);
  });

  it('updates currentMessageId on first frame', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    expect(result.current.currentMessageId).toBeNull();

    await act(async () => {
      emitBotAnimation(client, makeFrame({ messageId: 'msg-1', sequence: 0 }));
    });

    expect(result.current.currentMessageId).toBe('msg-1');
  });

  it('does not re-render on every frame (bufferRef is stable, state updates batched)', async () => {
    const getClock = () => 0;
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useAnimationStream({ client, getClock });
    });

    const initialRenderCount = renderCount;

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        emitBotAnimation(
          client,
          makeFrame({ sequence: i, timeCodeSec: i * 0.033 }),
        );
      }
    });

    // Buffer should have all 10 frames
    expect(result.current.bufferRef.current.length).toBe(10);
    // Re-renders should be minimal — React batches state updates in act()
    // Allow some re-renders for state (framesReceived, currentMessageId, healthStatus)
    // but should NOT be 10+ (one per frame)
    expect(renderCount - initialRenderCount).toBeLessThan(10);
  });
});

describe('interrupt handling', () => {
  let client: EstuaryClient & TypedEventEmitter<EstuaryEventMap>;

  beforeEach(() => {
    client = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
  });

  it('clears buffer on interrupt event with matching messageId', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      for (let i = 0; i < 3; i++) {
        emitBotAnimation(
          client,
          makeFrame({ messageId: 'msg-A', sequence: i, timeCodeSec: i * 0.033 }),
        );
      }
    });
    expect(result.current.bufferRef.current.length).toBe(3);

    await act(async () => {
      emitInterrupt(client, { messageId: 'msg-A' });
    });

    expect(result.current.bufferRef.current.length).toBe(0);
  });

  it('clears buffer on interrupt event with no messageId (defense-in-depth)', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      for (let i = 0; i < 3; i++) {
        emitBotAnimation(
          client,
          makeFrame({ sequence: i, timeCodeSec: i * 0.033 }),
        );
      }
    });
    expect(result.current.bufferRef.current.length).toBe(3);

    await act(async () => {
      emitInterrupt(client, {});
    });

    expect(result.current.bufferRef.current.length).toBe(0);
  });

  it('sets currentMessageId to null after interrupt', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      emitBotAnimation(client, makeFrame({ messageId: 'msg-1', sequence: 0 }));
    });
    expect(result.current.currentMessageId).toBe('msg-1');

    await act(async () => {
      emitInterrupt(client, { messageId: 'msg-1' });
    });

    expect(result.current.currentMessageId).toBeNull();
  });

  it('framesReceived persists across interrupt (liveness counter, not buffer count)', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      for (let i = 0; i < 3; i++) {
        emitBotAnimation(
          client,
          makeFrame({ sequence: i, timeCodeSec: i * 0.033 }),
        );
      }
    });

    await act(async () => {
      emitInterrupt(client, {});
    });

    await act(async () => {
      for (let i = 0; i < 2; i++) {
        emitBotAnimation(
          client,
          makeFrame({ messageId: 'msg-2', sequence: i, timeCodeSec: i * 0.033 }),
        );
      }
    });

    expect(result.current.framesReceived).toBe(5);
  });
});

describe('getClock pluggability', () => {
  let client: EstuaryClient & TypedEventEmitter<EstuaryEventMap>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls getClock during gc ticks', async () => {
    const getClock = vi.fn(() => 0);
    const gcIntervalMs = 100;

    renderHook(() =>
      useAnimationStream({ client, getClock, gcIntervalMs }),
    );

    await act(async () => {
      vi.advanceTimersByTime(gcIntervalMs * 5);
    });

    expect(getClock).toHaveBeenCalledTimes(5);
  });

  it('allows two independent hook instances with different getClock', async () => {
    const client2 = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
    const clock1 = vi.fn(() => 1.0);
    const clock2 = vi.fn(() => 2.0);

    const { result: result1 } = renderHook(() =>
      useAnimationStream({ client, getClock: clock1 }),
    );
    const { result: result2 } = renderHook(() =>
      useAnimationStream({ client: client2, getClock: clock2 }),
    );

    await act(async () => {
      emitBotAnimation(
        client,
        makeFrame({ messageId: 'msg-A', sequence: 0 }),
      );
      emitBotAnimation(
        client2,
        makeFrame({ messageId: 'msg-B', sequence: 0 }),
      );
    });

    expect(result1.current.currentMessageId).toBe('msg-A');
    expect(result2.current.currentMessageId).toBe('msg-B');
    expect(result1.current.framesReceived).toBe(1);
    expect(result2.current.framesReceived).toBe(1);
  });

  it('uses getClock value in buffer.gc — frames outside window are removed', async () => {
    // gcWindowSec=0.5 means frames with timeCodeSec < (t - 0.5) are dropped
    // getClock returns 5.0, so threshold = 5.0 - 0.5 = 4.5
    // Frames at t=[0, 1, 2, 6] → only t=6 survives
    let clockValue = 0;
    const getClock = () => clockValue;
    const gcIntervalMs = 100;
    const gcWindowSec = 0.5;

    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock, gcIntervalMs, gcWindowSec }),
    );

    await act(async () => {
      for (const t of [0, 1, 2, 6]) {
        emitBotAnimation(
          client,
          makeFrame({ sequence: t * 10, timeCodeSec: t }),
        );
      }
    });
    expect(result.current.bufferRef.current.length).toBe(4);

    // Advance clock to 5.0 — gc threshold becomes 4.5
    clockValue = 5.0;

    await act(async () => {
      vi.advanceTimersByTime(gcIntervalMs);
    });

    // Only the frame at t=6 should remain
    expect(result.current.bufferRef.current.length).toBe(1);
    expect(result.current.bufferRef.current.last?.timeCodeSec).toBe(6);
  });
});

describe('healthStatus state machine', () => {
  let client: EstuaryClient & TypedEventEmitter<EstuaryEventMap>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle', () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    expect(result.current.healthStatus).toBe('idle');
  });

  it('flips to receiving on first frame', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      emitBotAnimation(client, makeFrame({ sequence: 0 }));
    });

    expect(result.current.healthStatus).toBe('receiving');
  });

  it('flips to stalled after stallTimeoutMs without new frames', async () => {
    const getClock = () => 0;
    const stallTimeoutMs = 500;
    const gcIntervalMs = 100;

    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock, stallTimeoutMs, gcIntervalMs }),
    );

    await act(async () => {
      emitBotAnimation(client, makeFrame({ sequence: 0 }));
    });
    expect(result.current.healthStatus).toBe('receiving');

    await act(async () => {
      vi.advanceTimersByTime(stallTimeoutMs + gcIntervalMs);
    });

    expect(result.current.healthStatus).toBe('stalled');
  });

  it('flips back to receiving on next frame after stalled', async () => {
    const getClock = () => 0;
    const stallTimeoutMs = 500;
    const gcIntervalMs = 100;

    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock, stallTimeoutMs, gcIntervalMs }),
    );

    await act(async () => {
      emitBotAnimation(client, makeFrame({ sequence: 0, timeCodeSec: 0 }));
    });

    await act(async () => {
      vi.advanceTimersByTime(stallTimeoutMs + gcIntervalMs);
    });
    expect(result.current.healthStatus).toBe('stalled');

    await act(async () => {
      emitBotAnimation(client, makeFrame({ sequence: 1, timeCodeSec: 1 }));
    });

    expect(result.current.healthStatus).toBe('receiving');
  });

  it('flips to idle on interrupt', async () => {
    const getClock = () => 0;
    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock }),
    );

    await act(async () => {
      emitBotAnimation(client, makeFrame({ sequence: 0 }));
    });
    expect(result.current.healthStatus).toBe('receiving');

    await act(async () => {
      emitInterrupt(client, {});
    });

    expect(result.current.healthStatus).toBe('idle');
  });
});

describe('options', () => {
  let client: EstuaryClient & TypedEventEmitter<EstuaryEventMap>;

  beforeEach(() => {
    vi.useFakeTimers();
    client = makeFakeClient() as EstuaryClient & TypedEventEmitter<EstuaryEventMap>;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes gcWindowSec to the internal buffer — tighter window drops more frames', async () => {
    // gcWindowSec=0.2 vs default 0.5 — tighter window means more frames dropped
    // Clock at t=1.0 with gcWindowSec=0.2 → threshold = 0.8
    // Frames at t=[0, 0.5, 0.7, 0.9, 1.1] → only 0.9 and 1.1 survive (≥ 0.8)
    let clockValue = 0;
    const getClock = () => clockValue;
    const gcIntervalMs = 100;
    const gcWindowSec = 0.2;

    const { result } = renderHook(() =>
      useAnimationStream({ client, getClock, gcIntervalMs, gcWindowSec }),
    );

    await act(async () => {
      for (const t of [0, 0.5, 0.7, 0.9, 1.1]) {
        emitBotAnimation(
          client,
          makeFrame({ sequence: Math.round(t * 100), timeCodeSec: t }),
        );
      }
    });
    expect(result.current.bufferRef.current.length).toBe(5);

    // Advance clock to 1.0 — threshold = 0.8; frames at 0, 0.5, 0.7 drop
    clockValue = 1.0;
    await act(async () => {
      vi.advanceTimersByTime(gcIntervalMs);
    });

    // Expect frames at t=0.9 and t=1.1 to remain (both >= 0.8)
    expect(result.current.bufferRef.current.length).toBe(2);
  });
});
