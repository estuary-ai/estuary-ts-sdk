import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EstuaryClient } from '../../src';
import type { BotVoice } from '../../src';

// Gated: only runs when ESTUARY_E2E is set (via `npm run test:e2e`). Normal `npm test` skips it.
const RUN = !!process.env.ESTUARY_E2E;
const SERVER = process.env.ESTUARY_E2E_URL ?? 'http://localhost:4001';
const API_KEY = process.env.ESTUARY_E2E_API_KEY ?? 'est_demo-api-key-estuary-2026';
const PLAYER = process.env.ESTUARY_E2E_PLAYER_ID ?? `e2e-sayline-${Date.now()}`;

function deadline(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));
}

async function discoverCharacterId(): Promise<string> {
  if (process.env.ESTUARY_E2E_CHARACTER_ID) return process.env.ESTUARY_E2E_CHARACTER_ID;
  const res = await fetch(`${SERVER}/api/v1/characters`, { headers: { 'X-API-Key': API_KEY } });
  if (!res.ok) throw new Error(`character discovery failed: HTTP ${res.status}`);
  const data = (await res.json()) as { characters?: Array<{ id: string }> } | Array<{ id: string }>;
  const list = Array.isArray(data) ? data : (data.characters ?? []);
  if (list.length === 0) throw new Error('no characters available to test against');
  return list[0].id;
}

describe.skipIf(!RUN)('say_line e2e (live backend)', () => {
  let client: EstuaryClient;

  beforeAll(async () => {
    const characterId = await discoverCharacterId();
    client = new EstuaryClient({
      serverUrl: SERVER,
      apiKey: API_KEY,
      characterId,
      playerId: PLAYER,
      autoReconnect: false,
    });
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    await client?.disconnect();
  });

  beforeEach(() => {
    client.removeAllListeners();
  });

  it('sayLine with TTS yields a final bot_response and bot_voice audio', async () => {
    const voices: BotVoice[] = [];
    const finished = new Promise<void>((resolve) => {
      client.on('botVoice', (v) => {
        if (v.audio) voices.push(v);
      });
      client.on('botResponse', (r) => {
        if (r.isFinal) resolve();
      });
    });
    client.sayLine('Hello there, this is a scripted test line.', false);
    await Promise.race([finished, deadline(25_000, 'no final bot_response for TTS sayLine')]);
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.some((v) => (v.audio?.length ?? 0) > 0)).toBe(true);
  }, 30_000);

  it('text-only sayLine yields a bot_response and no audio', async () => {
    const voices: BotVoice[] = [];
    const finished = new Promise<void>((resolve) => {
      client.on('botVoice', (v) => {
        if (v.audio) voices.push(v);
      });
      client.on('botResponse', (r) => {
        if (r.isFinal) resolve();
      });
    });
    client.sayLine('A silent scripted line.', true);
    await Promise.race([finished, deadline(20_000, 'no final bot_response for text-only sayLine')]);
    expect(voices.length).toBe(0);
  }, 25_000);

  it('playScript speaks lines in order without stomping', async () => {
    const startedOrder: number[] = [];
    client.on('scriptLineStarted', (i) => startedOrder.push(i.index));
    const script = client.playScript(
      ['Line one of the script.', 'Line two of the script.', 'Line three of the script.'],
      { textOnly: false },
    );
    const result = await Promise.race([
      script.done,
      deadline(90_000, 'script did not finish in time'),
    ]);
    expect(result).toEqual({ reason: 'finished' });
    expect(startedOrder).toEqual([0, 1, 2]);
  }, 100_000);
});
