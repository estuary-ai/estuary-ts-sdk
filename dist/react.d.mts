import { MutableRefObject } from 'react';

interface EstuaryConfig {
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
    /** Opt in to SARAH bot_pose events for full-body cospeech animation (52-bone SMPL-X canonical quat frames; 22 body + 30 finger). Requires the active character to have a SARAH inference provider provisioned AND audioSampleRate=16000 (HuBERT 16 kHz gate). Default: false. See SDK_CONTRACT.md §body_animation_stream. */
    enableBodyAnimation?: boolean;
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
    /** Per-session client capability declaration. Tells the server what the device
     *  can physically do (camera, microphone, speaker). When omitted, the server
     *  defaults all fields to true for backward compatibility. Tools requiring a
     *  capability are hidden from the LLM when that capability is false (e.g.
     *  `request_camera_image` is suppressed when `camera: false`). */
    capabilities?: SessionCapabilities;
}
type VoiceTransport = 'websocket' | 'livekit' | 'auto';
/** Per-session client capability declaration. Pass on `EstuaryConfig.capabilities`. */
interface SessionCapabilities {
    /** Schema version. Defaults to "1" when omitted. */
    version?: string;
    /** Device has a camera the SDK can call `sendCameraImage()` against. */
    camera?: boolean;
    /** Device has a microphone usable for voice capture. */
    microphone?: boolean;
    /** Device has a speaker usable for TTS playback. */
    speaker?: boolean;
}
declare enum ConnectionState {
    Disconnected = "disconnected",
    Connecting = "connecting",
    Connected = "connected",
    Reconnecting = "reconnecting",
    Error = "error"
}
interface SessionInfo {
    sessionId: string;
    conversationId: string;
    characterId: string;
    playerId: string;
}
interface BotResponse {
    text: string;
    isFinal: boolean;
    partial: string;
    messageId: string;
    chunkIndex: number;
    isInterjection: boolean;
    tokenStream?: boolean;
}
interface BotVoice {
    audio?: string;
    messageId: string;
    chunkIndex: number;
    /** Sample rate (Hz) of the PCM in `audio`, from the worker's TTS output
     * (e.g. 24000). Must be used to PLAY the audio — distinct from the SDK's
     * configured `audioSampleRate` (the MIC-uplink rate). */
    sampleRate?: number;
    isFinal?: boolean;
    isLivekit?: boolean;
}
interface BotAnimation {
    messageId: string;
    sequence: number;
    timeCodeSec: number;
    fps: number;
    weights: Record<string, number>;
    emitEpochMs: number;
    isFinal: boolean;
}
/** Single bone in a SARAH bot_pose frame. `quat` is xyzw float32, right-hand convention, w >= 0. */
interface BoneQuat {
    name: string;
    quat: [number, number, number, number];
}
/**
 * SARAH cospeech body-motion frame (SDK_CONTRACT.md body_animation_stream).
 * 52 bones: 22 body + 30 finger. Stable-prefix invariant: bones[0..22] is
 * byte-identical to the legacy v10 22-bone wire so consumers without finger
 * Live Link can keep iterating bones.slice(0, 22).
 *
 * Terminator chunk: sequence === -1, bones === [], isFinal === true. Do NOT render.
 */
