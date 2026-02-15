// ─── Configuration ───────────────────────────────────────────────

export interface EstuaryConfig {
  /** Base URL of the Estuary server (e.g., "https://api.estuary-ai.com") */
  serverUrl: string;
  /** API key (starts with "est_") */
  apiKey: string;
  /** Character (agent) ID */
  characterId: string;
  /** Unique identifier for the end user */
  playerId: string;
  /** Audio sample rate in Hz (default: 16000) */
  audioSampleRate?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Delay between reconnect attempts in ms (default: 2000) */
  reconnectDelayMs?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Voice transport: 'websocket' | 'livekit' | 'auto' (default: 'auto') */
  voiceTransport?: VoiceTransport;
  /** Enable real-time memory extraction after each response (default: false) */
  realtimeMemory?: boolean;
}

export type VoiceTransport = 'websocket' | 'livekit' | 'auto';

// ─── Connection State ────────────────────────────────────────────

export enum ConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Error = 'error',
}

// ─── Wire Format Types (snake_case from server) ─────────────────

/** @internal */
export interface WireSessionInfo {
  session_id: string;
  conversation_id: string;
  character_id: string;
  player_id: string;
}

/** @internal */
export interface WireBotResponse {
  text: string;
  is_final: boolean;
  partial: string;
  message_id: string;
  chunk_index: number;
  is_interjection: boolean;
}

/** @internal */
export interface WireBotVoice {
  audio: string;
  message_id: string;
  chunk_index: number;
  is_final: boolean;
}

/** @internal */
export interface WireSttResponse {
  text: string;
  is_final: boolean;
}

/** @internal */
export interface WireInterruptData {
  message_id?: string;
  reason?: string;
  interrupted_at?: string;
}

/** @internal */
export interface WireQuotaExceededData {
  message: string;
  current: number;
  limit: number;
  remaining: number;
  tier: string;
}

/** @internal */
export interface WireLiveKitTokenResponse {
  token: string;
  url: string;
  room: string;
}

/** @internal */
export interface WireCameraCaptureRequest {
  request_id: string;
  text?: string;
}

/** @internal — new_memories items are already camelCase from Memory.to_dict() */
export interface WireMemoryUpdated {
  agent_id: string;
  player_id: string;
  memories_extracted: number;
  facts_extracted: number;
  conversation_id: string;
  new_memories: MemoryData[];
  timestamp: string;
}

// ─── Public Types (camelCase) ────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  conversationId: string;
  characterId: string;
  playerId: string;
}

export interface BotResponse {
  text: string;
  isFinal: boolean;
  partial: string;
  messageId: string;
  chunkIndex: number;
  isInterjection: boolean;
}

export interface BotVoice {
  audio: string;
  messageId: string;
  chunkIndex: number;
  isFinal: boolean;
}

export interface SttResponse {
  text: string;
  isFinal: boolean;
}

export interface InterruptData {
  messageId?: string;
  reason?: string;
  interruptedAt?: string;
}

export interface QuotaExceededData {
  message: string;
  current: number;
  limit: number;
  remaining: number;
  tier: string;
}

export interface LiveKitTokenResponse {
  token: string;
  url: string;
  room: string;
}

export interface CameraCaptureRequest {
  requestId: string;
  text?: string;
}

export interface MemoryData {
  id: string;
  content: string;
  memoryType: string;
  confidence: number;
  status: string;
  sourceConversationId: string;
  sourceQuote?: string;
  topic?: string;
  createdAt: string;
}

export interface MemoryUpdatedEvent {
  agentId: string;
  playerId: string;
  memoriesExtracted: number;
  factsExtracted: number;
  conversationId: string;
  newMemories: MemoryData[];
  timestamp: string;
}

// ─── Wire → Public Converters ────────────────────────────────────

/** @internal */
export function toSessionInfo(wire: WireSessionInfo): SessionInfo {
  return {
    sessionId: wire.session_id,
    conversationId: wire.conversation_id,
    characterId: wire.character_id,
    playerId: wire.player_id,
  };
}

/** @internal */
export function toBotResponse(wire: WireBotResponse): BotResponse {
  return {
    text: wire.text,
    isFinal: wire.is_final,
    partial: wire.partial,
    messageId: wire.message_id,
    chunkIndex: wire.chunk_index,
    isInterjection: wire.is_interjection,
  };
}

