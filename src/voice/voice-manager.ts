import type { VoiceManager, VoiceTransport } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';

export type { VoiceManager };

export function createVoiceManager(
  transport: VoiceTransport,
  socketManager: SocketManager,
  sampleRate: number,
  logger: Logger,
): VoiceManager | null {
  if (transport === 'websocket') {
    // Lazy import to avoid loading unnecessary code
    const { WebSocketVoiceManager } = require('./websocket-voice');
    return new WebSocketVoiceManager(socketManager, sampleRate, logger);
  }

  if (transport === 'livekit') {
    try {
      require.resolve('livekit-client');
      const { LiveKitVoiceManager } = require('./livekit-voice');
      return new LiveKitVoiceManager(socketManager, logger);
    } catch {
      logger.warn('livekit-client not installed, falling back to WebSocket voice');
      const { WebSocketVoiceManager } = require('./websocket-voice');
      return new WebSocketVoiceManager(socketManager, sampleRate, logger);
    }
  }

  // auto: prefer LiveKit if available, else WebSocket
  if (transport === 'auto') {
    try {
      require.resolve('livekit-client');
      const { LiveKitVoiceManager } = require('./livekit-voice');
      return new LiveKitVoiceManager(socketManager, logger);
    } catch {
      const { WebSocketVoiceManager } = require('./websocket-voice');
      return new WebSocketVoiceManager(socketManager, sampleRate, logger);
    }
  }

  return null;
}
