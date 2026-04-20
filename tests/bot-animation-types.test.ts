import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WireBotAnimation } from '../src/types';

// Load the golden fixture (deterministic, no live backend dependency)
const fixturePath = join(__dirname, 'fixtures', 'bot_animation_frame.golden.json');
const fixture: unknown[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));

const REQUIRED_KEYS: (keyof WireBotAnimation)[] = [
  'message_id',
  'sequence',
  'time_code_sec',
  'fps',
  'weights',
  'emit_epoch_ms',
  'is_final',
];

/**
 * Runtime type-guard for WireBotAnimation.
 * Checks all 7 fields match the spec from worker.py:232-247.
 */
function isWireBotAnimation(obj: unknown): obj is WireBotAnimation {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const frame = obj as Record<string, unknown>;

  if (typeof frame.message_id !== 'string') return false;
  if (typeof frame.sequence !== 'number' || !Number.isFinite(frame.sequence)) return false;
  if (typeof frame.time_code_sec !== 'number' || !Number.isFinite(frame.time_code_sec)) return false;
  if (typeof frame.fps !== 'number') return false;
  if (
    frame.weights === null ||
    typeof frame.weights !== 'object' ||
    Array.isArray(frame.weights)
  ) return false;
  if (typeof frame.emit_epoch_ms !== 'number' || !Number.isFinite(frame.emit_epoch_ms)) return false;
  if (typeof frame.is_final !== 'boolean') return false;

  return true;
}

describe('BotAnimation type-guard', () => {
  it('golden fixture mid-utterance frame passes type-guard', () => {
    expect(isWireBotAnimation(fixture[0])).toBe(true);
  });

  it('golden fixture terminator frame passes type-guard', () => {
    expect(isWireBotAnimation(fixture[1])).toBe(true);
  });

  it('type-guard rejects frames missing required keys', () => {
    const baseFrame = fixture[0] as Record<string, unknown>;

    for (const key of REQUIRED_KEYS) {
      const incomplete = { ...baseFrame };
      delete incomplete[key];
      expect(isWireBotAnimation(incomplete)).toBe(false);
    }
  });

  it('type-guard rejects frames with wrong scalar types', () => {
    const baseFrame = fixture[0] as Record<string, unknown>;

    // sequence as string instead of number
    expect(isWireBotAnimation({ ...baseFrame, sequence: '42' })).toBe(false);

    // weights as array instead of object
    expect(isWireBotAnimation({ ...baseFrame, weights: [0.1, 0.2] })).toBe(false);

    // message_id as number instead of string
    expect(isWireBotAnimation({ ...baseFrame, message_id: 12345 })).toBe(false);

    // is_final as string instead of boolean
    expect(isWireBotAnimation({ ...baseFrame, is_final: 'false' })).toBe(false);

    // weights as null
    expect(isWireBotAnimation({ ...baseFrame, weights: null })).toBe(false);
  });
});
