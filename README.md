# @estuary-ai/sdk

TypeScript SDK for the [Estuary](https://www.estuary-ai.com) real-time AI conversation platform. Build applications with persistent AI characters that remember, hear, and see.

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

### Memory & Knowledge Graph

```typescript
const memories = await client.memory.getMemories({ status: 'active', limit: 50 });
const facts = await client.memory.getCoreFacts();
const graph = await client.memory.getGraph({ includeEntities: true });
const results = await client.memory.search('favorite food');
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
client.on('connected', (session) => { /* authenticated */ });
client.on('disconnected', (reason) => { /* lost connection */ });
client.on('botResponse', (response) => { /* streaming text */ });
client.on('botVoice', (voice) => { /* audio chunk */ });
client.on('sttResponse', (stt) => { /* speech-to-text */ });
client.on('interrupt', (data) => { /* response interrupted */ });
client.on('memoryUpdated', (event) => { /* real-time memory extraction */ });
client.on('error', (error) => { /* EstuaryError */ });
client.on('quotaExceeded', (data) => { /* rate limited */ });
```

## Configuration

```typescript
interface EstuaryConfig {
  serverUrl: string;           // Server URL
  apiKey: string;              // API key (est_...)
  characterId: string;         // Character ID
  playerId: string;            // End user ID
  audioSampleRate?: number;    // Default: 16000
  autoReconnect?: boolean;     // Default: true
  maxReconnectAttempts?: number; // Default: 5
  reconnectDelayMs?: number;   // Default: 2000
  debug?: boolean;             // Default: false
  voiceTransport?: 'websocket' | 'livekit' | 'auto'; // Default: 'auto'
  realtimeMemory?: boolean;    // Enable real-time memory extraction events. Default: false
}
```

## Requirements

- Node.js 18+ or modern browser
- Estuary account with API key and Character ID

## Documentation

Full documentation at [docs.estuary-ai.com](https://docs.estuary-ai.com/docs/typescript-sdk/getting-started).

## License

MIT