interface BotPose {
    messageId: string;
    sequence: number;
    timeCodeSec: number;
    fps: number;
    bones: BoneQuat[];
    hipsWorld: [number, number, number];
    hipsLocalToFloor: [number, number, number];
    emitEpochMs: number;
    isFinal: boolean;
}
interface SttResponse {
    text: string;
    isFinal: boolean;
}
interface InterruptData {
    messageId?: string;
    reason?: string;
    interruptedAt?: string;
}
interface QuotaExceededData {
    message: string;
    current: number;
    limit: number;
    remaining: number;
    tier: string;
}
interface CameraCaptureRequest {
    requestId: string;
    text?: string;
}
interface MemoryData {
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
interface MemoryUpdatedEvent {
    agentId: string;
    playerId: string;
    memoriesExtracted: number;
    factsExtracted: number;
    conversationId: string;
    newMemories: MemoryData[];
    timestamp: string;
}
interface CharacterInfo {
    id: string;
    name: string;
    tagline: string | null;
    avatar: string | null;
    modelUrl: string | null;
    modelPreviewUrl: string | null;
    modelStatus: string | null;
    sourceImageUrl: string | null;
}
interface ShareOpenResponse {
    sessionToken: string;
    characterId: string;
    playerId: string;
    serverUrl: string;
    character: CharacterInfo & {
        personality?: string | null;
    };
}
interface CharacterAction {
    /** Action name (e.g., "follow_user", "sit", "look_at") */
    name: string;
    /** Action parameters as key-value pairs */
    params: Record<string, string>;
    /** Message ID of the bot response that contained this action */
    messageId: string;
}
/** A scripted line: plain text (uses the script's default textOnly) or an explicit override. */
type ScriptLine = string | {
    text: string;
    textOnly?: boolean;
};
interface ScriptOptions {
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
type ScriptEndReason = 'finished' | 'stopped' | 'disconnected' | 'interrupted';
type ScriptState = 'idle' | 'playing' | 'paused' | 'done';
interface ScriptLineStartedInfo {
    index: number;
    text: string;
    messageId: string;
}
/** Handle returned by EstuaryClient.playScript() / sayLines(). */
interface ScriptController {
    readonly length: number;
    /** Index of the current / most-recently-started line (-1 before the first line starts). */
    readonly index: number;
    readonly state: ScriptState;
    /** Resolves (never rejects) when the script ends, with the reason. Awaitable. */
    readonly done: Promise<{
        reason: ScriptEndReason;
    }>;
    play(): void;
    pause(): void;
    resume(): void;
    next(): void;
    stop(): void;
}
type EstuaryEventMap = {
    connected: (session: SessionInfo) => void;
    disconnected: (reason: string) => void;
    reconnecting: (attempt: number) => void;
    connectionStateChanged: (state: ConnectionState) => void;
    botResponse: (response: BotResponse) => void;
    botVoice: (voice: BotVoice) => void;
    botAnimation: (frame: BotAnimation) => void;
    /** SARAH cospeech body-motion frame (52-bone). Requires enableBodyAnimation: true and a SARAH-provisioned character. */
    botPose: (frame: BotPose) => void;
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
    scriptLineStarted: (info: ScriptLineStartedInfo) => void;
    scriptComplete: (info: {
        reason: ScriptEndReason;
    }) => void;
};
interface MemoryListOptions {
    memoryType?: string;
    status?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'created_at' | 'confidence' | 'last_accessed_at';
    sortOrder?: 'asc' | 'desc';
}
interface MemoryTimelineOptions {
    startDate?: string;
    endDate?: string;
    groupBy?: 'day' | 'week' | 'month';
}
interface MemoryGraphOptions {
    includeEntities?: boolean;
    includeCharacterMemories?: boolean;
}
interface MemoryListResponse {
    memories: MemoryData[];
    total: number;
    limit: number;
    offset: number;
}
interface MemoryTimelineResponse {
    timeline: {
        date: string;
        memories: MemoryData[];
    }[];
    totalMemories: number;
    groupBy: string;
}
interface MemoryStatsResponse {
    totalActive: number;
    totalSuperseded: number;
    totalDecayed: number;
    byType: Record<string, number>;
    coreFacts: number;
}
interface MemoryGraphNode {
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
interface MemoryGraphEdge {
    source: string;
    target: string;
    type: 'has_cluster' | 'contains' | 'mentions' | 'relationship';
    relationshipType?: string;
    label?: string | null;
    confidence?: number;
}
interface MemoryGraphResponse {
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
interface MemorySearchResponse {
    results: {
        memory: MemoryData;
        score: number;
        similarityScore: number;
    }[];
    query: string;
    total: number;
}
interface CoreFact {
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
interface CoreFactsResponse {
    coreFacts: CoreFact[];
}

declare class RestClient {
    private baseUrl;
    private apiKey;
    private timeoutMs;
    constructor(baseUrl: string, apiKey: string, timeoutMs?: number);
    get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    delete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T>;
    dispose(): void;
    private buildUrl;
    private request;
}

declare class MemoryClient {
    private rest;
    private basePath;
    constructor(rest: RestClient, agentId: string, playerId: string);
    getMemories(options?: MemoryListOptions): Promise<MemoryListResponse>;
    getTimeline(options?: MemoryTimelineOptions): Promise<MemoryTimelineResponse>;
    getStats(): Promise<MemoryStatsResponse>;
    getCoreFacts(): Promise<CoreFactsResponse>;
    getGraph(options?: MemoryGraphOptions): Promise<MemoryGraphResponse>;
    search(query: string, limit?: number): Promise<MemorySearchResponse>;
    deleteAll(confirm: boolean): Promise<{
        message: string;
        deletedCount: number;
    }>;
    dispose(): void;
}

declare class TypedEventEmitter<T extends Record<string, unknown>> {
    private listeners;
    private onceListeners;
    on<K extends keyof T>(event: K, listener: T[K]): this;
    off<K extends keyof T>(event: K, listener: T[K]): this;
    once<K extends keyof T>(event: K, listener: T[K]): this;
    protected emit<K extends keyof T>(event: K, ...args: T[K] extends (...a: infer A) => void ? A : never[]): boolean;
    removeAllListeners<K extends keyof T>(event?: K): this;
    listenerCount<K extends keyof T>(event: K): number;
}

declare class EstuaryClient extends TypedEventEmitter<EstuaryEventMap> {
    private config;
    private logger;
    private socketManager;
    private voiceManager;
    private audioPlayer;
    private _memory;
    private _character;
    private _sessionInfo;
    private actionParsers;
    private _hasAutoInterrupted;
    private _autoInterruptGraceTimer;
    private _isLiveKitSpeaking;
    private _activeScript;
    constructor(config: EstuaryConfig);
    /** Memory API client for querying memories, graphs, and facts */
    get memory(): MemoryClient;
    /** Fetch character details including 3D model and avatar URLs. */
    getCharacter(characterId?: string): Promise<CharacterInfo>;
    /**
     * Open a permanent share link. Calls the backend's /open endpoint to mint a
     * fresh session token and resolve character metadata (including modelUrl).
     * Use the returned fields to construct an EstuaryClient with sessionToken auth.
     */
    static openShare(serverUrl: string, shareId: string): Promise<ShareOpenResponse>;
    /** Current session info (null if not connected) */
    get session(): SessionInfo | null;
    /** Current connection state */
    get connectionState(): ConnectionState;
    /** Whether the client is connected and authenticated */
    get isConnected(): boolean;
    /** Connect to the Estuary server and authenticate */
    connect(): Promise<SessionInfo>;
    /** Disconnect from the server */
    disconnect(): Promise<void>;
    /** Send a text message to the character. Defaults to textOnly=true (no TTS audio response). Pass textOnly=false to receive voice audio. */
    sendText(text: string, textOnly?: boolean): void;
    /** Script the character to say a specific prewritten line. Defaults to TTS enabled (textOnly=false). */
    sayLine(text: string, textOnly?: boolean): void;
    /**
     * Script a sequence of prewritten lines. Lines are paced so each finishes before the next
     * is sent — required because say_line interrupts any in-progress response server-side, so
     * unpaced lines would stomp each other. Returns a controller (play/pause/resume/next/stop +
     * an awaitable `done`). Starting a new script stops any currently-active one.
     */
    playScript(lines: ScriptLine[], opts?: ScriptOptions): ScriptController;
    /** Convenience alias of playScript() for fire-and-forget scripted sequences. */
    sayLines(lines: ScriptLine[], opts?: ScriptOptions): ScriptController;
    private createScriptHost;
    /** Interrupt the current bot response */
    interrupt(messageId?: string): void;
    /** Send a camera image for vision processing */
    sendCameraImage(imageBase64: string, mimeType: string, requestId?: string, text?: string): void;
    /** Update session preferences */
    updatePreferences(preferences: {
        enableVisionAcknowledgment?: boolean;
    }): void;
    /** Notify server that audio playback completed for a message */
    notifyAudioPlaybackComplete(messageId?: string): void;
    /**
     * Send the client's rest-pose quats so SARAH can compute retargeting deltas.
     * REQUIRED for body animation. MUST be called once per session, AFTER `connect()`
     * resolves and BEFORE the first sendText / startVoice / sayLine. The server-side
     * worker waits up to 200 ms for this at SARAH session-open time; late arrivals
     * are logged-and-ignored. See SDK_CONTRACT.md bind_pose for the canonical bone
     * names and quaternion convention (xyzw, w >= 0).
     */
    sendBindPose(bones: Record<string, [number, number, number, number]>): void;
    /**
     * Per-frame user floor-projected head position (paper p_y) for SARAH dyadic
     * conditioning. Coordinates are in meters in the agent's reference frame at
     * session start (agent at origin, looking down +z; +x is the agent's right).
     * Emit at ~30 Hz while voice is active. RPUSH'd onto sarah:user_stream:{session_id}
     * by the gateway and forwarded to SARAH PCM_USER + USER_POS by the worker.
     */
    sendUserPos(x: number, y: number): void;
    /** Start voice input (requests microphone permission) */
    startVoice(): Promise<void>;
    /** Stop voice input */
    stopVoice(): Promise<void>;
    /** Toggle microphone mute */
    toggleMute(): void;
    /** Whether the microphone is muted */
    get isMuted(): boolean;
    /**
     * Audio-clock elapsed time (seconds) for a specific bot message.
     *
     * Returns the actual amount of audio the user has heard for `messageId`,
     * derived from `AudioContext.currentTime` and capped at cumulative
     * buffered duration. Pauses during inter-chunk silence gaps. Consumers
     * that must stay synchronized with audible playback (e.g. body-animation
     * playhead) should use this instead of wall clock.
     *
     * Returns 0 if `messageId` isn't the currently-active message or audio
     * hasn't started playing yet. WebSocket transport only.
     */
    getAudioPlaybackTime(messageId: string): number;
    /**
     * MediaStream carrying decoded bot TTS playback (WebSocket transport only).
     *
     * Returns null until the first audio chunk arrives — the AudioContext and
     * MediaStreamDestination are created lazily on first enqueue. Consumers
     * should poll this getter (e.g. on `audioPlaybackStarted`) rather than
     * caching at session start.
     *
     * Intended for visualization / lipsync taps that need to inspect the audio
     * signal without owning the playback graph.
     */
    getPlaybackStream(): MediaStream | null;
    /** Whether mic suppression during playback is enabled */
    get suppressMicDuringPlayback(): boolean;
    /** Update mic suppression during playback at runtime (no reconnect needed) */
    set suppressMicDuringPlayback(enabled: boolean);
    /** Whether voice is currently active */
    get isVoiceActive(): boolean;
    private ensureConnected;
    /** Whether bot audio is currently playing (via AudioPlayer or LiveKit) */
    private get _isBotPlaying();
    /** Suppress auto-interrupt for 1500ms so trailing STT partials from the
     *  user's previous speech don't kill the new bot audio. */
    private startPlaybackGrace;
    private forwardSocketEvents;
    private handleBotResponse;
    private handleBotVoice;
    /** Compute RMS audio level (0-1) from base64-encoded Int16 PCM. */
    private computeAudioLevel;
    private maybeAutoInterrupt;
}

/**
 * Return value of `AnimationFrameBuffer.pairAt`.
 *
 * - `prev`: the last frame whose `timeCodeSec` is ≤ the query time, or `null`
 *   if the query is before the first buffered frame.
 * - `next`: the first frame whose `timeCodeSec` is strictly > the query time,
 *   or `null` if the query is at or past the last buffered frame.
 * - `alpha`: interpolation weight ∈ [0, 1].
 *   - 0 → use `prev` fully (query exactly at `prev.timeCodeSec`).
 *   - 1 → use `next` fully (query is past `prev` with no `next`).
 *   - Intermediate values when both `prev` and `next` are present.
 */
interface FramePair {
    prev: BotAnimation | null;
    next: BotAnimation | null;
    /** Interpolation weight in [0, 1]. */
    alpha: number;
}
/**
 * Constructor options for `AnimationFrameBuffer`.
 */
interface AnimationFrameBufferOptions {
    /**
     * GC window in seconds.
     * Frames whose `timeCodeSec` is strictly less than `(cursor - gcWindowSec)`
     * are removed by `gc(cursor)`.
     * Default: 0.5 s (≈15 frames at 30 fps).
     */
    gcWindowSec?: number;
}
/**
 * A sorted, GC-aware buffer of `BotAnimation` frames for audio-sync lookup.
 *
 * **Insertion** — O(log n) binary search to find position + O(n) `Array.splice`.
 * At 30 fps × 0.5 s GC window the buffer stays ≤ ~16 frames, well within
 * any render budget.
 *
 * **Lookup** — `pairAt(t)` returns the flanking pair of frames (prev, next)
 * and an interpolation weight alpha ∈ [0, 1].
 *
 * **GC** — Call `gc(tAudioSec)` on each clock tick (the hook does this) to
 * drop frames that have fallen behind the playback cursor.
 *
 * **Terminator frames** are never buffered: frames where `isFinal === true`
 * or `sequence === -1` are silently ignored on `insert`.
 */
declare class AnimationFrameBuffer {
    private readonly gcWindowSec;
    private frames;
    private _last;
    constructor(options?: AnimationFrameBufferOptions);
    /** Number of frames currently held in the buffer. */
    get length(): number;
    /**
     * The most recently inserted non-terminator frame.
     * Useful for observability / health checks.
     * Not used internally for time-indexed lookup.
     */
    get last(): BotAnimation | null;
    /**
     * Insert a frame into the buffer, maintaining ascending `timeCodeSec` order.
     *
     * Terminator frames (`isFinal === true` or `sequence === -1`) are silently
     * rejected — they carry no blendshape data and must never enter the time
     * index.
     *
     * Time complexity: O(log n) for binary search + O(n) for splice.
     */
    insert(frame: BotAnimation): void;
    /**
     * Look up the flanking pair of frames at audio time `tAudioSec`.
     *
     * Returns `{prev, next, alpha}`:
     * - `prev` is the latest frame with `timeCodeSec ≤ tAudioSec`.
     * - `next` is the earliest frame with `timeCodeSec > tAudioSec`.
     * - `alpha` is clamped to [0, 1]; no extrapolation past the last frame.
     *
     * Special cases:
     * - Empty buffer → `{prev: null, next: null, alpha: 0}`.
     * - Before first frame → `{prev: null, next: first, alpha: 0}`.
     * - After last frame → `{prev: last, next: null, alpha: 1}`.
     * - Exact match → `alpha = 0` (use `prev` fully).
     * - Two frames at same `timeCodeSec` → `alpha = 0` (avoids divide-by-zero).
     *
     * Time complexity: O(log n).
     */
    pairAt(tAudioSec: number): FramePair;
    /**
     * Drop frames that have fallen behind the audio cursor.
     *
     * Removes all frames whose `timeCodeSec` is strictly less than
     * `(tAudioSec - gcWindowSec)`. Frames at exactly the threshold are retained.
     *
     * Should be called once per render tick (the hook is responsible for timing).
     *
     * Time complexity: O(k + n) where k is the number of dropped frames.
     */
    gc(tAudioSec: number): void;
    /**
     * Empty the buffer completely.
     *
     * Use this when a new utterance starts or an interrupt arrives — clears all
     * buffered frames and resets the `last` accessor to `null`.
     */
    clear(): void;
}

/**
 * Liveness indicator for the animation stream.
 *
 * - `'idle'`      — no frames received yet, or buffer was cleared by an interrupt
 * - `'receiving'` — a frame arrived within the last `stallTimeoutMs` milliseconds
 * - `'stalled'`   — the hook has a `currentMessageId` but no frame has arrived for
 *                   longer than `stallTimeoutMs` (network hiccup / worker backlog)
 *
 * Consumers can use this to show a degraded-state UI indicator.
 */
type AnimationHealthStatus = 'idle' | 'receiving' | 'stalled';
/**
 * Options for `useAnimationStream`.
 */
interface UseAnimationStreamOptions {
    /** Connected EstuaryClient to subscribe to. */
    client: EstuaryClient;
    /**
     * Returns the current audio playback position in seconds (utterance-relative).
     *
     * **For LiveKit transport (HTMLAudioElement):**
     * `HTMLAudioElement.currentTime` resets to 0 on each new track, so it is already
     * utterance-relative. Pass `() => audioElement.currentTime`.
     *
     * **For WebSocket transport (AudioContext / Web Audio API):**
     * `AudioContext.currentTime` is an ABSOLUTE monotonic clock — it does NOT reset
     * between utterances. Subtract the time you captured when audio started playing:
     * ```ts
     * let utteranceStart = 0;
     * client.on('audioPlaybackStarted', () => {
     *   utteranceStart = audioCtx.currentTime;
     * });
     * const getClock = () => audioCtx.currentTime - utteranceStart;
     * ```
     *
     * The hook never reads `getClock` during event handling — it is only called
     * inside the GC interval tick. A throwing clock (e.g., `AudioContext` not yet
     * resumed on Safari) is caught and silently skipped for that tick.
     */
    getClock: () => number;
    /**
     * GC window passed to `AnimationFrameBuffer`.
     * Frames whose `timeCodeSec` falls more than `gcWindowSec` behind the current
     * clock reading are discarded on each GC tick.
     * Default: `0.5` seconds (≈ 15 frames at 30 fps).
     */
    gcWindowSec?: number;
    /**
     * Interval between GC ticks in milliseconds.
     * Default: `100` ms (10 Hz — sufficient for the dev harness requirement).
     */
    gcIntervalMs?: number;
    /**
     * Milliseconds without a frame before `healthStatus` flips to `'stalled'`.
     * Default: `500` ms.
     */
    stallTimeoutMs?: number;
}
/**
 * Return value of `useAnimationStream`.
 */
interface UseAnimationStreamReturn {
    /**
     * Stable ref to the internal `AnimationFrameBuffer`.
     *
     * Call `bufferRef.current.pairAt(getClock())` inside a `requestAnimationFrame`
     * loop to obtain the interpolation pair for the current playback position.
     * Reading the ref does NOT trigger React re-renders — that is the whole point.
     */
    bufferRef: MutableRefObject<AnimationFrameBuffer>;
    /**
     * The `messageId` of the most recently received (non-terminator) frame.
     * `null` before the first frame arrives or after an interrupt clears state.
     */
    currentMessageId: string | null;
    /**
     * Cumulative count of non-terminator frames inserted since mount.
     * Does NOT reset on interrupt — use as a liveness counter.
     */
    framesReceived: number;
    /**
     * Liveness indicator — see `AnimationHealthStatus` for the full state machine.
     */
    healthStatus: AnimationHealthStatus;
}
/**
 * Subscribe to `bot_animation` events and buffer frames for lipsync interpolation.
 *
 * The hook is deliberately re-render-minimal: the `AnimationFrameBuffer` lives in
 * a `useRef` and does NOT trigger re-renders on frame insertion. Only
 * `currentMessageId`, `framesReceived`, and `healthStatus` are React state — and
 * they change infrequently compared to the 30 fps frame rate.
 *
 * **NOTE: A2F gate** — Frames only arrive when the gateway session was created
 * with `audioSampleRate: 16000` AND the server has `ENABLE_A2F=true`. Without
 * both, the worker A2F pipeline is bypassed and no `bot_animation` events are
 * emitted. Set `enableAnimation: true` in `EstuaryConfig` to propagate the
 * `enable_animation` flag to the gateway.
 *
 * @example
 * ```tsx
 * // getClock for WebSocket transport (AudioContext):
 * const getClock = () => audioCtx.currentTime - utteranceStartRef.current;
 *
 * // getClock for LiveKit transport (HTMLAudioElement):
 * const getClock = () => audioElement.currentTime;
 *
 * const { bufferRef, currentMessageId, framesReceived, healthStatus } =
 *   useAnimationStream({ client, getClock });
 * ```
 */
declare function useAnimationStream(options: UseAnimationStreamOptions): UseAnimationStreamReturn;

export { type AnimationHealthStatus, type UseAnimationStreamOptions, type UseAnimationStreamReturn, useAnimationStream };
