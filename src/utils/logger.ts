export class Logger {
  private enabled: boolean;

  constructor(debug = false) {
    this.enabled = debug;
  }

  setDebug(enabled: boolean): void {
    this.enabled = enabled;
  }

  debug(...args: unknown[]): void {
    if (this.enabled) console.debug('[Estuary]', ...args);
  }

  info(...args: unknown[]): void {
    if (this.enabled) console.info('[Estuary]', ...args);
  }

  warn(...args: unknown[]): void {
    console.warn('[Estuary]', ...args);
  }

  error(...args: unknown[]): void {
    console.error('[Estuary]', ...args);
  }
}
