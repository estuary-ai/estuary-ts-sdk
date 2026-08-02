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
  /** Manage the browser page lifecycle (default: true; no-op outside browsers).
   *  When the page is hidden or dismissed (home button, tab switch, App Clip
   *  close), voice is released — the LiveKit room is left server-side so audio
   *  and billing stop — and when the page becomes visible again, voice resumes
   *  automatically (reconnecting the socket first if the suspended one went
   *  stale). Set false to manage backgrounding yourself. */
  manageBrowserLifecycle?: boolean;
  /** Restart voice automatically after an unexpected disconnect once the
   *  connection is re-established, if voice was active when it dropped
   *  (default: true). Server-initiated disconnects (idle reap, quota) never
   *  auto-resume regardless of this flag. */
  resumeVoiceOnReconnect?: boolean;
  /** Per-session client capability declaration. Tells the server what the device
   *  can physically do (camera, microphone, speaker). When omitted, the server
   *  defaults all fields to true for backward compatibility. Tools requiring a
   *  capability are hidden from the LLM when that capability is false (e.g.
   *  `request_camera_image` is suppressed when `camera: false`). */
  capabilities?: SessionCapabilities;
}

export type VoiceTransport = 'websocket' | 'livekit' | 'auto';

/** Per-session *device* capability declaration. Pass on `EstuaryConfig.capabilities`.
 *
 *  Protocol capabilities are not part of this interface. The SDK adds
 *  `client_action: true` to the wire payload itself (see socket-manager), since
 *  whether this build understands typed `client_action` events is a fact about
 *  the SDK, not a choice the app gets to make. */
export interface SessionCapabilities {
  /** Schema version. Defaults to "1" when omitted. */
  version?: string;
  /** Device has a camera the SDK can call `sendCameraImage()` against. */
  camera?: boolean;
  /** Device has a microphone usable for voice capture. */
  microphone?: boolean;
  /** Device has a speaker usable for TTS playback. */
  speaker?: boolean;
}

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
export interface WireSessionTimeoutData {
  reason: string;
  idle_seconds: number;
  timeout_seconds: number;
}

/** @internal */
export interface WireVoiceTimeoutData {
  reason: string;
  idle_seconds: number;
  timeout_seconds: number;
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

/** @internal — typed client_action event (SDK_CONTRACT.md v1.9, SCRUM-202) */
export interface WireClientAction {
  name: string;
  /** Validated server-side against the character's declared parameter types. */
  arguments: Record<string, string | number | boolean>;
  message_id: string;
  /** Sentence counter when the action was emitted; not needed for correct behavior. */
  chunk_index: number;
  /** ISO 8601 server emit time. */
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

/**
 * Emitted when the server ends the session due to inactivity (no conversation
 * activity for the server's idle timeout). The server disconnects the socket
 * right after; the SDK does not auto-reconnect from this — call connect()
 * again on explicit user intent to resume.
 */
export interface SessionTimeoutData {
  reason: string;
  idleSeconds: number;
  timeoutSeconds: number;
}

/**
 * Emitted when the server releases the CALL's voice resources after voice
 * inactivity (no user speech for the server's voice-idle timeout) while the
 * session itself stays connected — e.g. the user kept texting with a silent
 * call open. The LiveKit room is already deleted server-side; the SDK has
 * released the microphone and disposed the voice transport (voiceStopped is
 * also emitted). The socket remains connected and text chat continues.
 *
 * Recommended UX: present this as an auto-muted microphone rather than a
 * dropped call — keep the call UI open, show the mic as muted, and call
 * startVoice() again when the user unmutes.
 */
export interface VoiceTimeoutData {
  reason: string;
  idleSeconds: number;
  timeoutSeconds: number;
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
export function toSessionTimeoutData(wire: WireSessionTimeoutData): SessionTimeoutData {
  return {
    reason: wire.reason,
    idleSeconds: wire.idle_seconds,
    timeoutSeconds: wire.timeout_seconds,
  };
}

/** @internal */
export function toVoiceTimeoutData(wire: WireVoiceTimeoutData): VoiceTimeoutData {
  return {
    reason: wire.reason,
    idleSeconds: wire.idle_seconds,
    timeoutSeconds: wire.timeout_seconds,
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

/** @internal — argument values are stringified so `params` stays
 *  Record<string, string>, matching the legacy XML-attribute behavior
 *  (no type change for characterAction consumers). */
export function toCharacterAction(wire: WireClientAction): CharacterAction {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(wire.arguments ?? {})) {
    params[key] = String(value); // numbers via String(), booleans → "true"/"false"
  }
  return {
    name: wire.name,
    params,
    messageId: wire.message_id,
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

// ─── Share Types ────────────────────────────────────────────────

export interface ShareOpenResponse {
  sessionToken: string;
  characterId: string;
  playerId: string;
  serverUrl: string;
  character: CharacterInfo & { personality?: string | null };
}

// ─── Character Actions ───────────────────────────────────────────

/**
 * A character-defined in-world action, emitted as a `characterAction` event.
 * Delivered by the server as a typed `client_action` event (contract v1.9);
 * the legacy inline `<action/>` text-tag parser also produces these while it
 * remains during the deprecation window.
 */
export interface CharacterAction {
  /** Action name (e.g., "follow_user", "sit", "look_at") */
  name: string;
  /** Action parameters as key-value pairs (values always strings) */
  params: Record<string, string>;
  /** Message ID of the bot response turn that contained this action */
  messageId: string;
}

// ─── Scripted Lines ──────────────────────────────────────────────

/** A scripted line: plain text (uses the script's default textOnly) or an explicit override. */
export type ScriptLine = string | { text: string; textOnly?: boolean };

export interface ScriptOptions {
  /** Default for plain-string lines: false = TTS audio (default), true = text-only. */
  textOnly?: boolean;
  /** Pause inserted after each line completes, in ms (default 0). */
  lineGapMs?: number;
  /** Begin speaking immediately on creation (default true). If false, call play(). */
  autoStart?: boolean;
  /** Repeat from the first line after the last (default false). */
  loop?: boolean;
  /** Force-advance a line if no completion signal arrives within this many ms (default 30000). */
  lineTimeoutMs?: number;
}

export type ScriptEndReason = 'finished' | 'stopped' | 'disconnected' | 'interrupted';
export type ScriptState = 'idle' | 'playing' | 'paused' | 'done';

export interface ScriptLineStartedInfo {
  index: number;
  text: string;
  messageId: string;
}

/** Handle returned by EstuaryClient.playScript() / sayLines(). */
export interface ScriptController {
  readonly length: number;
  /** Index of the current / most-recently-started line (-1 before the first line starts). */
  readonly index: number;
  readonly state: ScriptState;
  /** Resolves (never rejects) when the script ends, with the reason. Awaitable. */
  readonly done: Promise<{ reason: ScriptEndReason }>;
  play(): void;
  pause(): void;
  resume(): void;
  next(): void;
  stop(): void;
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
  sessionTimeout: (data: SessionTimeoutData) => void;
  voiceTimeout: (data: VoiceTimeoutData) => void;
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
  scriptLineStarted: (info: ScriptLineStartedInfo) => void;
  scriptComplete: (info: { reason: ScriptEndReason }) => void;
};

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
