import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScriptPlayer, type ScriptHost } from '../src/scripting/script-player';
import type { BotResponse, InterruptData } from '../src/types';

class FakeHost implements ScriptHost {
  said: Array<{ text: string; textOnly: boolean }> = [];
  interruptCount = 0;
  started: Array<{ index: number; text: string; messageId: string }> = [];
  completed: Array<{ reason: string }> = [];
  isConnected = true;
  willPlayScriptedAudio = false;
  private listeners: Record<string, Set<(...a: unknown[]) => void>> = {};

  sayLine(text: string, textOnly: boolean): void {
    this.said.push({ text, textOnly });
  }
  interrupt(): void {
    this.interruptCount++;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: any, listener: any): unknown {
    (this.listeners[event] ??= new Set()).add(listener);
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: any, listener: any): unknown {
    this.listeners[event]?.delete(listener);
    return this;
  }
  emitScriptLineStarted(info: { index: number; text: string; messageId: string }): void {
    this.started.push(info);
  }
  emitScriptComplete(info: { reason: string }): void {
    this.completed.push(info);
  }
  log(): void {}

  fire(event: string, ...args: unknown[]): void {
    [...(this.listeners[event] ?? [])].forEach((l) => l(...args));
  }
}

function botResponse(p: {
  messageId: string;
  isFinal: boolean;
  isInterjection?: boolean;
}): BotResponse {
  return {
    text: 't',
    partial: '',
    chunkIndex: 0,
    isInterjection: p.isInterjection ?? false,
    messageId: p.messageId,
    isFinal: p.isFinal,
  };
}

const flush = (): Promise<void> => Promise.resolve();

