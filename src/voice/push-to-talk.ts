import type { Socket } from 'socket.io-client';
import type { SocketManager } from '../connection/socket-manager';
import { EstuaryError, ErrorCode } from '../errors';

export const PTT_PAYLOAD = { turn_mode: 'push_to_talk' } as const;

/** Serializes PTT signals: a new WebSocket turn must wait for STT teardown.
 *  Local release happens immediately, even while a press is awaiting readiness. */
export class PushToTalk {
  private held = false;
  private closed = false;
  private generation = 0;
  private serverHeld = false;
  private failure: unknown;
  private tail: Promise<void> = Promise.resolve();
  private press: Promise<void> = Promise.resolve();
  private closing: Promise<void> = Promise.resolve();
  private abort = new AbortController();
  private raw: Socket | null;

  constructor(
    socket: SocketManager,
    private setTransmitting: (enabled: boolean) => void | Promise<void>,
  ) {
    this.raw = socket.rawSocket;
  }

  get isHeld(): boolean {
    return this.held;
  }

  begin(): Promise<void> {
    if (this.held) return this.press;
    this.held = true;
    const generation = ++this.generation;
    this.press = this.enqueue(async () => {
      // A tap released before it reached the queue should not open a stream.
      if (!this.held || generation !== this.generation) return;
      this.serverHeld = true;
      await this.command('start_voice');
      if (this.held && generation === this.generation && !this.closed) {
        await this.setTransmitting(true);
      }
    });
    return this.press;
  }

  end(): Promise<void> {
    if (!this.held) return this.tail;
    this.held = false;
    ++this.generation;
    // Gate the mic synchronously; do not wait for a slow start_voice response.
    const muted = Promise.resolve(this.setTransmitting(false));
    // Attach a handler immediately, even if an earlier command is still pending.
    void muted.catch(() => {});
    return this.enqueue(async () => {
      await muted;
      if (this.serverHeld) {
        await this.command('stop_voice');
        this.serverHeld = false;
      }
    });
  }

  dispose(): Promise<void> {
    if (this.closed) return this.closing;
    this.closed = true;
    this.held = false;
    ++this.generation;
    void Promise.resolve(this.setTransmitting(false)).catch(() => {});
    if (this.serverHeld) {
      this.closing = sendVoiceCommand(this.raw, 'stop_voice').catch(() => {});
    }
    this.serverHeld = false;
    this.abort.abort();
    return this.closing;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.tail.then(async () => {
      if (this.closed) throw new EstuaryError(ErrorCode.VOICE_NOT_ACTIVE, 'Voice session ended');
      if (this.failure) throw this.failure;
      await operation();
    });
    this.tail = pending.catch((error: unknown) => {
      this.failure = error;
      this.held = false;
      // A failed signal must never leave a mic transmitting or allow another
      // press to consume a late response from this command. Restart voice.
      void Promise.resolve(this.setTransmitting(false)).catch(() => {});
    });
    return pending;
  }

  private command(event: 'start_voice' | 'stop_voice'): Promise<void> {
    const pending = sendVoiceCommand(this.raw, event);
    return new Promise((resolve, reject) => {
      const cancel = () =>
        reject(new EstuaryError(ErrorCode.VOICE_NOT_ACTIVE, 'Voice session ended'));
      this.abort.signal.addEventListener('abort', cancel, { once: true });
      pending
        .then(resolve, reject)
        .finally(() => this.abort.signal.removeEventListener('abort', cancel));
      if (this.abort.signal.aborted) cancel();
    });
  }
}

interface SignalQueue {
  pending?: Promise<void>;
  failure?: EstuaryError;
}

// Shared across voice-manager restarts on the same connection. Otherwise a
// late stop from the previous manager could close a newly started STT stream.
const queues = new WeakMap<Socket, SignalQueue>();

function sendVoiceCommand(raw: Socket | null, event: 'start_voice' | 'stop_voice'): Promise<void> {
  if (!raw?.connected) {
    return Promise.reject(new EstuaryError(ErrorCode.NOT_CONNECTED, 'Not connected to server'));
  }
  let queue = queues.get(raw);
  if (!queue) {
    queue = {};
    queues.set(raw, queue);
  }
  const state = queue;
  const run = () => {
    if (state.failure) throw state.failure;
    if (!raw.connected)
      throw new EstuaryError(ErrorCode.NOT_CONNECTED, 'Voice session disconnected');
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let voiceError: EstuaryError | undefined;
      const finish = (error?: EstuaryError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        raw.off('voice_error', onError);
        raw.off('disconnect', onDisconnect);
        if (error) reject(error);
        else resolve();
      };
      const onError = (data: { error?: string }) => {
        voiceError = new EstuaryError(
          ErrorCode.CONNECTION_FAILED,
          data.error ?? 'Voice command failed',
          data,
        );
      };
      const onDisconnect = () =>
        finish(new EstuaryError(ErrorCode.NOT_CONNECTED, 'Voice session disconnected'));
      const timer = setTimeout(() => {
        state.failure = new EstuaryError(
          ErrorCode.CONNECTION_TIMEOUT,
          `Timed out waiting for ${event}; reconnect before retrying PTT`,
        );
        finish(state.failure);
        // Cleanup only; commands on this socket remain blocked until reconnect.
        if (raw.connected) raw.emit('stop_voice');
      }, 10_000);
      raw.on('voice_error', onError);
      raw.on('disconnect', onDisconnect);
      // The Python Socket.IO ACK is sent after the async handler completes:
      // start has opened STT, stop has finished closing it. No payload change.
      raw.emit(event, event === 'start_voice' ? PTT_PAYLOAD : undefined, () => {
        if (settled && state.failure && event === 'start_voice' && raw.connected) {
          raw.emit('stop_voice');
        }
        finish(voiceError);
      });
    });
  };
  const pending = state.pending ? state.pending.then(run) : Promise.resolve().then(run);
  const drained = pending.catch(() => {});
  state.pending = drained;
  void drained.then(() => {
    if (state.pending === drained) state.pending = undefined;
  });
  return pending;
}
