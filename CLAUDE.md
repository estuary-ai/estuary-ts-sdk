# Estuary TypeScript SDK — CLAUDE.md

## Overview

TypeScript SDK for the Estuary real-time AI conversation platform. Provides a typed client library for web and Node.js applications to integrate Estuary characters with text chat, voice (WebSocket and LiveKit), and memory graph access.

**Language:** TypeScript
**Target:** Node.js 18+, modern browsers (Chrome, Firefox, Safari, Edge)
**Package:** `@estuary-ai/sdk` via npm

## SDK Contract

This SDK implements the Estuary SDK API Contract defined in `SDK_CONTRACT.md` at the repository root. Always reference that file for the canonical API surface.

## Platform Capabilities

```yaml
transport_websocket: true
transport_livekit_webrtc: true          # Via optional livekit-client peer dependency
audio_recording: true                   # getUserMedia + Web Audio API
audio_playback: true                    # Web Audio API AudioContext
camera_capture: true                    # Via sendCameraImage() — app provides base64 image
livekit_video: false                    # Not implemented (AR/VR use case)
scene_graph: false                      # Not implemented (AR/VR use case)
device_pose: false                      # Not implemented (AR/VR use case)
min_audio_sample_rate: 16000
max_audio_sample_rate: 48000
```

## Parity Status

| Feature | Status | Notes |
|---------|--------|-------|
| text_chat | Implemented | sendText(), botResponse event |
| voice_websocket | Implemented | WebSocketVoiceManager |
| voice_livekit | Implemented | LiveKitVoiceManager (optional peer dep) |
| interrupts | Implemented | interrupt() + interrupt event |
| audio_playback_tracking | Implemented | AudioPlayer auto-notifies server |
| vision_camera | Implemented | sendCameraImage() + cameraCaptureRequest event |
| video_streaming_livekit | Not implemented | AR/VR only |
| video_streaming_websocket | Not implemented | AR/VR only |
| scene_graph | Not implemented | AR/VR only |
| device_pose | Not implemented | AR/VR only |
| preferences | Implemented | updatePreferences() |
| memory_rest_api | Implemented | client.memory.* methods |
| memory_push | Implemented | memoryUpdated event for real-time extraction notifications |

## Architecture

```
src/
├── client.ts                 # EstuaryClient — main entry, composes all modules
├── types.ts                  # All public interfaces/enums + wire converters
├── errors.ts                 # EstuaryError + ErrorCode enum
├── connection/
│   └── socket-manager.ts     # Socket.IO client wrapper, auth, reconnect
├── voice/
│   ├── voice-manager.ts      # VoiceManager interface + factory
│   ├── websocket-voice.ts    # WebSocket stream_audio implementation
│   └── livekit-voice.ts      # LiveKit WebRTC implementation
├── rest/
│   ├── rest-client.ts        # Base fetch wrapper with API key auth
│   └── memory-client.ts      # Memory graph REST API client
├── audio/
│   ├── audio-player.ts       # Bot voice PCM playback (Web Audio)
│   └── audio-recorder.ts     # Mic capture + PCM encoding
└── utils/
    ├── event-emitter.ts      # Strongly-typed EventEmitter
    └── logger.ts             # Debug logger
```

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Build with tsup (ESM + CJS + types)
npm run typecheck    # TypeScript type check
npm run test         # Run vitest tests
npm run lint         # ESLint
npm run format       # Prettier
```

## Code Style

- TypeScript strict mode
- camelCase for public API, snake_case wire format converted internally
- Composition over inheritance (EstuaryClient composes SocketManager, VoiceManager, etc.)
- Typed EventEmitter for all events
- Dual ESM + CJS output via tsup

## Platform Notes

- Uses official `socket.io-client` library (unlike Unity/Lens Studio which manually implement Socket.IO v4)
- LiveKit is an optional peer dependency — graceful fallback to WebSocket voice
- Audio APIs (AudioContext, getUserMedia) require browser environment; memory REST works in Node.js
- Wire format uses snake_case; public API uses camelCase with converter functions in types.ts
