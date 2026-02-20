import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'browser',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    external: ['livekit-client'],
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    platform: 'node',
    sourcemap: true,
    splitting: false,
    treeshake: true,
    external: ['livekit-client'],
  },
]);
