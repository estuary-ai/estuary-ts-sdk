// Main client
export { EstuaryClient } from './client';

// Errors
export { EstuaryError, ErrorCode } from './errors';

// Types — public interfaces and enums
export type {
  EstuaryConfig,
  VoiceTransport,
  SessionCapabilities,
  SessionInfo,
  CharacterInfo,
  BotResponse,
  BotVoice,
  SttResponse,
  InterruptData,
  QuotaExceededData,
  LiveKitTokenResponse,
  CameraCaptureRequest,
  CharacterAction,
  EstuaryEventMap,
  VoiceManager,
  MemoryListOptions,
  MemoryTimelineOptions,
  MemoryGraphOptions,
  MemorySearchOptions,
  MemoryListResponse,
  MemoryTimelineResponse,
  MemoryStatsResponse,
  MemoryGraphNode,
  MemoryGraphEdge,
  MemoryGraphResponse,
  MemorySearchResponse,
  CoreFact,
  CoreFactsResponse,
  MemoryData,
  MemoryUpdatedEvent,
  ShareOpenResponse,
} from './types';

export { ConnectionState } from './types';

// Action parsing utilities
export { parseActions } from './utils/action-parser';
export type { ParsedAction } from './utils/action-parser';

// Memory client (so users can type `client.memory` properly)
export type { MemoryClient } from './rest/memory-client';

// Character client
export type { CharacterClient } from './rest/character-client';
