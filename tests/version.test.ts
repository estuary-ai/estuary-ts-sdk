import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SDK_VERSION, CLIENT_HEADER_VALUE } from '../src/version';

describe('SDK_VERSION', () => {
  it('matches the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('builds the X-Estuary-Client header value from it', () => {
    expect(CLIENT_HEADER_VALUE).toBe(`estuary-ts-sdk/${SDK_VERSION}`);
  });
});
