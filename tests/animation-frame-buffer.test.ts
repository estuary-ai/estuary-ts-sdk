import { describe, it, expect } from 'vitest';
import { AnimationFrameBuffer } from '../src/animation/frame-buffer';
import type { FramePair } from '../src/animation/frame-buffer';
import type { BotAnimation } from '../src/types';

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function makeFrame(
  timeCodeSec: number,
  sequence = Math.round(timeCodeSec * 30),
  isFinal = false,
): BotAnimation {
  return {
    messageId: 'test-msg',
    sequence,
    timeCodeSec,
    fps: 30,
    weights: { jawOpen: 0.5 },
    emitEpochMs: 1000000000000,
    isFinal,
  };
}

// ---------------------------------------------------------------------------
// describe('insert')
// ---------------------------------------------------------------------------

describe('insert', () => {
  it('inserts a single frame', () => {
    const buf = new AnimationFrameBuffer();
    const frame = makeFrame(1.0);
    buf.insert(frame);
    expect(buf.length).toBe(1);
    expect(buf.last).toEqual(frame);
  });

  it('maintains sorted order on in-order inserts', () => {
    const buf = new AnimationFrameBuffer();
    const f0 = makeFrame(0.0);
    const f1 = makeFrame(1.0);
    const f2 = makeFrame(2.0);
    buf.insert(f0);
    buf.insert(f1);
    buf.insert(f2);
    expect(buf.length).toBe(3);
    // Verify ascending order via pairAt probes
    const p05 = buf.pairAt(0.5);
    expect(p05.prev?.timeCodeSec).toBe(0.0);
    expect(p05.next?.timeCodeSec).toBe(1.0);
    const p15 = buf.pairAt(1.5);
    expect(p15.prev?.timeCodeSec).toBe(1.0);
    expect(p15.next?.timeCodeSec).toBe(2.0);
  });

  it('maintains sorted order on out-of-order inserts', () => {
    const buf = new AnimationFrameBuffer();
    // Insert in order: 1.0, 0.2, 0.7 — internal must be [0.2, 0.7, 1.0]
    buf.insert(makeFrame(1.0));
    buf.insert(makeFrame(0.2));
    buf.insert(makeFrame(0.7));
    expect(buf.length).toBe(3);
    // Probe to verify internal order
    const pBefore02 = buf.pairAt(0.1);
    expect(pBefore02.prev).toBeNull();
    expect(pBefore02.next?.timeCodeSec).toBe(0.2);

    const pBetween02and07 = buf.pairAt(0.5);
    expect(pBetween02and07.prev?.timeCodeSec).toBe(0.2);
    expect(pBetween02and07.next?.timeCodeSec).toBe(0.7);

    const pBetween07and10 = buf.pairAt(0.9);
    expect(pBetween07and10.prev?.timeCodeSec).toBe(0.7);
    expect(pBetween07and10.next?.timeCodeSec).toBe(1.0);
  });

  it('rejects terminator frames (isFinal=true, sequence=-1)', () => {
    const buf = new AnimationFrameBuffer();
    const terminator: BotAnimation = {
      messageId: 'test-msg',
      sequence: -1,
      timeCodeSec: 5.0,
      fps: 30,
      weights: {},
      emitEpochMs: 1000000000000,
      isFinal: true,
    };
    buf.insert(terminator);
    expect(buf.length).toBe(0);
    expect(buf.last).toBeNull();
  });

  it('rejects frames with isFinal=true regardless of sequence', () => {
    const buf = new AnimationFrameBuffer();
    // isFinal=true but sequence is not -1
    const badFrame: BotAnimation = {
      messageId: 'test-msg',
      sequence: 5,
      timeCodeSec: 0.5,
      fps: 30,
      weights: { jawOpen: 0.1 },
      emitEpochMs: 1000000000000,
      isFinal: true,
    };
    buf.insert(badFrame);
    expect(buf.length).toBe(0);
    expect(buf.last).toBeNull();
  });

  it('rejects frames with sequence=-1 regardless of isFinal', () => {
    const buf = new AnimationFrameBuffer();
    // sequence=-1 but isFinal=false (defensive guard)
    const badSeqFrame: BotAnimation = {
      messageId: 'test-msg',
      sequence: -1,
      timeCodeSec: 0.5,
      fps: 30,
      weights: { jawOpen: 0.1 },
      emitEpochMs: 1000000000000,
      isFinal: false,
    };
    buf.insert(badSeqFrame);
    expect(buf.length).toBe(0);
    expect(buf.last).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// describe('pairAt')
// ---------------------------------------------------------------------------

describe('pairAt', () => {
  it('returns both-null with alpha=0 on empty buffer', () => {
    const buf = new AnimationFrameBuffer();
    const result: FramePair = buf.pairAt(1.0);
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
    expect(result.alpha).toBe(0);
  });

  it('returns prev=null, next=first when t is before first frame', () => {
    const buf = new AnimationFrameBuffer();
    const frame = makeFrame(1.0);
    buf.insert(frame);
    const result = buf.pairAt(0.5);
    expect(result.prev).toBeNull();
    expect(result.next).toEqual(frame);
    expect(result.alpha).toBe(0);
  });

  it('returns prev=last, next=null, alpha=1 when t is after last frame', () => {
    const buf = new AnimationFrameBuffer();
    const frame = makeFrame(1.0);
    buf.insert(frame);
    const result = buf.pairAt(1.5);
    expect(result.prev).toEqual(frame);
    expect(result.next).toBeNull();
    expect(result.alpha).toBe(1);
  });

  it('returns correct pair and interpolated alpha between two frames', () => {
    const buf = new AnimationFrameBuffer();
    const frame1 = makeFrame(1.0);
    const frame2 = makeFrame(2.0);
    buf.insert(frame1);
    buf.insert(frame2);
    // At t=1.25, span=1.0, rawAlpha=(1.25-1.0)/1.0 = 0.25
    const result = buf.pairAt(1.25);
    expect(result.prev).toEqual(frame1);
    expect(result.next).toEqual(frame2);
    expect(result.alpha).toBeCloseTo(0.25, 10);
  });

  it('handles exact-match at a frame boundary (alpha=0)', () => {
    const buf = new AnimationFrameBuffer();
    const frame1 = makeFrame(1.0);
    const frame2 = makeFrame(2.0);
    buf.insert(frame1);
    buf.insert(frame2);
    // At t=1.0, frame1.timeCodeSec <= 1.0, so frame1 is prev; frame2 is next
    // alpha = (1.0 - 1.0) / (2.0 - 1.0) = 0.0
    const result = buf.pairAt(1.0);
    expect(result.prev).toEqual(frame1);
    expect(result.next).toEqual(frame2);
    expect(result.alpha).toBe(0);
  });

  it('clamps alpha to [0, 1] even under floating-point imprecision', () => {
    const buf = new AnimationFrameBuffer();
    // Use deliberately tricky decimal arithmetic (0.1 + 0.2 !== 0.3 in IEEE 754)
    const f0 = makeFrame(0.0);
    const f1 = makeFrame(0.1);
    const f2 = makeFrame(0.2);
    buf.insert(f0);
    buf.insert(f1);
    buf.insert(f2);
    // Query between f1 and f2 using a computed value that may have FP drift
    const t = 0.1 + 0.05; // 0.15 — may not be exactly representable
    const between = buf.pairAt(t);
    expect(between.alpha).toBeGreaterThanOrEqual(0);
    expect(between.alpha).toBeLessThanOrEqual(1);
    expect(Number.isFinite(between.alpha)).toBe(true);

    // Query at exactly f2 boundary — f2 becomes prev, no next → alpha=1 (held)
    const atLast = buf.pairAt(0.2);
    expect(atLast.prev).toEqual(f2);
    expect(atLast.next).toBeNull();
    expect(atLast.alpha).toBe(1);

    // Query slightly beyond the last frame — clamp to 1
    const beyond = buf.pairAt(0.3);
    expect(beyond.alpha).toBe(1);
    expect(beyond.alpha).toBeGreaterThanOrEqual(0);
    expect(beyond.alpha).toBeLessThanOrEqual(1);
  });

  it('avoids divide-by-zero and returns finite alpha when frames share timeCodeSec', () => {
    // Two frames at the same timeCodeSec — the buffer accepts both (ordered by insertion).
    // When querying at a time past both, alpha=1 (held); when querying before both,
    // alpha=0 (pre-first-frame). In all cases alpha must be finite and in [0,1].
    const buf = new AnimationFrameBuffer();
    const f1 = makeFrame(1.0, 30, false);
    const f2: BotAnimation = {
      messageId: 'test-msg',
      sequence: 31,
      timeCodeSec: 1.0, // same time as f1
      fps: 30,
      weights: { jawOpen: 0.8 },
      emitEpochMs: 1000000000001,
      isFinal: false,
    };
    buf.insert(f1);
    buf.insert(f2);
    expect(buf.length).toBe(2);

    // Querying before both frames — alpha=0, no prev
    const before = buf.pairAt(0.5);
    expect(before.prev).toBeNull();
    expect(before.alpha).toBe(0);
    expect(Number.isFinite(before.alpha)).toBe(true);

    // Querying at or after both frames — both qualify as prev, alpha=1, no next
    const after = buf.pairAt(1.0);
    expect(after.next).toBeNull();
    expect(after.alpha).toBe(1);
    expect(Number.isFinite(after.alpha)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describe('gc')
// ---------------------------------------------------------------------------

describe('gc', () => {
  it('drops frames older than cursor - gcWindowSec', () => {
    const buf = new AnimationFrameBuffer(); // default gcWindowSec=0.5
    buf.insert(makeFrame(0.0));
    buf.insert(makeFrame(0.3));
    buf.insert(makeFrame(0.7));
    buf.insert(makeFrame(1.0));
    // gc(1.0): threshold = 1.0 - 0.5 = 0.5; drop frames with t < 0.5
    // Frame at 0.0 and 0.3 are dropped; 0.7 and 1.0 remain
    buf.gc(1.0);
    expect(buf.length).toBe(2);
    const p08 = buf.pairAt(0.8);
    expect(p08.prev?.timeCodeSec).toBe(0.7);
  });

  it('retains frames exactly at the GC threshold (strict less-than)', () => {
    const buf = new AnimationFrameBuffer(); // default gcWindowSec=0.5
    buf.insert(makeFrame(0.5)); // exactly at threshold
    buf.insert(makeFrame(1.0));
    // gc(1.0): threshold = 0.5; frame at 0.5 is NOT < 0.5, so it's retained
    buf.gc(1.0);
    expect(buf.length).toBe(2);
  });

  it('is a no-op on empty buffer', () => {
    const buf = new AnimationFrameBuffer();
    expect(() => buf.gc(1.0)).not.toThrow();
    expect(buf.length).toBe(0);
  });

  it('is a no-op when all frames are inside the window', () => {
    const buf = new AnimationFrameBuffer(); // default gcWindowSec=0.5
    buf.insert(makeFrame(0.8));
    buf.insert(makeFrame(0.9));
    buf.insert(makeFrame(1.0));
    // gc(1.0): threshold = 0.5; all frames have t >= 0.5, nothing dropped
    buf.gc(1.0);
    expect(buf.length).toBe(3);
  });

  it('uses custom gcWindowSec from constructor', () => {
    const buf = new AnimationFrameBuffer({ gcWindowSec: 0.1 });
    buf.insert(makeFrame(0.0));
    buf.insert(makeFrame(0.05));
    buf.insert(makeFrame(0.2));
    // gc(0.2): threshold = 0.2 - 0.1 = 0.1; drop frames with t < 0.1
    // Frame at 0.0 dropped; 0.05 is < 0.1, dropped; 0.2 remains
    buf.gc(0.2);
    expect(buf.length).toBe(1);
    expect(buf.pairAt(0.2).prev?.timeCodeSec).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------
// describe('clear')
// ---------------------------------------------------------------------------

describe('clear', () => {
  it('empties the buffer completely', () => {
    const buf = new AnimationFrameBuffer();
    buf.insert(makeFrame(0.0));
    buf.insert(makeFrame(1.0));
    buf.insert(makeFrame(2.0));
    expect(buf.length).toBe(3);
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.last).toBeNull();
    const result = buf.pairAt(1.0);
    expect(result.prev).toBeNull();
    expect(result.next).toBeNull();
    expect(result.alpha).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe('bounded growth')
// ---------------------------------------------------------------------------

describe('bounded growth', () => {
  it('stays bounded when insert+gc run in lockstep at 30fps', () => {
    const buf = new AnimationFrameBuffer(); // default gcWindowSec=0.5
    const fps = 30;
    const dt = 1 / fps;
    const totalFrames = 500;
    const maxExpected = Math.ceil(0.5 * fps) + 2; // gcWindowSec * fps + small headroom

    for (let i = 0; i < totalFrames; i++) {
      const t = i * dt;
      buf.insert(makeFrame(t, i));
      buf.gc(t);
      // Buffer should never grow beyond the window
      expect(buf.length).toBeLessThanOrEqual(maxExpected);
    }
  });
});
