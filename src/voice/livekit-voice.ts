import type { VoiceManager, LiveKitTokenResponse } from '../types';
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
      }
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el: HTMLMediaElement) => el.remove());
      }
    });

    this.room.on(RoomEvent.Disconnected, () => {
      this.logger.debug('LiveKit room disconnected');
      this._isActive = false;
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
