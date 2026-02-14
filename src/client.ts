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
  BotVoice,
  VoiceManager,
} from './types';

const DEFAULT_SAMPLE_RATE = 16000;

export class EstuaryClient extends TypedEventEmitter<EstuaryEventMap> {
  private config: EstuaryConfig;
  private logger: Logger;
  private socketManager: SocketManager;
  private voiceManager: VoiceManager | null = null;
  private audioPlayer: AudioPlayer | null = null;
  private _memory: MemoryClient;
  private _sessionInfo: SessionInfo | null = null;

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
  disconnect(): void {
    this.logger.info('Disconnecting...');
    this.stopVoice();
    this.audioPlayer?.dispose();
    this.audioPlayer = null;
    this.socketManager.disconnect();
    this._sessionInfo = null;
  }

  /** Send a text message to the character */
  sendText(text: string, textOnly = false): void {
    this.ensureConnected();
    this.socketManager.emitEvent('text', { text, textOnly });
  }

  /** Interrupt the current bot response */
  interrupt(messageId?: string): void {
    this.ensureConnected();
    this.socketManager.emitEvent('client_interrupt', { message_id: messageId });
    this.audioPlayer?.clear();
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

    this.voiceManager = createVoiceManager(transport, this.socketManager, sampleRate, this.logger);
    if (!this.voiceManager) {
      throw new EstuaryError(ErrorCode.VOICE_NOT_SUPPORTED, 'No voice transport available');
    }

    // Set up audio player for bot voice responses (browser only)
    if (!this.audioPlayer && typeof AudioContext !== 'undefined') {
      this.audioPlayer = new AudioPlayer(sampleRate, (event) => {
        if (event.type === 'started') {
          this.emit('audioPlaybackStarted', event.messageId);
        } else if (event.type === 'complete') {
          this.emit('audioPlaybackComplete', event.messageId);
          this.notifyAudioPlaybackComplete(event.messageId);
        }
      });
    }

    await this.voiceManager.start();
    this.emit('voiceStarted');
  }

  /** Stop voice input */
  stopVoice(): void {
    if (this.voiceManager?.isActive) {
      this.voiceManager.stop();
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
      this.emit('disconnected', reason);
    });
    this.socketManager.on('reconnecting', (attempt) => this.emit('reconnecting', attempt));
    this.socketManager.on('connectionStateChanged', (state) => this.emit('connectionStateChanged', state));
    this.socketManager.on('botResponse', (response) => this.emit('botResponse', response));
    this.socketManager.on('botVoice', (voice) => this.handleBotVoice(voice));
    this.socketManager.on('sttResponse', (response) => this.emit('sttResponse', response));
    this.socketManager.on('interrupt', (data) => {
      this.audioPlayer?.clear();
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

  private handleBotVoice(voice: BotVoice): void {
    this.emit('botVoice', voice);
    // Enqueue audio for playback if we have an audio player
    this.audioPlayer?.enqueue(voice);
  }
}
