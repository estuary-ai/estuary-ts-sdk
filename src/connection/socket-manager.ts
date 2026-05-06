import { io, Socket } from 'socket.io-client';
import { TypedEventEmitter } from '../utils/event-emitter';
import { Logger } from '../utils/logger';
import { EstuaryError, ErrorCode } from '../errors';
import {
  EstuaryConfig,
  EstuaryEventMap,
  ConnectionState,
  WireSessionInfo,
  WireBotResponse,
  WireBotVoice,
  WireBotAnimation,
  WireBotPose,
  WireSttResponse,
  WireInterruptData,
  WireQuotaExceededData,
  WireCameraCaptureRequest,
  WireLiveKitTokenResponse,
  WireMemoryUpdated,
  SessionInfo,
  LiveKitTokenResponse,
  toSessionInfo,
  toBotResponse,
  toBotVoice,
  toBotAnimation,
  toBotPose,
  toSttResponse,
  toInterruptData,
  toQuotaExceededData,
  toCameraCaptureRequest,
  toLiveKitTokenResponse,
  toMemoryUpdatedEvent,
} from '../types';

export class SocketManager extends TypedEventEmitter<EstuaryEventMap> {
  private socket: Socket | null = null;
  private config: EstuaryConfig;
  private logger: Logger;
  private connectionState: ConnectionState = ConnectionState.Disconnected;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionInfo: SessionInfo | null = null;

  constructor(config: EstuaryConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  get session(): SessionInfo | null {
    return this.sessionInfo;
  }

  get isConnected(): boolean {
    return this.connectionState === ConnectionState.Connected;
  }

  get rawSocket(): Socket | null {
    return this.socket;
  }

  connect(): Promise<SessionInfo> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        if (this.sessionInfo) {
          resolve(this.sessionInfo);
          return;
        }
      }

      this.setConnectionState(ConnectionState.Connecting);
      this.reconnectAttempt = 0;

      const url = `${this.config.serverUrl}/sdk`;
      this.logger.debug('Connecting to', url);

      this.socket = io(url, {
        transports: ['websocket'],
        timeout: 10000,
        reconnection: false, // We handle reconnection ourselves
        path: '/socket.io/',
      });

      let settled = false;

      const onConnect = () => {
        this.logger.debug('Socket connected, authenticating...');
        const authPayload: Record<string, unknown> = {
          character_id: this.config.characterId,
          player_id: this.config.playerId,
          audio_sample_rate: this.config.audioSampleRate ?? 24000,
          enable_animation: this.config.enableAnimation ?? false,
          enable_body_animation: this.config.enableBodyAnimation ?? false,
          realtime_memory: this.config.realtimeMemory ?? false,
        };

        if (this.config.sessionToken) {
          authPayload.api_key = this.config.sessionToken;  // Backend resolves sst_ prefix
        } else if (this.config.apiKey) {
          authPayload.api_key = this.config.apiKey;
        }

        this.socket!.emit('authenticate', authPayload);
      };

      const onSessionInfo = (data: WireSessionInfo) => {
        this.sessionInfo = toSessionInfo(data);
        this.setConnectionState(ConnectionState.Connected);
        this.reconnectAttempt = 0;
        this.logger.info('Connected, session:', this.sessionInfo.sessionId);
        this.emit('connected', this.sessionInfo);
        if (!settled) {
          settled = true;
          resolve(this.sessionInfo);
        }
      };

      const onAuthError = (data: { error: string }) => {
        this.logger.error('Auth error:', data.error);
        this.setConnectionState(ConnectionState.Error);
        this.emit('authError', data.error);
        if (!settled) {
          settled = true;
          reject(new EstuaryError(ErrorCode.AUTH_FAILED, data.error));
        }
      };

      const onConnectError = (err: Error) => {
        this.logger.error('Connection error:', err.message);
        if (!settled) {
          settled = true;
          this.setConnectionState(ConnectionState.Error);
          reject(new EstuaryError(ErrorCode.CONNECTION_FAILED, err.message));
        } else {
          this.handleDisconnect('connect_error');
        }
      };

      const onDisconnect = (reason: string) => {
        this.logger.info('Disconnected:', reason);
        this.sessionInfo = null;
        if (!settled) {
          settled = true;
          this.setConnectionState(ConnectionState.Disconnected);
          reject(new EstuaryError(ErrorCode.CONNECTION_FAILED, `Disconnected: ${reason}`));
        } else {
          this.handleDisconnect(reason);
        }
      };

