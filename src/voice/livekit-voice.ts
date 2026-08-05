import type { VoiceManager, LiveKitTokenResponse, AudioProcessingOptions } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';
import { EstuaryError, ErrorCode } from '../errors';

export class LiveKitVoiceManager implements VoiceManager {
  private socketManager: SocketManager;
  private logger: Logger;
  private room: any = null; // livekit-client Room (dynamically imported)
  private _isMuted = false;
  private _isSuppressed = false;
  private _isActive = false;
  private speakingStateCallback: ((speaking: boolean) => void) | null = null;
  private audioLevelCallback: ((level: number) => void) | null = null;

  // Audio level polling (via LiveKit's server-pushed participant.audioLevel)
  private botParticipant: any = null;
  private smoothedAudioLevel = 0;
  private audioLevelPollTimer: ReturnType<typeof setInterval> | null = null;
  private _isBotSpeaking = false;

  private audioProcessing?: AudioProcessingOptions;

  constructor(
    socketManager: SocketManager,
    logger: Logger,
    audioProcessing?: AudioProcessingOptions,
  ) {
    this.socketManager = socketManager;
    this.logger = logger;
    this.audioProcessing = audioProcessing;
  }

  get isMuted(): boolean {
    return this._isMuted;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  setSpeakingStateCallback(cb: (speaking: boolean) => void): void {
    this.speakingStateCallback = cb;
  }

  setAudioLevelCallback(cb: (level: number) => void): void {
    this.audioLevelCallback = cb;
  }

  async start(): Promise<void> {
    if (this._isActive) {
      throw new EstuaryError(ErrorCode.VOICE_ALREADY_ACTIVE, 'Voice is already active');
    }

    let Room: any;
    let RoomEvent: any;
    let Track: any;
    try {
      const lk = await import('livekit-client');
      Room = lk.Room;
      RoomEvent = lk.RoomEvent;
      Track = lk.Track;
    } catch {
      throw new EstuaryError(
        ErrorCode.LIVEKIT_UNAVAILABLE,
        'livekit-client package is not installed',
      );
    }

    // Request token from server
    const tokenData = await this.requestToken();

    // Create and configure room
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Mic DSP defaults follow WebRTC best practice (all on) for voice/STT;
      // consumers feeding raw audio to a model (SARAH body anim) can disable
      // AGC / noiseSuppression / voiceIsolation via config.audioProcessing while
      // keeping echoCancellation. Each field defaults to true when unset.
      audioCaptureDefaults: {
        echoCancellation: this.audioProcessing?.echoCancellation ?? true,
        noiseSuppression: this.audioProcessing?.noiseSuppression ?? true,
        autoGainControl: this.audioProcessing?.autoGainControl ?? true,
        voiceIsolation: this.audioProcessing?.voiceIsolation ?? true,
      },
    });

    // Handle remote audio tracks (bot audio)
    this.room.on(RoomEvent.TrackSubscribed, (
      track: any,
      _publication: any,
      participant: any,
    ) => {
      if (track.kind === Track.Kind.Audio) {
        this.logger.debug('Bot audio track subscribed from', participant.identity);
        const audioElement = track.attach();
        audioElement.autoplay = true;
        audioElement.style.display = 'none';
        if (typeof document !== 'undefined') {
          document.body.appendChild(audioElement);
        }
        audioElement.play().catch(() => {});

        // Store bot participant for audio level polling via participant.audioLevel
        this.botParticipant = participant;
        if (this._isBotSpeaking) {
          this.startAudioLevelPolling();
        }
      }
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
      if (track.kind === Track.Kind.Audio) {
        this.stopAudioLevelPolling();
        this.botParticipant = null;
        this.smoothedAudioLevel = 0;
        track.detach().forEach((el: HTMLMediaElement) => el.remove());
      }
    });

    this.room.on(RoomEvent.Disconnected, () => {
      this.logger.debug('LiveKit room disconnected');
      this._isActive = false;
      this._isBotSpeaking = false;
      this.stopAudioLevelPolling();
      this.botParticipant = null;
      this.smoothedAudioLevel = 0;
      this.speakingStateCallback?.(false);
    });

    // Connect to room
    try {
      await this.room.connect(tokenData.url, tokenData.token);
      this.logger.debug('Connected to LiveKit room:', tokenData.room);
    } catch (err) {
      this.room = null;
      const reason = err instanceof Error ? `: ${err.message}` : '';
      throw new EstuaryError(
        ErrorCode.CONNECTION_FAILED,
        `Failed to connect to LiveKit room${reason}`,
        err,
      );
    }

    // Listen for participant attribute changes (speaking state from backend)
    this.room.on(RoomEvent.ParticipantAttributesChanged,
      (changedAttributes: Record<string, string>, participant: any) => {
        if (participant === this.room?.localParticipant) return;
        const state = changedAttributes['estuary.state'];
        if (state === 'speaking') {
          this._isBotSpeaking = true;
          this.speakingStateCallback?.(true);
          this.startAudioLevelPolling();
        } else if (state === 'idle') {
          this._isBotSpeaking = false;
          this.stopAudioLevelPolling();
          this.speakingStateCallback?.(false);
          this.audioLevelCallback?.(0);
        }
      }
    );

