import type { VoiceManager, VoiceTransport } from '../types';
import type { SocketManager } from '../connection/socket-manager';
import type { Logger } from '../utils/logger';

export type { VoiceManager };

async function isLiveKitAvailable(): Promise<boolean> {
  try {
    await import('livekit-client');
    return true;
  } catch {
    return false;
  }
}

export interface VoiceManagerResult {
  manager: VoiceManager;
  resolvedTransport: 'websocket' | 'livekit';
}

export async function createVoiceManager(
  transport: VoiceTransport,
  socketManager: SocketManager,
  sampleRate: number,
  logger: Logger,
): Promise<VoiceManagerResult | null> {
  if (transport === 'websocket') {
    const { WebSocketVoiceManager } = await import('./websocket-voice');
    return { manager: new WebSocketVoiceManager(socketManager, sampleRate, logger), resolvedTransport: 'websocket' };
  }

  if (transport === 'livekit') {
    if (await isLiveKitAvailable()) {
      const { LiveKitVoiceManager } = await import('./livekit-voice');
      return { manager: new LiveKitVoiceManager(socketManager, logger), resolvedTransport: 'livekit' };
    }
    logger.warn('livekit-client not installed, falling back to WebSocket voice');
    const { WebSocketVoiceManager } = await import('./websocket-voice');
    return { manager: new WebSocketVoiceManager(socketManager, sampleRate, logger), resolvedTransport: 'websocket' };
  }

  // auto: prefer LiveKit if available, else WebSocket
  if (transport === 'auto') {
    if (await isLiveKitAvailable()) {
      const { LiveKitVoiceManager } = await import('./livekit-voice');
      return { manager: new LiveKitVoiceManager(socketManager, logger), resolvedTransport: 'livekit' };
    }
    const { WebSocketVoiceManager } = await import('./websocket-voice');
    return { manager: new WebSocketVoiceManager(socketManager, sampleRate, logger), resolvedTransport: 'websocket' };
  }

  return null;
}
