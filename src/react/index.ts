/**
 * @estuary-ai/sdk/react sub-path export
 *
 * React hook for subscribing to A2F bot_animation events and buffering frames
 * for audio-clock-anchored lipsync interpolation.
 *
 * Import from the sub-path to keep the core `@estuary-ai/sdk` bundle React-free:
 *
 * ```ts
 * import { useAnimationStream } from '@estuary-ai/sdk/react';
 * import type { UseAnimationStreamOptions } from '@estuary-ai/sdk/react';
 * ```
 *
 * React 18+ or 19+ is required as a peer dependency (optional — not bundled).
 */

export { useAnimationStream } from './use-animation-stream';
export type {
  UseAnimationStreamOptions,
  UseAnimationStreamReturn,
  AnimationHealthStatus,
} from './use-animation-stream';
