import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'neutral',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    external: ['livekit-client', 'socket.io-client'],
  },
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    platform: 'node',
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    external: ['livekit-client', 'socket.io-client'],
  },
]);
