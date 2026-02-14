export enum ErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  AUTH_FAILED = 'AUTH_FAILED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  VOICE_NOT_SUPPORTED = 'VOICE_NOT_SUPPORTED',
  VOICE_ALREADY_ACTIVE = 'VOICE_ALREADY_ACTIVE',
  VOICE_NOT_ACTIVE = 'VOICE_NOT_ACTIVE',
  LIVEKIT_UNAVAILABLE = 'LIVEKIT_UNAVAILABLE',
  MICROPHONE_DENIED = 'MICROPHONE_DENIED',
  NOT_CONNECTED = 'NOT_CONNECTED',
  REST_ERROR = 'REST_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class EstuaryError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'EstuaryError';
    this.code = code;
    this.details = details;
  }
}
