import { SocketManager } from './connection/socket-manager';
import { createVoiceManager } from './voice/voice-manager';
import { RestClient } from './rest/rest-client';
import { MemoryClient } from './rest/memory-client';
import { AudioPlayer } from './audio/audio-player';
import { TypedEventEmitter } from './utils/event-emitter';
import { Logger } from './utils/logger';
import { EstuaryError, ErrorCode } from './errors';
import {
  EstuaryConfig,
  EstuaryEventMap,
  ConnectionState,
  SessionInfo,
  BotResponse,
  BotVoice,
  SttResponse,
  VoiceManager,
} from './types';
import { StreamingActionParser } from './utils/action-parser';

const DEFAULT_SAMPLE_RATE = 16000;

export class EstuaryClient extends TypedEventEmitter<EstuaryEventMap> {
  private config: EstuaryConfig;
  private logger: Logger;
  private socketManager: SocketManager;
  private voiceManager: VoiceManager | null = null;
  private audioPlayer: AudioPlayer | null = null;
  private _memory: MemoryClient;
  private _sessionInfo: SessionInfo | null = null;
  private actionParsers = new Map<string, StreamingActionParser>();
  private _hasAutoInterrupted = false;
  private _autoInterruptGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** MessageId currently playing via LiveKit (bypasses AudioPlayer) */
  private _livekitPlayingMessageId: string | null = null;
  /** Drain timer for LiveKit playback — fires after bot_voice events stop arriving */
  private _livekitDrainTimer: ReturnType<typeof setTimeout> | null = null;
  /** How long to wait after the last bot_voice metadata before declaring LiveKit playback complete (ms).
   *  Longer than AudioPlayer's 300ms because LiveKit has additional buffering. */
  private static readonly LIVEKIT_DRAIN_DELAY_MS = 2000;

  constructor(config: EstuaryConfig) {
    super();
    this.config = config;
    this.logger = new Logger(config.debug ?? false);
    this.socketManager = new SocketManager(config, this.logger);
    this.forwardSocketEvents();

    // Set up REST client for memory API
    const restClient = new RestClient(config.serverUrl, config.apiKey);
    this._memory = new MemoryClient(restClient, config.characterId, config.playerId);
  }

