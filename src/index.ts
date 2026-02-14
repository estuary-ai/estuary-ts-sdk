// Main client
export { EstuaryClient } from './client';

// Errors
export { EstuaryError, ErrorCode } from './errors';

// Types — public interfaces and enums
export type {
  EstuaryConfig,
  VoiceTransport,
  SessionInfo,
  BotResponse,
  BotVoice,
  SttResponse,
  InterruptData,
  QuotaExceededData,
  LiveKitTokenResponse,
  CameraCaptureRequest,
  EstuaryEventMap,
  VoiceManager,
  MemoryListOptions,
  MemoryTimelineOptions,
  MemoryGraphOptions,
  MemorySearchOptions,
  MemoryListResponse,
  MemoryTimelineResponse,
  MemoryStatsResponse,
  MemoryGraphResponse,
  MemorySearchResponse,
  CoreFactsResponse,
  MemoryData,
  MemoryUpdatedEvent,
} from './types';

export { ConnectionState } from './types';

// Memory client (so users can type `client.memory` properly)
export type { MemoryClient } from './rest/memory-client';
