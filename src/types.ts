// ─── Configuration ───────────────────────────────────────────────

export interface EstuaryConfig {
  /** Base URL of the Estuary server (e.g., "https://api.estuary-ai.com") */
  serverUrl: string;
  /** API key (starts with "est_"). Required unless sessionToken is provided. */
  apiKey?: string;
  /** Session token from share exchange (starts with "sst_"). Alternative to apiKey for share flows. */
  sessionToken?: string;
  /** Character (agent) ID */
  characterId: string;
  /** Unique identifier for the end user */
  playerId: string;
  /** Audio sample rate in Hz (default: 16000) */
  audioSampleRate?: number;
  /** Opt in to A2F bot_animation events (requires global ENABLE_A2F=true on the backend; also requires audioSampleRate=16000 for the worker A2F gate to fire). Default: false */
  enableAnimation?: boolean;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnect attempts in ms (default: 2000). Actual delay is baseDelay × attemptNumber (linear backoff). */
  reconnectDelayMs?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Voice transport: 'websocket' | 'livekit' | 'auto' (default: 'auto') */
  voiceTransport?: VoiceTransport;
  /** Enable real-time memory extraction after each response (default: false) */
  realtimeMemory?: boolean;
  /** Suppress mic during TTS playback (software AEC fallback, disables barge-in). Default: false */
  suppressMicDuringPlayback?: boolean;
  /** Proactively interrupt bot audio when user starts speaking (default: true) */
  autoInterruptOnSpeech?: boolean;
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
  token_stream?: boolean;
}

/** @internal */
export interface WireBotVoice {
  audio?: string;
  message_id: string;
  chunk_index: number;
  is_final?: boolean;
  is_livekit?: boolean;
}

// Wire envelope from worker._publish_bot_animation (worker.py:232-247). The Socket.IO payload is the `data` sub-object.
/** @internal */
export interface WireBotAnimation {
  message_id: string;
  sequence: number;
  time_code_sec: number;
  fps: number;
  weights: Record<string, number>;
  emit_epoch_ms: number;
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
  tokenStream?: boolean;
}

export interface BotVoice {
  audio?: string;
  messageId: string;
  chunkIndex: number;
  isFinal?: boolean;
  isLivekit?: boolean;
}

export interface BotAnimation {
  messageId: string;
  sequence: number;
  timeCodeSec: number;
  fps: number;
  weights: Record<string, number>;
  emitEpochMs: number;
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
  userId: string;
  agentId: string;
  playerId: string;
  content: string;
  memoryType: string;
  confidence: number;
  status: string;
  sourceConversationId: string;
  sourceQuote?: string;
  source?: string;
  topic?: string;
  secondaryTopics?: string[];
  lastAccessedAt?: string | null;
  accessCount?: number;
  extractedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
    tokenStream: wire.token_stream,
  };
}

/** @internal */
export function toBotVoice(wire: WireBotVoice): BotVoice {
  return {
    audio: wire.audio,
    messageId: wire.message_id,
    chunkIndex: wire.chunk_index,
    isFinal: wire.is_final ?? false,
    isLivekit: wire.is_livekit,
  };
}

/** @internal */
export function toBotAnimation(wire: WireBotAnimation): BotAnimation {
  return {
    messageId: wire.message_id,
    sequence: wire.sequence,
    timeCodeSec: wire.time_code_sec,
    fps: wire.fps,
    // Normalize blendshape key casing: the NVIDIA A2F NIM emits blendshape
    // names in PascalCase (e.g., `JawOpen`, `EyeBlinkLeft`), but the ARKit-52
    // canonical naming and CC5 GLB morph targets use camelCase (`jawOpen`,
    // `eyeBlinkLeft`). Lower-casing the first character is a safe, lossless
    // transform for ARKit-like names (ASCII-first-letter, no leading digits).
    // Keys that are already camelCase are unchanged. This keeps consumers
    // naming-convention-agnostic.
    weights: normalizeBlendshapeKeys(wire.weights),
    emitEpochMs: wire.emit_epoch_ms,
    isFinal: wire.is_final,
  };
}

/**
 * Lowercase the first character of each key in a weights map.
 * `JawOpen` → `jawOpen`; `jawOpen` → `jawOpen` (no-op);
 * `` → `` (empty keys pass through).
 */
function normalizeBlendshapeKeys(
  weights: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in weights) {
    if (k.length === 0) {
      out[k] = weights[k];
      continue;
    }
    const first = k.charCodeAt(0);
    // Only transform ASCII uppercase A-Z (65-90). Leaves already-camelCase keys
    // and non-ASCII-prefixed keys untouched.
    if (first >= 65 && first <= 90) {
      out[k[0].toLowerCase() + k.slice(1)] = weights[k];
    } else {
      out[k] = weights[k];
    }
  }
  return out;
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

