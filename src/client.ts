import { SocketManager } from './connection/socket-manager';
import { createVoiceManager } from './voice/voice-manager';
import { RestClient } from './rest/rest-client';
import { MemoryClient } from './rest/memory-client';
import { CharacterClient } from './rest/character-client';
import { AudioPlayer } from './audio/audio-player';
import { TypedEventEmitter } from './utils/event-emitter';
import { Logger } from './utils/logger';
import { EstuaryError, ErrorCode } from './errors';
import {
  EstuaryConfig,
  EstuaryEventMap,
  ConnectionState,
  SessionInfo,
  CharacterInfo,
  ShareOpenResponse,
  BotResponse,
  BotVoice,
  SttResponse,
  VoiceManager,
  ScriptLine,
  ScriptOptions,
  ScriptController,
} from './types';
import { StreamingActionParser } from './utils/action-parser';
import { ScriptPlayer, type ScriptHost } from './scripting/script-player';

const DEFAULT_SAMPLE_RATE = 24000;
const REST_UNAVAILABLE_MESSAGE =
  'REST API not available with session token auth. Use a server-side proxy for REST calls.';

export class EstuaryClient extends TypedEventEmitter<EstuaryEventMap> {
  private config: EstuaryConfig;
  private logger: Logger;
  private socketManager: SocketManager;
  private voiceManager: VoiceManager | null = null;
  private audioPlayer: AudioPlayer | null = null;
  private _memory: MemoryClient | null = null;
  private _character: CharacterClient | null = null;
  private _sessionInfo: SessionInfo | null = null;
  private actionParsers = new Map<string, StreamingActionParser>();
  private _hasAutoInterrupted = false;
  private _autoInterruptGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private _isLiveKitSpeaking = false;
  private _activeScript: ScriptPlayer | null = null;

  constructor(config: EstuaryConfig) {
    super();

    if (!config.apiKey && !config.sessionToken) {
      throw new EstuaryError(
        ErrorCode.AUTH_FAILED,
        'Either apiKey or sessionToken must be provided',
      );
    }

    this.config = config;
    this.logger = new Logger(config.debug ?? false);
    this.socketManager = new SocketManager(config, this.logger);
    this.forwardSocketEvents();

    // REST clients require an apiKey. Session-token flows (share links) must
    // use a server-side proxy for any REST calls.
    if (config.apiKey) {
      const restClient = new RestClient(config.serverUrl, config.apiKey);
      this._memory = new MemoryClient(restClient, config.characterId, config.playerId);
      this._character = new CharacterClient(restClient);
    }
  }

  /** Memory API client for querying memories, graphs, and facts */
  get memory(): MemoryClient {
    if (!this._memory) {
      throw new EstuaryError(ErrorCode.NOT_CONNECTED, REST_UNAVAILABLE_MESSAGE);
    }
    return this._memory;
  }

  /** Fetch character details including 3D model and avatar URLs. */
  async getCharacter(characterId?: string): Promise<CharacterInfo> {
    if (!this._character) {
      throw new EstuaryError(ErrorCode.NOT_CONNECTED, REST_UNAVAILABLE_MESSAGE);
    }
    return this._character.getCharacter(characterId ?? this.config.characterId);
  }

