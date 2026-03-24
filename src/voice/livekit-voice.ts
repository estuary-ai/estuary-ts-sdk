import type { VoiceManager, LiveKitTokenResponse } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';
import { EstuaryError, ErrorCode } from '../errors';

export class LiveKitVoiceManager implements VoiceManager {
  private socketManager: SocketManager;
  private logger: Logger;
  private room: any = null; // livekit-client Room (dynamically imported)
  private _isMuted = false;
  private _isActive = false;
  private speakingStateCallback: ((speaking: boolean) => void) | null = null;
  private audioLevelCallback: ((level: number) => void) | null = null;

  // Audio analyser (via livekit-client's createAudioAnalyser)
  private calculateVolume: (() => number) | null = null;
  private analyserCleanup: (() => Promise<void>) | null = null;
  private audioLevelPollTimer: ReturnType<typeof setInterval> | null = null;
  private _isBotSpeaking = false;

  constructor(socketManager: SocketManager, logger: Logger) {
    this.socketManager = socketManager;
    this.logger = logger;
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
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
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

        // Set up audio analyser for real-time level metering
        this.setupAnalyser(track);
        if (this._isBotSpeaking) {
          // Async setupAnalyser may not have completed yet — retry shortly
          setTimeout(() => this.startAudioLevelPolling(), 50);
        }
      }
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
      if (track.kind === Track.Kind.Audio) {
        this.teardownAnalyser();
        track.detach().forEach((el: HTMLMediaElement) => el.remove());
      }
    });

    this.room.on(RoomEvent.Disconnected, () => {
      this.logger.debug('LiveKit room disconnected');
      this._isActive = false;
      this._isBotSpeaking = false;
      this.teardownAnalyser();
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

    // Notify backend
    this.socketManager.emitEvent('livekit_join', { room: tokenData.room });
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
    this.teardownAnalyser();

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
    this.logger.debug('LiveKit voice stopped');
  }

  toggleMute(): void {
    if (!this._isActive || !this.room) return;
    this._isMuted = !this._isMuted;
    this.room.localParticipant.setMicrophoneEnabled(!this._isMuted);
    this.logger.debug('Mute toggled:', this._isMuted);
  }

  dispose(): void {
    this.speakingStateCallback = null;
    this.audioLevelCallback = null;
    this._isBotSpeaking = false;
    this.teardownAnalyser();

    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
    this._isActive = false;
    this._isMuted = false;
  }

  // ─── Audio Analyser (livekit-client built-in) ───────────────────

  private async setupAnalyser(track: any): Promise<void> {
    this.teardownAnalyser();
    try {
      const { createAudioAnalyser } = await import('livekit-client');
      const { analyser, calculateVolume, cleanup } = createAudioAnalyser(track, {
        fftSize: 256,
        smoothingTimeConstant: 0.3,
      });
      // Resume the AudioContext — it may start suspended due to browser autoplay policy.
      // The user has already clicked to start voice, so resume() will succeed.
      if (analyser.context.state === 'suspended') {
        await (analyser.context as AudioContext).resume();
      }
      this.calculateVolume = calculateVolume;
      this.analyserCleanup = cleanup;
      this.logger.debug('Audio analyser created for bot track');
    } catch (err) {
      this.logger.debug('Failed to create audio analyser:', err);
    }
  }

  private teardownAnalyser(): void {
    this.stopAudioLevelPolling();
    if (this.analyserCleanup) {
      this.analyserCleanup().catch(() => {});
      this.analyserCleanup = null;
    }
    this.calculateVolume = null;
  }

  private startAudioLevelPolling(): void {
    if (this.audioLevelPollTimer !== null) return;
    if (!this.calculateVolume) return;

    // ~30fps polling
    this.audioLevelPollTimer = setInterval(() => {
      if (!this.calculateVolume) {
        this.stopAudioLevelPolling();
        return;
      }
      const vol = this.calculateVolume();
      this.audioLevelCallback?.(vol);
    }, 33);
  }

  private stopAudioLevelPolling(): void {
    if (this.audioLevelPollTimer !== null) {
      clearInterval(this.audioLevelPollTimer);
      this.audioLevelPollTimer = null;
    }
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
