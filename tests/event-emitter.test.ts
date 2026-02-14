import { describe, it, expect, vi } from 'vitest';
import { TypedEventEmitter } from '../src/utils/event-emitter';

type TestEvents = {
  message: (text: string) => void;
  count: (n: number) => void;
  empty: () => void;
};

class TestEmitter extends TypedEventEmitter<TestEvents> {
  public testEmit<K extends keyof TestEvents>(
    event: K,
    ...args: TestEvents[K] extends (...a: infer A) => void ? A : never[]
  ): boolean {
    return this.emit(event, ...args);
  }
}

describe('TypedEventEmitter', () => {
  it('should call listeners on emit', () => {
    const emitter = new TestEmitter();
    const fn = vi.fn();
    emitter.on('message', fn);
    emitter.testEmit('message', 'hello');
    expect(fn).toHaveBeenCalledWith('hello');
  });

  it('should support multiple listeners', () => {
    const emitter = new TestEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('message', fn1);
    emitter.on('message', fn2);
    emitter.testEmit('message', 'test');
    expect(fn1).toHaveBeenCalledWith('test');
    expect(fn2).toHaveBeenCalledWith('test');
  });

  it('should remove listener with off', () => {
    const emitter = new TestEmitter();
    const fn = vi.fn();
    emitter.on('message', fn);
    emitter.off('message', fn);
    emitter.testEmit('message', 'ignored');
    expect(fn).not.toHaveBeenCalled();
  });

  it('should fire once listener only once', () => {
    const emitter = new TestEmitter();
    const fn = vi.fn();
    emitter.once('message', fn);
    emitter.testEmit('message', 'first');
    emitter.testEmit('message', 'second');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');
  });

  it('should return false when no listeners', () => {
    const emitter = new TestEmitter();
    expect(emitter.testEmit('message', 'none')).toBe(false);
  });

  it('should return true when listeners exist', () => {
    const emitter = new TestEmitter();
    emitter.on('message', () => {});
    expect(emitter.testEmit('message', 'test')).toBe(true);
  });

  it('should removeAllListeners for specific event', () => {
    const emitter = new TestEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('message', fn1);
    emitter.on('count', fn2);
    emitter.removeAllListeners('message');
    emitter.testEmit('message', 'ignored');
    emitter.testEmit('count', 42);
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledWith(42);
  });

  it('should removeAllListeners for all events', () => {
    const emitter = new TestEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    emitter.on('message', fn1);
    emitter.on('count', fn2);
    emitter.removeAllListeners();
    emitter.testEmit('message', 'ignored');
    emitter.testEmit('count', 0);
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  it('should report correct listenerCount', () => {
    const emitter = new TestEmitter();
    expect(emitter.listenerCount('message')).toBe(0);
    const fn = () => {};
    emitter.on('message', fn);
    expect(emitter.listenerCount('message')).toBe(1);
    emitter.off('message', fn);
    expect(emitter.listenerCount('message')).toBe(0);
  });

  it('should not throw when a listener throws', () => {
    const emitter = new TestEmitter();
    const good = vi.fn();
    emitter.on('message', () => { throw new Error('oops'); });
    emitter.on('message', good);
    expect(() => emitter.testEmit('message', 'test')).not.toThrow();
    expect(good).toHaveBeenCalled();
  });

  it('should handle events with no arguments', () => {
    const emitter = new TestEmitter();
    const fn = vi.fn();
    emitter.on('empty', fn);
    emitter.testEmit('empty');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should support chaining', () => {
    const emitter = new TestEmitter();
    const fn = vi.fn();
    const result = emitter.on('message', fn).on('count', fn);
    expect(result).toBe(emitter);
  });
});