describe('ScriptPlayer', () => {
  let host: FakeHost;
  beforeEach(() => {
    host = new FakeHost();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues only the first line until it completes (no stomping)', async () => {
    new ScriptPlayer(host, ['a', 'b', 'c']);
    await flush();
    expect(host.said).toEqual([{ text: 'a', textOnly: false }]);
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.started[0]).toMatchObject({
      index: 0,
      text: 'a',
      messageId: 'm1',
    });
    expect(host.said).toEqual([
      { text: 'a', textOnly: false },
      { text: 'b', textOnly: false },
    ]);
  });

  it('plays all lines in order and resolves done with finished', async () => {
    const p = new ScriptPlayer(host, ['a', 'b']);
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    host.fire('botResponse', botResponse({ messageId: 'm2', isFinal: true }));
    await expect(p.done).resolves.toEqual({ reason: 'finished' });
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);
    expect(host.completed).toEqual([{ reason: 'finished' }]);
  });

  it('waits for audioPlaybackComplete when the SDK plays the audio', async () => {
    host.willPlayScriptedAudio = true;
    new ScriptPlayer(host, ['a', 'b']);
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true })); // ack only
    expect(host.said.length).toBe(1);
    host.fire('audioPlaybackComplete', 'm1');
    expect(host.said.length).toBe(2);
  });

  it('text-only line advances on botResponse.isFinal even when audio would play', async () => {
    host.willPlayScriptedAudio = true;
    new ScriptPlayer(host, [{ text: 'a', textOnly: true }, 'b']);
    await flush();
    expect(host.said[0]).toEqual({ text: 'a', textOnly: true });
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.said.length).toBe(2);
  });

  it('applies lineGapMs between lines', async () => {
    new ScriptPlayer(host, ['a', 'b'], { lineGapMs: 500 });
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.said.length).toBe(1);
    vi.advanceTimersByTime(500);
    expect(host.said.length).toBe(2);
  });

  it('pause holds after the current line; resume continues', async () => {
    const p = new ScriptPlayer(host, ['a', 'b', 'c']);
    await flush();
    p.pause();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.said.length).toBe(1);
    expect(p.state).toBe('paused');
    p.resume();
    expect(host.said.length).toBe(2);
  });

  it('next skips to the next line immediately', async () => {
    const p = new ScriptPlayer(host, ['a', 'b', 'c']);
    await flush();
    p.next();
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);
  });

  it('stop interrupts, completes with reason stopped, and ignores later events', async () => {
    const p = new ScriptPlayer(host, ['a', 'b']);
    await flush();
    p.stop();
    expect(host.interruptCount).toBe(1);
    await expect(p.done).resolves.toEqual({ reason: 'stopped' });
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.said.length).toBe(1);
  });

  it('lineTimeoutMs force-advances a stuck line', async () => {
    new ScriptPlayer(host, ['a', 'b'], { lineTimeoutMs: 1000 });
    await flush();
    vi.advanceTimersByTime(1000);
    expect(host.said.length).toBe(2);
  });

  it('external interrupt ends the script as interrupted', async () => {
    const p = new ScriptPlayer(host, ['a', 'b']);
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: false })); // ack
    host.fire('interrupt', { messageId: 'm1' } as InterruptData);
    await expect(p.done).resolves.toEqual({ reason: 'interrupted' });
  });

  it('ignores the self-induced interrupt of a superseded line after next()', async () => {
    const p = new ScriptPlayer(host, ['a', 'b']);
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: false })); // ack a
    p.next(); // supersede m1, issue b
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);
    host.fire('interrupt', { messageId: 'm1' } as InterruptData); // server interrupt for a (our doing)
    expect(p.state).not.toBe('done');
    host.fire('botResponse', botResponse({ messageId: 'm2', isFinal: true }));
    await expect(p.done).resolves.toEqual({ reason: 'finished' });
  });

  it('ends as disconnected on disconnected event', async () => {
    const p = new ScriptPlayer(host, ['a', 'b']);
    await flush();
    host.fire('disconnected', 'transport close');
    await expect(p.done).resolves.toEqual({ reason: 'disconnected' });
  });

  it('finishes immediately for an empty script', async () => {
    const p = new ScriptPlayer(host, []);
    await expect(p.done).resolves.toEqual({ reason: 'finished' });
    expect(host.said).toEqual([]);
  });

  it('skips empty/whitespace lines within a script', async () => {
    new ScriptPlayer(host, ['a', '   ', 'b']);
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);
  });

  it('loops when loop=true', async () => {
    const p = new ScriptPlayer(host, ['a'], { loop: true });
    await flush();
    expect(host.said.length).toBe(1);
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.said.length).toBe(2); // completing the only line loops back and re-issues it
    expect(host.said.every((s) => s.text === 'a')).toBe(true);
    expect(p.state).toBe('playing');
    p.stop();
  });

  // ─── regression: next()/stop() called BEFORE a line is acked ──────────────

  it('next() before ack on a text-only line swallows the stale response (no mis-ack)', async () => {
    const p = new ScriptPlayer(host, [
      { text: 'a', textOnly: true },
      { text: 'b', textOnly: true },
    ]);
    await flush();
    expect(host.said).toEqual([{ text: 'a', textOnly: true }]);

    p.next(); // skip 'a' before it is acked
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);

    // The skipped line 'a' still emits its immediate text-only bot_response. It must NOT be
    // treated as the ack for 'b' (which would emit a wrong-messageId scriptLineStarted and
    // prematurely finish the script).
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(host.started).toEqual([]); // not acked by the stale response
    expect(p.state).not.toBe('done');

    // 'b' real response acks + completes it correctly
    host.fire('botResponse', botResponse({ messageId: 'm2', isFinal: true }));
    expect(host.started).toEqual([{ index: 1, text: 'b', messageId: 'm2' }]);
    await expect(p.done).resolves.toEqual({ reason: 'finished' });
  });

  it('next() before ack on a TTS line does not stall (audio path)', async () => {
    host.willPlayScriptedAudio = true;
    const p = new ScriptPlayer(host, ['a', 'b']);
    await flush();
    p.next(); // skip 'a' before ack; 'a' is TTS so no stray bot_response is expected
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);

    // 'b' acks then completes via its own audioPlaybackComplete — must not be poisoned
    host.fire('botResponse', botResponse({ messageId: 'm2', isFinal: true }));
    expect(host.started).toEqual([{ index: 1, text: 'b', messageId: 'm2' }]);
    expect(host.said.length).toBe(2); // not advanced by the botResponse (audio path)
    host.fire('audioPlaybackComplete', 'm2');
    await expect(p.done).resolves.toEqual({ reason: 'finished' });
  });

  it('next() while paused skips the pause and advances', async () => {
    const p = new ScriptPlayer(host, ['a', 'b', 'c']);
    await flush();
    p.pause();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true }));
    expect(p.state).toBe('paused');
    expect(host.said.length).toBe(1);

    p.next(); // should skip the pause and advance to 'b'
    expect(p.state).toBe('playing');
    expect(host.said.map((s) => s.text)).toEqual(['a', 'b']);

    // selfInterruptPending must NOT have leaked: a genuine external interrupt still ends it
    host.fire('botResponse', botResponse({ messageId: 'm2', isFinal: false })); // ack 'b'
    host.fire('interrupt', { messageId: 'm2' } as InterruptData);
    await expect(p.done).resolves.toEqual({ reason: 'interrupted' });
  });

  it('ignores audioPlaybackComplete when willPlayScriptedAudio=false (no double-advance)', async () => {
    host.willPlayScriptedAudio = false;
    new ScriptPlayer(host, ['a', 'b']); // TTS lines, but SDK is not playing audio
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true })); // completes 'a'
    expect(host.said.length).toBe(2);
    host.fire('audioPlaybackComplete', 'm1'); // stray — must be ignored
    expect(host.said.length).toBe(2); // no double-advance
  });

  it('next() from idle starts playback', async () => {
    const p = new ScriptPlayer(host, ['a', 'b'], { autoStart: false });
    expect(p.state).toBe('idle');
    expect(host.said).toEqual([]);
    p.next();
    expect(p.state).toBe('playing');
    expect(host.said.map((s) => s.text)).toEqual(['a']);
    p.stop();
  });

  it('stop() during the inter-line gap clears the pending timer', async () => {
    const p = new ScriptPlayer(host, ['a', 'b'], { lineGapMs: 500 });
    await flush();
    host.fire('botResponse', botResponse({ messageId: 'm1', isFinal: true })); // completes 'a', enters gap
    expect(host.said.length).toBe(1);
    p.stop();
    expect(host.completed).toEqual([{ reason: 'stopped' }]);
    vi.advanceTimersByTime(1000); // the gap timer must not fire after stop
    expect(host.said.length).toBe(1); // 'b' never issued
  });
});