// ─── Character Info ──────────────────────────────────────────────

export interface CharacterInfo {
  id: string;
  name: string;
  tagline: string | null;
  avatar: string | null;
  modelUrl: string | null;
  modelPreviewUrl: string | null;
  modelStatus: string | null;
  sourceImageUrl: string | null;
}

// ─── Character Actions ───────────────────────────────────────────

export interface CharacterAction {
  /** Action name (e.g., "follow_user", "sit", "look_at") */
  name: string;
  /** Action parameters as key-value pairs */
  params: Record<string, string>;
  /** Message ID of the bot response that contained this action */
  messageId: string;
}

// ─── Event Map ───────────────────────────────────────────────────

export type EstuaryEventMap = {
  connected: (session: SessionInfo) => void;
  disconnected: (reason: string) => void;
  reconnecting: (attempt: number) => void;
  connectionStateChanged: (state: ConnectionState) => void;
  botResponse: (response: BotResponse) => void;
  botVoice: (voice: BotVoice) => void;
  botAnimation: (frame: BotAnimation) => void;
  sttResponse: (response: SttResponse) => void;
  interrupt: (data: InterruptData) => void;
  error: (error: Error) => void;
  authError: (error: string) => void;
  quotaExceeded: (data: QuotaExceededData) => void;
  cameraCaptureRequest: (request: CameraCaptureRequest) => void;
  characterAction: (action: CharacterAction) => void;
  voiceStarted: () => void;
  voiceStopped: () => void;
  livekitConnected: (room: string) => void;
  livekitDisconnected: () => void;
  audioPlaybackStarted: (messageId: string) => void;
  audioPlaybackComplete: (messageId: string) => void;
  /** Bot audio level 0.0–1.0, emitted during playback for both transports. */
  botAudioLevel: (level: number) => void;
  memoryUpdated: (event: MemoryUpdatedEvent) => void;
}

// ─── Voice Manager Interface ─────────────────────────────────────

export interface VoiceManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  toggleMute(): void;
  /** Suppress audio sending (software AEC). No-op if not supported. */
  setSuppressed?(suppressed: boolean): void;
  /** Set callback for speaking state from participant attributes (LiveKit only). */
  setSpeakingStateCallback?(cb: (speaking: boolean) => void): void;
  /** Set callback for audio level updates (0-1) during bot speech. */
  setAudioLevelCallback?(cb: (level: number) => void): void;
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
  memories: MemoryData[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemoryTimelineResponse {
  timeline: { date: string; memories: MemoryData[] }[];
  totalMemories: number;
  groupBy: string;
}

export interface MemoryStatsResponse {
  totalActive: number;
  totalSuperseded: number;
  totalDecayed: number;
  byType: Record<string, number>;
  coreFacts: number;
}

export interface MemoryGraphNode {
  id: string;
  type: 'user' | 'cluster' | 'memory' | 'entity';
  label?: string;
  /** Cluster fields */
  level?: number;
  memoryCount?: number;
  typeDistribution?: Record<string, number>;
  expanded?: boolean;
  parentClusterId?: string | null;
  childClusterIds?: string[];
  labelPending?: boolean;
  /** Memory fields */
  memoryType?: string;
  content?: string;
  confidence?: number;
  clusterId?: string;
  sourceQuote?: string | null;
  sourceConversationId?: string | null;
  createdAt?: string | null;
  accessCount?: number;
  /** Entity fields */
  entityType?: string | null;
  name?: string;
  mentionCount?: number;
  extraData?: Record<string, string>;
}

export interface MemoryGraphEdge {
  source: string;
  target: string;
  type: 'has_cluster' | 'contains' | 'mentions' | 'relationship';
  relationshipType?: string;
  label?: string | null;
  confidence?: number;
}

export interface MemoryGraphResponse {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  stats: {
    totalMemories: number;
    totalEntities: number;
    clusterCount: number;
    clusters: Record<string, number>;
  };
  stale?: boolean;
}

export interface MemorySearchResponse {
  results: { memory: MemoryData; score: number; similarityScore: number }[];
  query: string;
  total: number;
}

export interface CoreFact {
  id: string;
  userId: string;
  agentId: string;
  playerId: string;
  factKey: string;
  factValue: string;
  sourceMemoryId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CoreFactsResponse {
  coreFacts: CoreFact[];
}