    // Enable microphone
    try {
      await this.room.localParticipant.setMicrophoneEnabled(true);
      this.logger.debug('Microphone enabled');
    } catch (err) {
      this.room.disconnect();
      this.room = null;
      const reason = err instanceof Error ? `: ${err.message}` : '';
      throw new EstuaryError(
        ErrorCode.MICROPHONE_DENIED,
        `Failed to enable microphone${reason}`,
        err,
      );
    }

    // Notify backend and wait for it to confirm LiveKit audio routing is ready
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.socketManager.off('livekitConnected', onReady);
        // Don't fail — proceed anyway, audio may route via Socket.IO fallback
        this.logger.warn('Timed out waiting for livekit_ready, proceeding');
        resolve();
      }, 5000);

      const onReady = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.socketManager.once('livekitConnected', onReady);
      this.socketManager.emitEvent('livekit_join', { room: tokenData.room });
    });

    this._isActive = true;
    this.logger.debug('LiveKit voice started');
  }

  async stop(): Promise<void> {
    if (!this._isActive) return;

    try {
      this.socketManager.emitEvent('livekit_leave');
    } catch {
      // May not be connected
    }

    this._isBotSpeaking = false;
    this.stopAudioLevelPolling();
    this.botParticipant = null;
    this.smoothedAudioLevel = 0;

    // Fire final "stopped" if bot was considered speaking
    this.speakingStateCallback?.(false);

    if (this.room) {
      // Stop local tracks
      for (const [, publication] of this.room.localParticipant.trackPublications) {
        if (publication.track) {
          publication.track.stop();
        }
      }
      this.room.disconnect();
      this.room = null;
    }

    this._isActive = false;
    this._isMuted = false;
    this._isSuppressed = false;
    this.logger.debug('LiveKit voice stopped');
  }

  toggleMute(): void {
    if (!this._isActive || !this.room) return;
    this._isMuted = !this._isMuted;
    this.updateTrackEnabled();
    this.logger.debug('Mute toggled:', this._isMuted);
  }

  setSuppressed(suppressed: boolean): void {
    this._isSuppressed = suppressed;
    this.updateTrackEnabled();
    this.logger.debug('Audio suppression:', suppressed ? 'on' : 'off');
  }

  dispose(): void {
    this.speakingStateCallback = null;
    this.audioLevelCallback = null;
    this._isBotSpeaking = false;
    this.stopAudioLevelPolling();
    this.botParticipant = null;
    this.smoothedAudioLevel = 0;

    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    this._isActive = false;
    this._isMuted = false;
    this._isSuppressed = false;
  }

  /** Mute/unmute the local audio track directly via MediaStreamTrack.enabled.
   *  This avoids setMicrophoneEnabled() which publishes/unpublishes the track
   *  through the LiveKit server and can fail with engine timeout errors. */
  private updateTrackEnabled(): void {
    if (!this.room) return;
    const enabled = !this._isMuted && !this._isSuppressed;
    for (const [, publication] of this.room.localParticipant.audioTrackPublications) {
      if (publication.track?.mediaStreamTrack) {
        publication.track.mediaStreamTrack.enabled = enabled;
      }
    }
  }

  // ─── Audio Level Polling (participant.audioLevel) ───────────────

  private startAudioLevelPolling(): void {
    if (this.audioLevelPollTimer !== null) return;
    if (!this.botParticipant) return;

    // EMA smoothing: alpha=0.35 at 30fps reaches ~87% of step change in ~165ms
    const alpha = 0.35;

    this.audioLevelPollTimer = setInterval(() => {
      if (!this.botParticipant) {
        this.stopAudioLevelPolling();
        return;
      }
      const raw = this.botParticipant.audioLevel ?? 0;
      this.smoothedAudioLevel += alpha * (raw - this.smoothedAudioLevel);
      this.audioLevelCallback?.(this.smoothedAudioLevel);
    }, 33);
  }

  private stopAudioLevelPolling(): void {
    if (this.audioLevelPollTimer !== null) {
      clearInterval(this.audioLevelPollTimer);
      this.audioLevelPollTimer = null;
    }
    this.smoothedAudioLevel = 0;
  }

  // ─── Private ────────────────────────────────────────────────────

  private requestToken(): Promise<LiveKitTokenResponse> {
    return new Promise<LiveKitTokenResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socketManager.onLiveKitToken(() => {}); // clear callback
        reject(new EstuaryError(
          ErrorCode.CONNECTION_TIMEOUT,
          'Timed out waiting for LiveKit token',
        ));
      }, 10000);

      this.socketManager.onLiveKitToken((data: LiveKitTokenResponse) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.socketManager.emitEvent('livekit_token');
    });
  }
}
