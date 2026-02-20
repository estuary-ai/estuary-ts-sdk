import type { VoiceManager, VoiceTransport } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';

export type { VoiceManager };

export async function createVoiceManager(
  transport: VoiceTransport,
  socketManager: SocketManager,
  sampleRate: number,
  logger: Logger,
): Promise<VoiceManager | null> {
  if (transport === 'websocket') {
    const { WebSocketVoiceManager } = await import('./websocket-voice');
    return new WebSocketVoiceManager(socketManager, sampleRate, logger);
  }

  if (transport === 'livekit') {
    try {
      const { LiveKitVoiceManager } = await import('./livekit-voice');
      return new LiveKitVoiceManager(socketManager, logger);
    } catch {
      logger.warn('livekit-client not installed, falling back to WebSocket voice');
      const { WebSocketVoiceManager } = await import('./websocket-voice');
      return new WebSocketVoiceManager(socketManager, sampleRate, logger);
    }
  }

  // auto: prefer LiveKit if available, else WebSocket
  if (transport === 'auto') {
    try {
      const { LiveKitVoiceManager } = await import('./livekit-voice');
      return new LiveKitVoiceManager(socketManager, logger);
    } catch {
      const { WebSocketVoiceManager } = await import('./websocket-voice');
      return new WebSocketVoiceManager(socketManager, sampleRate, logger);
    }
  }

  return null;
}
