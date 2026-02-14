export class TypedEventEmitter<T extends Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<keyof T, Set<any>>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onceListeners = new Map<keyof T, Set<any>>();

  on<K extends keyof T>(event: K, listener: T[K]): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off<K extends keyof T>(event: K, listener: T[K]): this {
    this.listeners.get(event)?.delete(listener);
    this.onceListeners.get(event)?.delete(listener);
    return this;
  }

  once<K extends keyof T>(event: K, listener: T[K]): this {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(listener);
    this.on(event, listener);
    return this;
  }

  protected emit<K extends keyof T>(
    event: K,
    ...args: T[K] extends (...a: infer A) => void ? A : never[]
  ): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return false;

    for (const listener of listeners) {
      try {
        (listener as Function)(...args);
      } catch {
        // Listener threw — swallow to not break other listeners
      }
    }

    // Remove once listeners after firing
    const onceSet = this.onceListeners.get(event);
    if (onceSet) {
      for (const listener of onceSet) {
        this.listeners.get(event)?.delete(listener);
      }
      onceSet.clear();
    }

    return true;
  }

  removeAllListeners<K extends keyof T>(event?: K): this {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
    return this;
  }

  listenerCount<K extends keyof T>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