  /** Memory API client for querying memories, graphs, and facts */
  get memory(): MemoryClient {
    return this._memory;
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
    if (this._autoInterruptGraceTimer) {
      clearTimeout(this._autoInterruptGraceTimer);
      this._autoInterruptGraceTimer = null;
    }
    this.cancelLivekitDrain();
    this._livekitPlayingMessageId = null;
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

  /** Interrupt the current bot response */
  interrupt(messageId?: string): void {
    this.ensureConnected();
    this.socketManager.emitEvent('client_interrupt', { message_id: messageId });
    this.audioPlayer?.setInterruptedMessageId(messageId ?? this.audioPlayer.playingMessageId);
    this.audioPlayer?.clear();
    this.cancelLivekitDrain();
    this._livekitPlayingMessageId = null;
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

    this.voiceManager = await createVoiceManager(transport, this.socketManager, sampleRate, this.logger);
    if (!this.voiceManager) {
      throw new EstuaryError(ErrorCode.VOICE_NOT_SUPPORTED, 'No voice transport available');
    }

    // Set up audio player for bot voice responses (browser only)
    if (!this.audioPlayer && typeof AudioContext !== 'undefined') {
      this.audioPlayer = new AudioPlayer(sampleRate, (event) => {
        if (event.type === 'started') {
          this.startPlaybackGrace();
          this.emit('audioPlaybackStarted', event.messageId);
          if (this.config.suppressMicDuringPlayback) {
            this.voiceManager?.setSuppressed?.(true);
          }
        } else if (event.type === 'complete') {
          this.emit('audioPlaybackComplete', event.messageId);
          this.notifyAudioPlaybackComplete(event.messageId);
          if (this.config.suppressMicDuringPlayback) {
            this.voiceManager?.setSuppressed?.(false);
          }
        }
      });
    }

    await this.voiceManager.start();
    this.emit('voiceStarted');
  }

  /** Stop voice input */
  async stopVoice(): Promise<void> {
    if (this.voiceManager?.isActive) {
      await this.voiceManager.stop();
      this.voiceManager.dispose();
      this.voiceManager = null;
      this.emit('voiceStopped');
    }
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
  set suppressMicDuringPlayback(value: boolean) {
    this.config.suppressMicDuringPlayback = value;
    // Apply immediately if voice is active and bot is currently playing
    if (this.voiceManager?.isActive) {
      if (value && this._isBotPlaying) {
        this.voiceManager.setSuppressed?.(true);
      } else if (!value) {
        this.voiceManager.setSuppressed?.(false);
      }
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
      this.cancelLivekitDrain();
      this._livekitPlayingMessageId = null;
      this.actionParsers.clear();
      if (this.config.suppressMicDuringPlayback) {
        this.voiceManager?.setSuppressed?.(false);
      }
      this.emit('interrupt', data);
    });
    this.socketManager.on('error', (error) => this.emit('error', error));
    this.socketManager.on('authError', (error) => this.emit('authError', error));
    this.socketManager.on('quotaExceeded', (data) => this.emit('quotaExceeded', data));
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

    // LiveKit metadata-only event (audio delivered via LiveKit media track, not socket)
    if (voice.isLivekit || !voice.audio) {
      if (voice.messageId !== this._livekitPlayingMessageId) {
        // Complete previous message if any
        if (this._livekitPlayingMessageId) {
          this.cancelLivekitDrain();
          this.endLivekitPlayback();
        }
        // Signal new playback start
        this._livekitPlayingMessageId = voice.messageId;
        this.startPlaybackGrace();
        this.emit('audioPlaybackStarted', voice.messageId);
        if (this.config.suppressMicDuringPlayback) {
          this.voiceManager?.setSuppressed?.(true);
        }
      }
      // Reset drain timer — more audio chunks are still arriving
      this.scheduleLivekitDrain();
      return;
    }

    // Standard WebSocket audio path — enqueue PCM data for local playback
    this.audioPlayer?.enqueue(voice);
  }

  /** Whether bot audio is currently playing (via AudioPlayer or LiveKit) */
  private get _isBotPlaying(): boolean {
    return (this.audioPlayer?.playing ?? false) || this._livekitPlayingMessageId !== null;
  }

  /** Start the auto-interrupt grace period */
  private startPlaybackGrace(): void {
    this._hasAutoInterrupted = true;
    if (this._autoInterruptGraceTimer) clearTimeout(this._autoInterruptGraceTimer);
    this._autoInterruptGraceTimer = setTimeout(() => {
      this._hasAutoInterrupted = false;
      this._autoInterruptGraceTimer = null;
    }, 1500);
  }

  /** Schedule the LiveKit drain timer — ends playback after bot_voice events stop */
  private scheduleLivekitDrain(): void {
    this.cancelLivekitDrain();
    this._livekitDrainTimer = setTimeout(() => {
      this._livekitDrainTimer = null;
      this.endLivekitPlayback();
    }, EstuaryClient.LIVEKIT_DRAIN_DELAY_MS);
  }

  private cancelLivekitDrain(): void {
    if (this._livekitDrainTimer) {
      clearTimeout(this._livekitDrainTimer);
      this._livekitDrainTimer = null;
    }
  }

  /** End LiveKit playback tracking and emit complete + unsuppress */
  private endLivekitPlayback(): void {
    this.cancelLivekitDrain();
    const messageId = this._livekitPlayingMessageId;
    if (!messageId) return;
    this._livekitPlayingMessageId = null;
    this.emit('audioPlaybackComplete', messageId);
    this.notifyAudioPlaybackComplete(messageId);
    if (this.config.suppressMicDuringPlayback) {
      this.voiceManager?.setSuppressed?.(false);
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
