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
default_playback_sample_rate: 24000    # TTS audio generated at 24kHz by default
```

## Parity Status

| Feature | Status | Notes |
|---------|--------|-------|
| text_chat | Implemented | sendText(), botResponse event |
| voice_websocket | Implemented | WebSocketVoiceManager |
| voice_livekit | Implemented | LiveKitVoiceManager (optional peer dep) |
| interrupts | Implemented | interrupt() + interrupt event |
| audio_playback_tracking | Implemented | AudioPlayer (WebSocket) + LiveKit metadata tracking |
| vision_camera | Implemented | sendCameraImage() + cameraCaptureRequest event |
| video_streaming_livekit | Not implemented | AR/VR only |
| video_streaming_websocket | Not implemented | AR/VR only |
| scene_graph | Not implemented | AR/VR only |
| device_pose | Not implemented | AR/VR only |
| preferences | Implemented | updatePreferences() |
| memory_rest_api | Implemented | client.memory.* methods |
| memory_push | Implemented | memoryUpdated event for real-time extraction notifications |
| suppress_mic_during_playback | Implemented | Works across both WebSocket and LiveKit transports |

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
│   ├── audio-player.ts       # Bot voice PCM playback (Web Audio) — WebSocket path only
│   └── audio-recorder.ts     # Mic capture + PCM encoding
└── utils/
    ├── event-emitter.ts      # Strongly-typed EventEmitter
    ├── action-parser.ts      # Streaming character action parser
    └── logger.ts             # Debug logger
```

## Audio Playback: Two Paths

The SDK has two completely different audio playback paths depending on the voice transport. This is the most important architectural detail to understand:

### WebSocket path
Bot audio arrives as base64 PCM chunks via `bot_voice` Socket.IO events with an `audio` field. The `AudioPlayer` decodes, buffers, and plays these chunks using Web Audio API. The AudioPlayer emits `started`/`complete` lifecycle events with a 300ms drain delay between chunks.

### LiveKit path
Bot audio is streamed directly as a WebRTC media track — the `LiveKitVoiceManager` subscribes to the remote audio track and attaches it to an `<audio>` element. The `AudioPlayer` is **not used**. Instead, the backend sends **metadata-only** `bot_voice` events (with `is_livekit: true`, no `audio` field) for message tracking. The client uses these metadata events to detect playback start:
- First metadata event for a new message → emit `audioPlaybackStarted`
- Playback completion is detected via LiveKit's `RoomEvent.ActiveSpeakersChanged` (server-side VAD). When the bot (remote participant) drops off the active speakers list, `onBotSpeakingChanged(false)` fires → emit `audioPlaybackComplete`. No client-side drain timer needed.

This distinction matters for any feature that depends on knowing when the bot is speaking (e.g., `suppressMicDuringPlayback`, auto-interrupt, UI indicators). Always check `_isBotPlaying` which covers both paths.

## Mic Suppression During Playback

`suppressMicDuringPlayback` mutes the user's mic while the bot is speaking, preventing echo and barge-in. Key implementation details:

- **VoiceManager level:** Uses `setSuppressed(bool)` (separate from user-initiated `toggleMute`). Both flags gate audio independently — WebSocket voice checks `_isMuted || _isSuppressed` in `onaudioprocess`, LiveKit voice computes `enabled = !_isMuted && !_isSuppressed` for the media track.
- **Runtime updates:** The `suppressMicDuringPlayback` property on `EstuaryClient` has a setter that updates `config` and immediately applies/removes suppression if the bot is currently playing. No reconnect needed.
- **Auto-interrupt interaction:** When suppress is enabled, `maybeAutoInterrupt()` returns early — the mic is muted so no STT arrives anyway, but this prevents edge cases with trailing partials.
- **Grace period:** On playback start, a 1500ms grace period suppresses auto-interrupt regardless of the suppress setting, preventing trailing STT partials from the user's previous speech from killing the new audio.

## Wire Format

All server communication uses snake_case. The SDK converts to camelCase for the public API via converter functions in `types.ts` (`toBotResponse`, `toBotVoice`, etc.).

Key wire types to know:
- `bot_voice` can be either full audio (`{ audio: "base64...", message_id, chunk_index }`) or LiveKit metadata (`{ message_id, chunk_index, is_livekit: true }` — no `audio` field)
- `bot_response` text streaming finishes (`is_final: true`) before TTS audio finishes — never use `bot_response.isFinal` as a signal that audio playback is complete

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

## Critical Gotchas

1. **LiveKit audio bypasses AudioPlayer.** The `AudioPlayer` only handles WebSocket voice. With LiveKit, bot audio is a WebRTC track played by the browser directly. Any feature depending on playback state must check `_isBotPlaying` (not just `audioPlayer.playing`).

2. **`bot_response.isFinal` != audio done.** Text generation finishes before TTS. For LiveKit, playback completion is determined by a 2-second drain timer after the last `bot_voice` metadata event. For WebSocket, the AudioPlayer has a 300ms drain delay.

3. **`toggleMute` vs `setSuppressed` are independent.** `_isMuted` is user-initiated (UI toggle). `_isSuppressed` is automatic (suppress during playback). Both prevent audio from being sent, but they must be tracked separately. Never use `toggleMute` for automatic suppression — it conflicts with user intent.

4. **`BotVoice.audio` is optional.** LiveKit metadata events omit the `audio` field. Guard against `undefined` before passing to `AudioPlayer.enqueue()`.

5. **VoiceManager `setSuppressed` is optional in the interface** (`setSuppressed?(suppressed: boolean): void`). Always use optional chaining: `this.voiceManager?.setSuppressed?.(true)`.

## Platform Notes

- Uses official `socket.io-client` library (unlike Unity/Lens Studio which manually implement Socket.IO v4)
- LiveKit is an optional peer dependency — graceful fallback to WebSocket voice
- Audio APIs (AudioContext, getUserMedia) require browser environment; memory REST works in Node.js
- Wire format uses snake_case; public API uses camelCase with converter functions in types.ts

## Documentation Maintenance

- When modifying SDK features, installation steps, or dependencies: update both `README.md` and `estuary-docs/docs/typescript-sdk/` docs to keep them in sync
- LiveKit is an **optional** peer dependency — always document it as optional (unlike Unity SDK where it's required)
- The npm package page is at https://www.npmjs.com/package/@estuary-ai/sdk — keep `package.json` metadata (description, keywords, repository) accurate as they surface on npm