/** @internal */
export function toBotVoice(wire: WireBotVoice): BotVoice {
  return {
    audio: wire.audio,
    messageId: wire.message_id,
    chunkIndex: wire.chunk_index,
    isFinal: wire.is_final,
  };
}

/** @internal */
export function toSttResponse(wire: WireSttResponse): SttResponse {
  return {
    text: wire.text,
    isFinal: wire.is_final,
  };
}

/** @internal */
export function toInterruptData(wire: WireInterruptData): InterruptData {
  return {
    messageId: wire.message_id,
    reason: wire.reason,
    interruptedAt: wire.interrupted_at,
  };
}

/** @internal */
export function toQuotaExceededData(wire: WireQuotaExceededData): QuotaExceededData {
  return {
    message: wire.message,
    current: wire.current,
    limit: wire.limit,
    remaining: wire.remaining,
    tier: wire.tier,
  };
}

/** @internal */
export function toLiveKitTokenResponse(wire: WireLiveKitTokenResponse): LiveKitTokenResponse {
  return {
    token: wire.token,
    url: wire.url,
    room: wire.room,
  };
}

/** @internal */
export function toCameraCaptureRequest(wire: WireCameraCaptureRequest): CameraCaptureRequest {
  return {
    requestId: wire.request_id,
    text: wire.text,
  };
}

/** @internal */
export function toMemoryUpdatedEvent(wire: WireMemoryUpdated): MemoryUpdatedEvent {
  return {
    agentId: wire.agent_id,
    playerId: wire.player_id,
    memoriesExtracted: wire.memories_extracted,
    factsExtracted: wire.facts_extracted,
    conversationId: wire.conversation_id,
    newMemories: wire.new_memories ?? [],
    timestamp: wire.timestamp,
  };
}

// ─── Event Map ───────────────────────────────────────────────────

export type EstuaryEventMap = {
  connected: (session: SessionInfo) => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number) => void;
  connectionStateChanged: (state: ConnectionState) => void;
  botResponse: (response: BotResponse) => void;
  botVoice: (voice: BotVoice) => void;
  sttResponse: (response: SttResponse) => void;
  interrupt: (data: InterruptData) => void;
  error: (error: Error) => void;
  authError: (error: string) => void;
  quotaExceeded: (data: QuotaExceededData) => void;
  cameraCaptureRequest: (request: CameraCaptureRequest) => void;
  voiceStarted: () => void;
  voiceStopped: () => void;
  livekitConnected: (room: string) => void;
  livekitDisconnected: () => void;
  audioPlaybackStarted: (messageId: string) => void;
  audioPlaybackComplete: (messageId: string) => void;
  memoryUpdated: (event: MemoryUpdatedEvent) => void;
}

// ─── Voice Manager Interface ─────────────────────────────────────

export interface VoiceManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  toggleMute(): void;
  readonly isMuted: boolean;
  readonly isActive: boolean;
  dispose(): void;
}

// ─── Memory Types ────────────────────────────────────────────────

export interface MemoryListOptions {
  memoryType?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'confidence' | 'last_accessed_at';
  sortOrder?: 'asc' | 'desc';
}

export interface MemoryTimelineOptions {
  startDate?: string;
  endDate?: string;
  groupBy?: 'day' | 'week' | 'month';
}

export interface MemoryGraphOptions {
  includeEntities?: boolean;
  includeCharacterMemories?: boolean;
}

export interface MemorySearchOptions {
  query: string;
  limit?: number;
}

export interface MemoryListResponse {
  memories: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemoryTimelineResponse {
  timeline: { date: string; memories: Record<string, unknown>[] }[];
  totalMemories: number;
  groupBy: string;
}

export interface MemoryStatsResponse {
  [key: string]: unknown;
}

export interface MemoryGraphResponse {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  stats: Record<string, unknown>;
}

export interface MemorySearchResponse {
  results: { memory: Record<string, unknown>; score: number; similarityScore: number }[];
  query: string;
  total: number;
}

export interface CoreFactsResponse {
  coreFacts: Record<string, unknown>[];
}
