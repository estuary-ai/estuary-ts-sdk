/**
 * REST conformance: every `sdk.ts` case in the monorepo's
 * sdk-conformance/rest.json must produce exactly that request through the REAL
 * RestClient (only the global fetch is stubbed). See sdk-conformance/README.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RestClient } from '../src/rest/rest-client';
import { MemoryClient } from '../src/rest/memory-client';
import { CharacterClient } from '../src/rest/character-client';
import { EstuaryClient } from '../src/client';

interface ConformanceCase {
  id: string;
  sdk: Record<string, string>;
  call?: Record<string, unknown>;
  method: string;
  path: string;
  query?: Record<string, string>;
  json?: unknown;
}

interface Fixture {
  args: { characterId: string; playerId: string };
  headers: Record<string, { pattern: string }>;
  cases: ConformanceCase[];
}

// The SDK repo sits inside the monorepo at estuary-product/estuary-ts-sdk.
const FIXTURE_PATH = resolve(__dirname, '../../sdk-conformance/rest.json');
const fixture: Fixture | null = existsSync(FIXTURE_PATH)
  ? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture)
  : null;

/**
 * Cases the SDK deliberately does not follow yet, with the request it sends
 * instead. The test asserts the documented legacy request, so closing the gap
 * without removing the entry here fails loudly.
 */
const KNOWN_GAPS: Record<string, { path: string; reason: string }> = {};

const SERVER = 'https://api.example.com';
const API_KEY = 'est_conformance';

function okResponse(): Response {
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Map a fixture case onto the SDK's own call idiom. */
async function invoke(c: ConformanceCase, f: Fixture): Promise<void> {
  const rest = new RestClient(SERVER, API_KEY);
  const memory = new MemoryClient(rest, f.args.characterId, f.args.playerId);
  const character = new CharacterClient(rest);
  const call = c.call ?? {};
  switch (c.sdk.ts) {
    case 'memory.getMemories':
      await memory.getMemories(call);
      return;
    case 'memory.getTimeline':
      await memory.getTimeline(call);
      return;
    case 'memory.getStats':
      await memory.getStats();
      return;
    case 'memory.getCoreFacts':
      await memory.getCoreFacts();
      return;
    case 'memory.getGraph':
      await memory.getGraph(call);
      return;
    case 'memory.search':
      await memory.search(call.query as string, call.limit as number | undefined);
      return;
    case 'memory.deleteAll':
      await memory.deleteAll(call.confirm as boolean);
      return;
    case 'getCharacter':
      await character.getCharacter(f.args.characterId);
      return;
    default:
      throw new Error(`No TS SDK binding for "${c.sdk.ts}" (case ${c.id}): add it to invoke()`);
  }
}

if (!fixture) {
  describe('REST conformance', () => {
    it.skip(`skipped: ${FIXTURE_PATH} not found (SDK cloned outside the monorepo)`, () => {});
  });
} else {
  const f = fixture;
  const clientHeader = new RegExp(f.headers['X-Estuary-Client'].pattern);
  const tsCases = f.cases.filter((c) => c.sdk.ts);

  describe('REST conformance (sdk-conformance/rest.json)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn(async () => okResponse());
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('has TS cases to check', () => {
      expect(tsCases.length).toBeGreaterThan(0);
    });

    for (const c of tsCases) {
      const gap = KNOWN_GAPS[c.id];
      const title = gap ? `${c.id} (known gap, legacy route: ${gap.reason})` : c.id;

      it(title, async () => {
        await invoke(c, f);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const url = new URL(rawUrl);
        const headers = new Headers(init.headers);

        // Every request, canonical or not, identifies the SDK and carries the key.
        expect(headers.get('X-Estuary-Client')).toMatch(clientHeader);
        expect(headers.get('X-API-Key')).toBe(API_KEY);

        expect(init.method).toBe(c.method);
        expect(url.origin).toBe(SERVER);

        if (gap) {
          expect(url.pathname).toBe(gap.path);
          return;
        }

        expect(url.pathname).toBe(c.path);
        expect(Object.fromEntries(url.searchParams.entries())).toEqual(c.query ?? {});

        if (c.json !== undefined) {
          expect(headers.get('Content-Type')).toBe('application/json');
          expect(JSON.parse(init.body as string)).toEqual(c.json);
        } else {
          expect(init.body).toBeUndefined();
        }
      });
    }

    it('openShare (no API key) still sends X-Estuary-Client', async () => {
      await EstuaryClient.openShare(SERVER, 'share_1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [rawUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(new URL(rawUrl).pathname).toBe('/api/v1/share/share_1/open');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('X-Estuary-Client')).toMatch(clientHeader);
    });
  });
}
