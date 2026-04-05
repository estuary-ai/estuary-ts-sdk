import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM — fully self-contained browser build. All deps (socket.io-client,
  // livekit-client) bundled inline so bundlers that don't respect the `browser`
  // field or can't resolve external dynamic imports (e.g. Mattercraft) just work.
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'browser',
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    // Override tsup's auto-externalization of peerDependencies
    noExternal: ['livekit-client', 'socket.io-client'],
  },
  // CJS — Node.js. livekit-client kept external (optional peer dep).
  {
    entry: ['src/index.ts'],
    format: ['cjs'],
    platform: 'node',
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    external: ['livekit-client'],
  },
]);