      this.socket.on('connect', onConnect);
      this.socket.on('session_info', onSessionInfo);
      this.socket.on('auth_error', onAuthError);
      this.socket.on('connect_error', onConnectError);
      this.socket.on('disconnect', onDisconnect);

      // Wire up all server → client events
      this.bindServerEvents();
    });
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.sessionInfo = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.setConnectionState(ConnectionState.Disconnected);
    this.emit('disconnected', 'manual');
  }

  emitEvent(event: string, data?: unknown): void {
    if (!this.socket?.connected) {
      throw new EstuaryError(ErrorCode.NOT_CONNECTED, 'Not connected to server');
    }
    this.socket.emit(event, data);
  }

  private bindServerEvents(): void {
    if (!this.socket) return;

    this.socket.on('bot_response', (data: WireBotResponse) => {
      this.emit('botResponse', toBotResponse(data));
    });

    this.socket.on('bot_voice', (data: WireBotVoice) => {
      this.emit('botVoice', toBotVoice(data));
    });

    this.socket.on('bot_animation', (data: WireBotAnimation) => {
      this.emit('botAnimation', toBotAnimation(data));
    });

    this.socket.on('bot_pose', (data: WireBotPose) => {
      this.emit('botPose', toBotPose(data));
    });

    this.socket.on('stt_response', (data: WireSttResponse) => {
      this.emit('sttResponse', toSttResponse(data));
    });

    this.socket.on('interrupt', (data: WireInterruptData) => {
      this.emit('interrupt', toInterruptData(data));
    });

    this.socket.on('quota_exceeded', (data: WireQuotaExceededData) => {
      this.emit('quotaExceeded', toQuotaExceededData(data));
    });

    this.socket.on('camera_capture', (data: WireCameraCaptureRequest) => {
      this.emit('cameraCaptureRequest', toCameraCaptureRequest(data));
    });

    this.socket.on('error', (data: { message: string }) => {
      this.emit('error', new EstuaryError(ErrorCode.UNKNOWN, data.message));
    });

    this.socket.on('livekit_token', (data: WireLiveKitTokenResponse) => {
      // This is handled by LiveKitVoiceManager via a separate listener
      // We store it here so the voice manager can access it
      (this as unknown as { _livekitTokenCallback?: (d: LiveKitTokenResponse) => void })
        ._livekitTokenCallback?.(toLiveKitTokenResponse(data));
    });

    this.socket.on('livekit_ready', (data: { room: string }) => {
      this.emit('livekitConnected', data.room);
    });

    this.socket.on('memory_updated', (data: WireMemoryUpdated) => {
      this.emit('memoryUpdated', toMemoryUpdatedEvent(data));
    });
  }

  /** Register a callback for livekit_token events (used by LiveKitVoiceManager) */
  onLiveKitToken(callback: (data: LiveKitTokenResponse) => void): void {
    (this as unknown as { _livekitTokenCallback?: (d: LiveKitTokenResponse) => void })
      ._livekitTokenCallback = callback;
  }

  private handleDisconnect(reason: string): void {
    this.sessionInfo = null;
    this.setConnectionState(ConnectionState.Disconnected);
    this.emit('disconnected', reason);

    const autoReconnect = this.config.autoReconnect ?? true;
    const maxAttempts = this.config.maxReconnectAttempts ?? 5;

    if (autoReconnect && this.reconnectAttempt < maxAttempts) {
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 5;
    const delay = this.config.reconnectDelayMs ?? 2000;

    if (this.reconnectAttempt >= maxAttempts) {
      this.logger.warn('Max reconnect attempts reached');
      this.setConnectionState(ConnectionState.Error);
      this.emit('error', new EstuaryError(
        ErrorCode.CONNECTION_FAILED,
        `Failed to reconnect after ${maxAttempts} attempts`,
      ));
      return;
    }

    this.reconnectAttempt++;
    this.setConnectionState(ConnectionState.Reconnecting);
    this.emit('reconnecting', this.reconnectAttempt);
    this.logger.info(`Reconnecting (attempt ${this.reconnectAttempt}/${maxAttempts})...`);

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error('Reconnect failed:', err.message);
        // Will trigger another attempt via handleDisconnect
      });
    }, delay * this.reconnectAttempt); // Linear backoff: delay * attempt
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionStateChanged', state);
    }
  }
}
