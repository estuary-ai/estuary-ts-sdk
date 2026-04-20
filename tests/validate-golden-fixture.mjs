// Single source of truth: estuary-backend/worker/worker.py:232-247 + :302-309.
// If this script fails after a worker envelope change, REGENERATE the fixture,
// do not relax the assertions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, 'fixtures', 'bot_animation_frame.golden.json');

const REQUIRED_KEYS = [
  'message_id',
  'sequence',
  'time_code_sec',
  'fps',
  'weights',
  'emit_epoch_ms',
  'is_final',
];

function assert(condition, message) {
  if (!condition) {
    console.error(`ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
} catch (err) {
  console.error(`Failed to read fixture: ${err.message}`);
  process.exit(1);
}

assert(Array.isArray(fixture), 'Fixture must be a JSON array');
assert(fixture.length === 2, `Fixture must have exactly 2 elements, got ${fixture.length}`);

for (let i = 0; i < fixture.length; i++) {
  const frame = fixture[i];
  const label = `Element ${i}`;

  // Must have exactly the 7 required keys — no extras, no missing
  const keys = Object.keys(frame).sort();
  const expectedKeys = [...REQUIRED_KEYS].sort();
  assert(
    keys.length === expectedKeys.length && keys.every((k, idx) => k === expectedKeys[idx]),
    `${label}: expected keys [${expectedKeys.join(', ')}], got [${keys.join(', ')}]`
  );

  // Type checks
  assert(typeof frame.message_id === 'string', `${label}: message_id must be string`);
  assert(Number.isFinite(frame.sequence), `${label}: sequence must be a finite number`);
  assert(Number.isInteger(frame.sequence), `${label}: sequence must be an integer`);
  assert(Number.isFinite(frame.time_code_sec), `${label}: time_code_sec must be a finite number`);
  assert(frame.fps === 30, `${label}: fps must be 30, got ${frame.fps}`);
  assert(
    frame.weights !== null && typeof frame.weights === 'object' && !Array.isArray(frame.weights),
    `${label}: weights must be a plain object`
  );
  assert(Number.isFinite(frame.emit_epoch_ms), `${label}: emit_epoch_ms must be a finite number`);
  assert(typeof frame.is_final === 'boolean', `${label}: is_final must be boolean`);

  // Terminator invariant (worker.py:232-247 + :302-309)
  if (frame.sequence >= 0) {
    assert(frame.is_final === false, `${label}: mid-utterance frame (sequence>=0) must have is_final=false`);
    assert(
      Object.keys(frame.weights).length >= 1,
      `${label}: mid-utterance frame must have at least 1 weight key`
    );
  } else {
    assert(frame.sequence === -1, `${label}: negative sequence must be exactly -1 (terminator)`);
    assert(frame.is_final === true, `${label}: terminator frame (sequence=-1) must have is_final=true`);
    assert(
      Object.keys(frame.weights).length === 0,
      `${label}: terminator frame must have empty weights`
    );
    assert(frame.time_code_sec === 0.0, `${label}: terminator frame must have time_code_sec=0.0`);
  }

  console.log(`  Element ${i}: OK (sequence=${frame.sequence}, is_final=${frame.is_final}, weights_count=${Object.keys(frame.weights).length})`);
}

console.log('GOLDEN FIXTURE OK');