  /**
   * Open a permanent share link. Calls the backend's /open endpoint to mint a
   * fresh session token and resolve character metadata (including modelUrl).
   * Use the returned fields to construct an EstuaryClient with sessionToken auth.
   */
  static async openShare(
    serverUrl: string,
    shareId: string,
  ): Promise<ShareOpenResponse> {
    const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/share/${shareId}/open`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new EstuaryError(
        ErrorCode.REST_ERROR,
        `Share open failed (${res.status}): ${detail}`,
      );
    }
    return res.json() as Promise<ShareOpenResponse>;
  }

  /** Current session info (null if not connected) */
  get session(): SessionInfo | null {
    return this._sessionInfo;
  }

  /** Current connection state */
  get connectionState(): ConnectionState {
    return this.socketManager.state;
  }

  /** Whether the client is connected and authenticated */
  get isConnected(): boolean {
    return this.socketManager.isConnected;
  }

  /** Connect to the Estuary server and authenticate */
  async connect(): Promise<SessionInfo> {
    this.logger.info('Connecting...');
    const session = await this.socketManager.connect();
    this._sessionInfo = session;
    return session;
  }

  /** Disconnect from the server */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting...');
    if (this._activeScript && this._activeScript.state !== 'done') {
      this._activeScript.stop();
    }
    this._activeScript = null;
    if (this._autoInterruptGraceTimer) {
      clearTimeout(this._autoInterruptGraceTimer);
      this._autoInterruptGraceTimer = null;
    }
    await this.stopVoice();
    this.audioPlayer?.dispose();
    this.audioPlayer = null;
    this.socketManager.disconnect();
    this._sessionInfo = null;
  }

  /** Send a text message to the character. Defaults to textOnly=true (no TTS audio response). Pass textOnly=false to receive voice audio. */
  sendText(text: string, textOnly = true): void {
    this.ensureConnected();
    this.socketManager.emitEvent('text', { text, textOnly });
  }

  /** Script the character to say a specific prewritten line. Defaults to TTS enabled (textOnly=false). */
  sayLine(text: string, textOnly = false): void {
    if (!text?.trim()) return;
    this.ensureConnected();
    this.socketManager.emitEvent('say_line', { text, text_only: textOnly });
  }

  /**
   * Script a sequence of prewritten lines. Lines are paced so each finishes before the next
   * is sent — required because say_line interrupts any in-progress response server-side, so
   * unpaced lines would stomp each other. Returns a controller (play/pause/resume/next/stop +
   * an awaitable `done`). Starting a new script stops any currently-active one.
   */
  playScript(lines: ScriptLine[], opts?: ScriptOptions): ScriptController {
    this.ensureConnected();
    if (this._activeScript && this._activeScript.state !== 'done') {
      this._activeScript.stop();
    }
    const player = new ScriptPlayer(this.createScriptHost(), lines, opts);
    this._activeScript = player;
    return player;
  }

  /** Convenience alias of playScript() for fire-and-forget scripted sequences. */
  sayLines(lines: ScriptLine[], opts?: ScriptOptions): ScriptController {
    return this.playScript(lines, opts);
  }

  private createScriptHost(): ScriptHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      sayLine(text, textOnly) {
        self.sayLine(text, textOnly);
      },
      interrupt() {
        self.interrupt();
      },
      on(event, listener) {
        self.on(event, listener);
        return self;
      },
      off(event, listener) {
        self.off(event, listener);
        return self;
      },
      get isConnected() {
        return self.isConnected;
      },
      get willPlayScriptedAudio() {
        return self.audioPlayer != null;
      },
      emitScriptLineStarted(info) {
        self.emit('scriptLineStarted', info);
      },
      emitScriptComplete(info) {
        self.emit('scriptComplete', info);
      },
      log(msg) {
        self.logger.debug(msg);
      },
    };
  }

  /** Interrupt the current bot response */
  interrupt(messageId?: string): void {
    this.ensureConnected();
    this.socketManager.emitEvent('client_interrupt', { message_id: messageId });
    this.audioPlayer?.setInterruptedMessageId(messageId ?? this.audioPlayer.playingMessageId);
    this.audioPlayer?.clear();
    this._hasAutoInterrupted = true;
    if (this._autoInterruptGraceTimer) {
      clearTimeout(this._autoInterruptGraceTimer);
      this._autoInterruptGraceTimer = null;
    }
    if (this.config.suppressMicDuringPlayback) {
      this.voiceManager?.setSuppressed?.(false);
    }
  }

  /** Send a camera image for vision processing */
  sendCameraImage(imageBase64: string, mimeType: string, requestId?: string, text?: string): void {
    this.ensureConnected();
    this.socketManager.emitEvent('camera_image', {
      image: imageBase64,
      mime_type: mimeType,
      request_id: requestId,
      text,
    });
  }

  /** Update session preferences */
  updatePreferences(preferences: { enableVisionAcknowledgment?: boolean }): void {
    this.ensureConnected();
    this.socketManager.emitEvent('update_preferences', preferences);
  }

  /** Notify server that audio playback completed for a message */
  notifyAudioPlaybackComplete(messageId?: string): void {
    this.ensureConnected();
    this.socketManager.emitEvent('audio_playback_complete', { message_id: messageId });
  }

  // ─── Voice ───────────────────────────────────────────────────

  /** Start voice input (requests microphone permission) */
  async startVoice(): Promise<void> {
    this.ensureConnected();

    if (this.voiceManager?.isActive) {
      throw new EstuaryError(ErrorCode.VOICE_ALREADY_ACTIVE, 'Voice is already active');
    }

    const transport = this.config.voiceTransport ?? 'auto';
    const sampleRate = this.config.audioSampleRate ?? DEFAULT_SAMPLE_RATE;

    const result = await createVoiceManager(transport, this.socketManager, sampleRate, this.logger);
    if (!result) {
      throw new EstuaryError(ErrorCode.VOICE_NOT_SUPPORTED, 'No voice transport available');
    }
    this.voiceManager = result.manager;

    // Set up audio player for bot voice responses (WebSocket only).
    // In LiveKit mode, audio arrives via WebRTC — the AudioPlayer's AudioContext
    // and HTMLAudioElement would compete for mobile audio resources.
    if (!this.audioPlayer && result.resolvedTransport === 'websocket' && typeof AudioContext !== 'undefined') {
      this.audioPlayer = new AudioPlayer(sampleRate, (event) => {
        if (event.type === 'started') {
          this.startPlaybackGrace();
          this.emit('audioPlaybackStarted', event.messageId);
          if (this.config.suppressMicDuringPlayback) {
            this.voiceManager?.setSuppressed?.(true);
          }
        } else if (event.type === 'complete') {
          this.emit('audioPlaybackComplete', event.messageId);
          this.emit('botAudioLevel', 0);
          this.notifyAudioPlaybackComplete(event.messageId);
          if (this.config.suppressMicDuringPlayback) {
            this.voiceManager?.setSuppressed?.(false);
          }
        }
      });
    }

    await this.voiceManager.start();

    // Wire LiveKit speaking state (participant attributes) to events
    this.voiceManager.setSpeakingStateCallback?.((speaking: boolean) => {
      this._isLiveKitSpeaking = speaking;
      if (speaking) {
        this.startPlaybackGrace();
        this.emit('audioPlaybackStarted', 'livekit-audio');
        if (this.config.suppressMicDuringPlayback) {
          this.voiceManager?.setSuppressed?.(true);
        }
      } else {
        this.emit('audioPlaybackComplete', 'livekit-audio');
        this.emit('botAudioLevel', 0);
        this.notifyAudioPlaybackComplete('livekit-audio');
        if (this.config.suppressMicDuringPlayback) {
          this.voiceManager?.setSuppressed?.(false);
        }
      }
    });
    // Wire LiveKit audio level to botAudioLevel event
    this.voiceManager.setAudioLevelCallback?.((level: number) => {
      this.emit('botAudioLevel', level);
    });

    this.emit('voiceStarted');
  }

  /** Stop voice input */
  async stopVoice(): Promise<void> {
    if (this.voiceManager?.isActive) {
      await this.voiceManager.stop();
      this.voiceManager.dispose();
      this.voiceManager = null;
      this._isLiveKitSpeaking = false;
      this.emit('voiceStopped');
    }
  }

  /**
   * Tear down voice state without requiring an active manager — used when the
   * server ends the session out from under us. Unlike stopVoice(), this also
   * disposes a manager whose transport already died (LiveKit room deleted →
   * isActive is false but the local mic track was never released).
   */
  private async releaseVoice(): Promise<void> {
    const manager = this.voiceManager;
    this.voiceManager = null;
    this._isLiveKitSpeaking = false;
    this.audioPlayer?.clear();
    if (!manager) return;
    try {
      if (manager.isActive) await manager.stop();
    } catch {
      // Server already tore the session down — continue local cleanup.
    }
    manager.dispose();
    this.emit('voiceStopped');
  }

  /** Toggle microphone mute */
  toggleMute(): void {
    if (!this.voiceManager?.isActive) {
      throw new EstuaryError(ErrorCode.VOICE_NOT_ACTIVE, 'Voice is not active');
    }
    this.voiceManager.toggleMute();
  }

  /** Whether the microphone is muted */
  get isMuted(): boolean {
    return this.voiceManager?.isMuted ?? false;
  }

  /** Whether mic suppression during playback is enabled */
  get suppressMicDuringPlayback(): boolean {
    return this.config.suppressMicDuringPlayback ?? false;
  }

  /** Update mic suppression during playback at runtime (no reconnect needed) */
  set suppressMicDuringPlayback(enabled: boolean) {
    this.config.suppressMicDuringPlayback = enabled;
    if (!this.voiceManager?.isActive) return;
    if (enabled && this._isBotPlaying) {
      this.voiceManager.setSuppressed?.(true);
    } else if (!enabled) {
      this.voiceManager.setSuppressed?.(false);
    }
  }

  /** Whether voice is currently active */
  get isVoiceActive(): boolean {
    return this.voiceManager?.isActive ?? false;
  }

  // ─── Internal ────────────────────────────────────────────────

  private ensureConnected(): void {
    if (!this.socketManager.isConnected) {
      throw new EstuaryError(ErrorCode.NOT_CONNECTED, 'Not connected to server. Call connect() first.');
    }
  }

  /** Whether bot audio is currently playing (via AudioPlayer or LiveKit) */
  private get _isBotPlaying(): boolean {
    return (this.audioPlayer?.playing ?? false) || this._isLiveKitSpeaking;
  }

  /** Suppress auto-interrupt for 1500ms so trailing STT partials from the
   *  user's previous speech don't kill the new bot audio. */
  private startPlaybackGrace(): void {
    this._hasAutoInterrupted = true;
    if (this._autoInterruptGraceTimer) clearTimeout(this._autoInterruptGraceTimer);
    this._autoInterruptGraceTimer = setTimeout(() => {
      this._hasAutoInterrupted = false;
      this._autoInterruptGraceTimer = null;
    }, 1500);
  }

  private forwardSocketEvents(): void {
    // Forward all socket manager events to this client's event emitter
    this.socketManager.on('connected', (session) => {
      this._sessionInfo = session;
      this.emit('connected', session);
    });
    this.socketManager.on('disconnected', (reason) => {
      this._sessionInfo = null;
      this.actionParsers.clear();
      this.emit('disconnected', reason);
    });
    this.socketManager.on('reconnecting', (attempt) => this.emit('reconnecting', attempt));
    this.socketManager.on('connectionStateChanged', (state) => this.emit('connectionStateChanged', state));
    this.socketManager.on('botResponse', (response) => this.handleBotResponse(response));
    this.socketManager.on('botVoice', (voice) => this.handleBotVoice(voice));
    this.socketManager.on('sttResponse', (response) => {
      this.maybeAutoInterrupt(response);
      this.emit('sttResponse', response);
    });
    this.socketManager.on('interrupt', (data) => {
      this.audioPlayer?.setInterruptedMessageId(data.messageId ?? null);
      this.audioPlayer?.clear();
      this.actionParsers.clear();
      if (this.config.suppressMicDuringPlayback) {
        this.voiceManager?.setSuppressed?.(false);
      }
      this.emit('interrupt', data);
    });
    this.socketManager.on('error', (error) => this.emit('error', error));
    this.socketManager.on('authError', (error) => this.emit('authError', error));
    this.socketManager.on('quotaExceeded', (data) => this.emit('quotaExceeded', data));
    this.socketManager.on('sessionTimeout', (data) => {
      // The server ended the session (idle reap) and disconnects right after.
      // Release voice resources now: a stale WebSocket manager stays isActive
      // (mic hot, next startVoice throws VOICE_ALREADY_ACTIVE) and a dead
      // LiveKit manager is never disposed. Resume = connect() + startVoice().
      void this.releaseVoice();
      this.emit('sessionTimeout', data);
    });
    this.socketManager.on('cameraCaptureRequest', (request) => this.emit('cameraCaptureRequest', request));
    this.socketManager.on('livekitConnected', (room) => this.emit('livekitConnected', room));
    this.socketManager.on('livekitDisconnected', () => this.emit('livekitDisconnected'));
    this.socketManager.on('memoryUpdated', (event) => this.emit('memoryUpdated', event));
  }

  private handleBotResponse(response: BotResponse): void {
    const { messageId } = response;

    // Get or create a parser for this message stream
    if (!this.actionParsers.has(messageId)) {
      this.actionParsers.set(messageId, new StreamingActionParser());
    }
    const parser = this.actionParsers.get(messageId)!;

    // Parse actions from accumulated text
    const { actions, cleanText } = parser.parse(response.text);

    // Emit characterAction events for newly discovered actions
    for (const action of actions) {
      this.emit('characterAction', {
        name: action.name,
        params: action.params,
        messageId,
      });
    }

    // Forward botResponse with cleaned text
    this.emit('botResponse', {
      ...response,
      text: cleanText,
    });

    // Clean up parser when message is final
    if (response.isFinal) {
      this.actionParsers.delete(messageId);
    }
  }

  private handleBotVoice(voice: BotVoice): void {
    this.emit('botVoice', voice);
    if (voice.audio) {
      // WebSocket transport — real audio data, AudioPlayer handles full lifecycle
      this.audioPlayer?.enqueue(voice);
      // Compute and emit audio level from PCM data
      this.emit('botAudioLevel', this.computeAudioLevel(voice.audio));
    }
    // LiveKit transport: metadata-only bot_voice events are ignored.
    // Speaking lifecycle is driven by participant attributes via
    // setSpeakingStateCallback in startVoice().
  }

  /** Compute RMS audio level (0-1) from base64-encoded Int16 PCM. */
  private computeAudioLevel(base64Audio: string): number {
    try {
      const binaryStr = atob(base64Audio);
      const len = binaryStr.length;
      // Sample every 8th sample for performance (voice chunks are small)
      const step = 16; // 8 samples * 2 bytes per Int16
      let sum = 0;
      let count = 0;
      for (let i = 0; i + 1 < len; i += step) {
        const sample = (binaryStr.charCodeAt(i) | (binaryStr.charCodeAt(i + 1) << 8));
        const signed = sample > 32767 ? sample - 65536 : sample;
        const normalized = signed / 32768;
        sum += normalized * normalized;
        count++;
      }
      if (count === 0) return 0;
      // RMS is typically 0-0.3 for speech; scale up to 0-1 range
      return Math.min(1, Math.sqrt(sum / count) * 5);
    } catch {
      return 0;
    }
  }

  private maybeAutoInterrupt(stt: SttResponse): void {
    if ((this.config.autoInterruptOnSpeech ?? true) === false) return;
    if (this.config.suppressMicDuringPlayback) return;
    if (stt.isFinal) return;
    if (!this._isBotPlaying) return;
    if (this._hasAutoInterrupted) return;

    this._hasAutoInterrupted = true;
    this.interrupt();
  }
}
