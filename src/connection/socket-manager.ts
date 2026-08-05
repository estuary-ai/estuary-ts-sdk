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
  WireSessionTimeoutData,
  WireVoiceTimeoutData,
  WireCameraCaptureRequest,
  WireLiveKitTokenResponse,
  WireMemoryUpdated,
  WireClientAction,
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
  toSessionTimeoutData,
  toVoiceTimeoutData,
  toCameraCaptureRequest,
  toLiveKitTokenResponse,
  toMemoryUpdatedEvent,
  toCharacterAction,
} from '../types';

export class SocketManager extends TypedEventEmitter<EstuaryEventMap> {
  private socket: Socket | null = null;
  private config: EstuaryConfig;
  private logger: Logger;
  private connectionState: ConnectionState = ConnectionState.Disconnected;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionInfo: SessionInfo | null = null;
  // Set by session_timeout: suppresses the auto-reconnect for the
  // server-initiated disconnect that immediately follows it.
  private serverEndedSession = false;
  // In-flight connect. Concurrent connect() calls (an explicit call racing
  // our own reconnect timer, or a page-resume racing the engine's death
  // detection) must share one attempt — the loser of that race would open a
  // second socket and leak a phantom billed session server-side.
  private connectPromise: Promise<SessionInfo> | null = null;
  private abortPendingConnect: ((err: EstuaryError) => void) | null = null;

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
    if (this.connectPromise) return this.connectPromise;
    if (this.socket?.connected && this.sessionInfo) {
      return Promise.resolve(this.sessionInfo);
    }

    // An explicit connect supersedes any scheduled reconnect retry — without
    // this, the pending timer fires later and opens a second socket.
    this.clearReconnectTimer();

    const promise = new Promise<SessionInfo>((resolve, reject) => {
      this.setConnectionState(ConnectionState.Connecting);
      this.serverEndedSession = false; // explicit connect overrides a prior idle timeout

      // Drop any previous (dead or zombie) socket before opening a new one.
      // Kept alive, its still-bound listeners would replay disconnect/error
      // events from the old transport into this manager's state.
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
      }

      const url = `${this.config.serverUrl}/sdk`;
      this.logger.debug('Connecting to', url);

      this.socket = io(url, {
        transports: ['websocket'],
        timeout: 10000,
        reconnection: false, // We handle reconnection ourselves
        path: '/socket.io/',
      });

      let settled = false;
      this.abortPendingConnect = (err: EstuaryError) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

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

        // Always sent, even when the app declares no device capabilities, because
        // `client_action` is a protocol capability of THIS SDK build rather than an
        // app-level choice: it tells the server this client understands typed
        // `client_action` events. Omit it and the server serves the retired XML
        // <action> tag path instead (SDK_CONTRACT v1.10), silently routing actions
        // to the dormant StreamingActionParser. Not user-overridable — the spread
        // is deliberately placed before it.
        // Device fields left absent still default to true server-side, so an app
        // that passes no capabilities is unaffected.
        authPayload.capabilities = {
          version: '1',
          ...this.config.capabilities,
          client_action: true,
        };

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

    this.connectPromise = promise;
    const clear = () => {
      if (this.connectPromise === promise) {
        this.connectPromise = null;
        this.abortPendingConnect = null;
      }
    };
    promise.then(clear, clear);
    return promise;
  }

  disconnect(): void {
    this.clearReconnectTimer();
    // Settle any in-flight connect — its socket listeners are removed below,
    // so left alone the promise would hang forever (and connect() would keep
    // handing the hung promise out).
    this.abortPendingConnect?.(
      new EstuaryError(ErrorCode.CONNECTION_FAILED, 'Connection attempt aborted by disconnect()'),
    );
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

    this.socket.on('session_timeout', (data: WireSessionTimeoutData) => {
      // Server-side idle reap (SDK_CONTRACT.md): the server disconnects this
      // socket right after. Flag it so handleDisconnect doesn't auto-reconnect —
      // re-authenticating would re-establish billed voice resources (LiveKit
      // pre-join, Deepgram) with nobody talking, in a loop.
      this.serverEndedSession = true;
      this.emit('sessionTimeout', toSessionTimeoutData(data));
    });

    this.socket.on('voice_timeout', (data: WireVoiceTimeoutData) => {
      // Voice-lane idle release (SDK_CONTRACT.md): the server released the
      // call's voice resources (LiveKit room deleted, STT closed) but KEEPS
      // this socket connected — no disconnect follows, so do NOT set
      // serverEndedSession. Text chat continues uninterrupted.
      this.emit('voiceTimeout', toVoiceTimeoutData(data));
    });

    this.socket.on('camera_capture', (data: WireCameraCaptureRequest) => {
      this.emit('cameraCaptureRequest', toCameraCaptureRequest(data));
    });

    this.socket.on('client_action', (data: WireClientAction) => {
      // Typed action delivery (SDK_CONTRACT.md client_action, v1.9). Replaces
      // the legacy inline <action/> tags parsed out of bot_response text.
      // Fire-on-arrival: not synchronized to TTS playback position.
      this.logger.debug('client_action:', data.name, data.arguments);
      this.emit('characterAction', toCharacterAction(data));
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

    // Server-initiated disconnects (idle-session timeout, quota kick) must
    // NOT auto-reconnect — this mirrors socket.io-client's own
    // 'io server disconnect' semantics, which we bypass by managing
    // reconnection ourselves. Resuming requires an explicit connect().
    const serverEnded = this.serverEndedSession || reason === 'io server disconnect';
    this.serverEndedSession = false;
    if (serverEnded) {
      this.logger.info('Server ended the session — not auto-reconnecting');
      return;
    }

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
        // A failed attempt rejects without ever reaching handleDisconnect,
        // so the next attempt must be scheduled from here. Skip it when the
        // rejection came from a manual disconnect() aborting the attempt
        // (state is Disconnected by the time this microtask runs).
        if (this.connectionState === ConnectionState.Disconnected) return;
        this.attemptReconnect();
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
