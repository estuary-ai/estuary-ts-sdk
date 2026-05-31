# @estuary-ai/sdk

[![npm](https://img.shields.io/npm/v/@estuary-ai/sdk)](https://www.npmjs.com/package/@estuary-ai/sdk)

Web SDK for the [Estuary](https://www.estuary-ai.com) real-time AI conversation platform. Build applications with persistent AI characters that remember, hear, and see.

## Installation

```bash
npm install @estuary-ai/sdk
```

For LiveKit voice (optional, lower latency):

```bash
npm install @estuary-ai/sdk livekit-client
```

## Quick Start

```typescript
import { EstuaryClient } from '@estuary-ai/sdk';

const client = new EstuaryClient({
  serverUrl: 'https://api.estuary-ai.com',
  apiKey: 'est_your_api_key',
  characterId: 'your-character-id',
  playerId: 'user-123',
});

client.on('botResponse', (response) => {
  process.stdout.write(response.text);
  if (response.isFinal) console.log();
});

await client.connect();
client.sendText('Hello!');
```

## Features

### Text Chat

```typescript
client.sendText('What do you remember about me?');
client.sendText('Just respond in text', true); // textOnly mode
```

### Voice (WebSocket)

```typescript
const client = new EstuaryClient({
  serverUrl: 'https://api.estuary-ai.com',
  apiKey: 'est_...',
  characterId: '...',
  playerId: '...',
  voiceTransport: 'websocket',
});

await client.connect();
await client.startVoice(); // Requests mic permission
// ... speak, receive audio responses
client.stopVoice();
```

### Voice (LiveKit)

```typescript
const client = new EstuaryClient({
  // ...
  voiceTransport: 'livekit', // or 'auto' to prefer LiveKit
});

await client.connect();
await client.startVoice();
client.toggleMute();
```

### Interrupts

Interrupt the bot's current response (stops audio playback and generation):

```typescript
client.interrupt();                // interrupt current response
client.interrupt('msg_abc123');    // interrupt a specific message
```

### Vision / Camera

Send images for vision processing. The server may also request captures via the `cameraCaptureRequest` event.

```typescript
// Send a camera image proactively
client.sendCameraImage(base64Image, 'image/jpeg');

// Respond to a server-initiated capture request
client.on('cameraCaptureRequest', (request) => {
  const image = captureFrame(); // your capture logic
  client.sendCameraImage(image, 'image/jpeg', request.requestId, request.text);
});
```

### Character Actions

Bot responses can include inline action tags (e.g., `<action name="wave" target="user"/>`). The SDK automatically parses these, strips them from `botResponse.text`, and emits `characterAction` events:

```typescript
client.on('characterAction', (action) => {
  console.log(action.name);      // e.g., "wave"
  console.log(action.params);    // e.g., { target: "user" }
  console.log(action.messageId); // originating message
});
```

For non-streaming contexts, use the `parseActions` utility:

```typescript
import { parseActions } from '@estuary-ai/sdk';

const { actions, cleanText } = parseActions(rawBotText);
```

### Character Info

Fetch character details (name, avatar, 3D model URLs):

```typescript
const character = await client.getCharacter();
console.log(character.name, character.avatar);
```

### Memory & Knowledge Graph

```typescript
const memories = await client.memory.getMemories({ status: 'active', limit: 50 });
const facts = await client.memory.getCoreFacts();
const graph = await client.memory.getGraph({ includeEntities: true });
const results = await client.memory.search('favorite food');
const timeline = await client.memory.getTimeline({ groupBy: 'week' });
const stats = await client.memory.getStats();
await client.memory.deleteAll(true); // pass true to confirm
```

### Real-Time Memory Extraction

Enable `realtimeMemory` to receive live notifications when the server extracts memories from conversation:

```typescript
const client = new EstuaryClient({
  serverUrl: 'https://api.estuary-ai.com',
  apiKey: 'est_...',
  characterId: '...',
  playerId: '...',
  realtimeMemory: true,
});

client.on('memoryUpdated', (event) => {
  console.log(`Extracted ${event.memoriesExtracted} memories, ${event.factsExtracted} facts`);
  for (const mem of event.newMemories) {
    console.log(`  [${mem.memoryType}] ${mem.content} (confidence: ${mem.confidence})`);
  }
});

await client.connect();
```

## Events

```typescript
// Connection
client.on('connected', (session) => { /* authenticated */ });
client.on('disconnected', (reason) => { /* lost connection */ });
client.on('reconnecting', (attempt) => { /* reconnect attempt number */ });
client.on('connectionStateChanged', (state) => { /* ConnectionState enum */ });
client.on('authError', (error) => { /* authentication failed */ });

// Conversation
client.on('botResponse', (response) => { /* streaming text (actions auto-stripped) */ });
client.on('botVoice', (voice) => { /* audio chunk */ });
client.on('sttResponse', (stt) => { /* speech-to-text transcript */ });
client.on('interrupt', (data) => { /* response interrupted */ });
client.on('characterAction', (action) => { /* parsed action from bot response */ });
client.on('cameraCaptureRequest', (request) => { /* server requests a camera image */ });

// Voice
client.on('voiceStarted', () => { /* voice session began */ });
client.on('voiceStopped', () => { /* voice session ended */ });
client.on('livekitConnected', (room) => { /* joined LiveKit room */ });
client.on('livekitDisconnected', () => { /* left LiveKit room */ });

// Audio playback
client.on('audioPlaybackStarted', (messageId) => { /* bot audio started playing */ });
client.on('audioPlaybackComplete', (messageId) => { /* bot audio finished playing */ });

// Memory
client.on('memoryUpdated', (event) => { /* real-time memory extraction */ });

// Errors & limits
client.on('error', (error) => { /* EstuaryError */ });
client.on('quotaExceeded', (data) => { /* rate limited */ });
```

## Error Handling

Errors are instances of `EstuaryError` with a typed `code` field:

```typescript
import { EstuaryError, ErrorCode } from '@estuary-ai/sdk';

client.on('error', (error) => {
  if (error instanceof EstuaryError) {
    switch (error.code) {
      case ErrorCode.NOT_CONNECTED:
      case ErrorCode.CONNECTION_FAILED:
      case ErrorCode.CONNECTION_TIMEOUT:
        // connection issues
        break;
      case ErrorCode.AUTH_FAILED:
        // bad API key or character ID
        break;
      case ErrorCode.MICROPHONE_DENIED:
        // user denied mic permission
        break;
    }
  }
});

client.on('authError', (message) => {
  console.error('Authentication failed:', message);
});
```

## Configuration

```typescript
interface EstuaryConfig {
  serverUrl: string;           // Server URL
  apiKey: string;              // API key (est_...)
  characterId: string;         // Character ID
  playerId: string;            // End user ID
  audioSampleRate?: number;    // Default: 24000
  autoReconnect?: boolean;     // Default: true
  maxReconnectAttempts?: number; // Default: 5
  reconnectDelayMs?: number;   // Default: 2000
  debug?: boolean;             // Default: false
  voiceTransport?: 'websocket' | 'livekit' | 'auto'; // Default: 'auto'
  realtimeMemory?: boolean;    // Enable real-time memory extraction events. Default: false
  suppressMicDuringPlayback?: boolean; // Mute mic while bot audio plays (software AEC). Default: false
  autoInterruptOnSpeech?: boolean;     // Interrupt bot audio when user speaks. Default: true
  capabilities?: SessionCapabilities;  // Per-session device capability declaration
}

interface SessionCapabilities {
  version?: string;     // Schema version, defaults to "1"
  camera?: boolean;     // Device has a usable camera
  microphone?: boolean; // Device has a usable microphone
  speaker?: boolean;    // Device has a usable speaker
}
```

### Capability Declaration

Tell the server what the device can physically do. The server hides tools that require a missing capability — e.g. `request_camera_image` is suppressed when `camera: false`, so the LLM won't ask to see the camera on text-only clients.

When `capabilities` is omitted, the server defaults every field to `true` for backward compatibility — existing clients keep working unchanged.

```typescript
const client = new EstuaryClient({
  serverUrl, apiKey, characterId, playerId,
  capabilities: {
    camera: false,    // No camera on this client (e.g. share link, text-only widget)
    microphone: true,
    speaker: true,
  },
});
```

## Runtime Properties

```typescript
client.connectionState     // ConnectionState enum (Disconnected, Connecting, Connected, ...)
client.isConnected         // boolean shorthand
client.isVoiceActive       // true while voice session is running
client.isMuted             // current mute state
client.suppressMicDuringPlayback // get/set at runtime without reconnecting
client.session             // SessionInfo | null after connect
```

## Exports

Key exports:

```typescript
// Client
import { EstuaryClient } from '@estuary-ai/sdk';

// Errors
import { EstuaryError, ErrorCode } from '@estuary-ai/sdk';

// Enums
import { ConnectionState } from '@estuary-ai/sdk';

// Utilities
import { parseActions } from '@estuary-ai/sdk';

// Types (import type)
import type {
  EstuaryConfig,
  SessionInfo,
  CharacterInfo,
  BotResponse,
  BotVoice,
  SttResponse,
  InterruptData,
  CameraCaptureRequest,
  CharacterAction,
  QuotaExceededData,
  MemoryData,
  MemoryUpdatedEvent,
  EstuaryEventMap,
  ParsedAction,
  MemoryClient,
} from '@estuary-ai/sdk';
```

## React / Next.js

The SDK uses browser APIs, so it must be used in client components. In Next.js App Router:

```tsx
"use client";

import { useEffect, useRef } from 'react';
import { EstuaryClient } from '@estuary-ai/sdk';

export default function Chat() {
  const clientRef = useRef<EstuaryClient | null>(null);

  useEffect(() => {
    const client = new EstuaryClient({
      serverUrl: 'https://api.estuary-ai.com',
      apiKey: 'est_...',
      characterId: '...',
      playerId: 'user-123',
    });
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, []);

  return <div>...</div>;
}
```

If using `next/dynamic` with `ssr: false`, the importing page must also be a client component in Next.js 16+.

## Requirements

- Node.js 18+ or modern browser
- Estuary account with API key and Character ID

## Documentation

Full documentation at [docs.estuary-ai.com](https://docs.estuary-ai.com/docs/typescript-sdk/getting-started).

## License

MIT
