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
| say_line | Implemented | `sayLine(text, textOnly?)` emits `say_line` with `text_only` flag (TTS by default) |
| scripted_lines | Implemented (TS-only extension) | `playScript()`/`sayLines()` sequencer paces lines so back-to-back `say_line` calls don't interrupt each other; emits `scriptLineStarted`/`scriptComplete`. Layered on the shared `say_line` event — not present in the other SDKs. |
| voice_websocket | Implemented | WebSocketVoiceManager |
| voice_livekit | Implemented | LiveKitVoiceManager (optional peer dep). LiveKit activates only on `startVoice()` — nothing is touched at `connect()`. The `livekit_token` request at voice start doubles as the gateway's voice-intent signal: it launches the server's bot pre-join + STT pre-connect in the background (warm start), overlapping the mic-permission prompt and room connect. Do NOT switch to the embedded session_info token without also emitting `livekit_token` — that would silently downgrade every voice start to the cold join path (see SDK_CONTRACT.md voice_livekit → Resource allocation). |
| interrupts | Implemented | interrupt() + interrupt event |
| client_action | Implemented | Typed `client_action` server event (contract v1.10, SCRUM-202) → existing `characterAction` event, fire-on-arrival. **Opt-in is mandatory and automatic:** `socket-manager` always sends `capabilities.client_action: true` in the auth payload, because the server defaults that field to `false` and serves the retired XML `<action>` tag path to anything that doesn't declare it. It is injected after the `...config.capabilities` spread so an app cannot disable it — doing so would silently downgrade the session to the legacy path. Wire `arguments` values (`string \| number \| boolean`) are stringified in `toCharacterAction` so `params` stays `Record<string, string>` — no API change for consumers. The legacy inline `<action/>` text-tag parser (`StreamingActionParser` in `handleBotResponse`) is retained but dormant: on the opted-in path it only ever sees stray tags. `chunk_index`/`timestamp` envelope fields are not surfaced (public `CharacterAction` unchanged). |
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
| capabilities_declaration | Implemented | `EstuaryConfig.capabilities` → `authenticate` payload (SDK v0.4.0+). Server defaults all fields true when omitted. |
| voice_timeout | Implemented | Voice-lane idle release (auto-mute illusion). Server released the call's voice resources (room deleted, STT closed) after no user speech, while the socket stays connected. SDK releases local voice (mic off, transport disposed, `voiceStopped` emitted) and re-emits `voiceTimeout` (camelCase payload). Unlike `session_timeout`, NO disconnect follows and no reconnect suppression is involved — text keeps working. Recommended app UX: keep the call UI open, show the mic as auto-muted, call `startVoice()` on unmute. |
| session_timeout | Implemented | Server idle-timeout (no conversation activity). Emitted as `sessionTimeout` (camelCase payload). The SDK self-manages reconnection (`reconnection: false`), so `handleDisconnect` now explicitly skips auto-reconnect for server-initiated disconnects (`session_timeout` flag or `'io server disconnect'` reason) — auto-reconnecting after an idle reap would re-establish billed voice resources in a loop. Resume = explicit `connect()` on user intent. On `session_timeout` the client also releases voice resources (stops/disposes the voice manager — even one whose LiveKit room already died — clears the audio player, emits `voiceStopped`) so `connect()` + `startVoice()` resumes cleanly; without this a stale WebSocket manager keeps the mic hot and makes `startVoice()` throw VOICE_ALREADY_ACTIVE. |
| page_lifecycle / voice_resume | Implemented (TS-only extension, v0.9.0) | Browser-only lifecycle management (see "Page Lifecycle & Voice Resume" section below). Not a contract feature — Unity/Lens Studio have their own app-pause lifecycles. |
| simulation_v1 | Not implemented | Public Simulation API (SDK_CONTRACT.md §REST API — Simulation (v1), contract v1.4–1.6): worlds/instances REST + `/sim-v1` live streaming + per-instance world-view document + world destroy/memory-clear session isolation (v1.6). Unity is the reference SDK implementation (2026-07-18). A natural fit here (`client.simulation.*` REST module + a second socket.io-client namespace connection with auth `{apiKey, instanceId}`) — not yet requested. |

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
    ├── action-parser.ts      # Legacy <action/> text-tag parser (dormant; actions now arrive via client_action)
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

## Page Lifecycle & Voice Resume (v0.9.0)

Fixes the Mattercraft App Clip teardown bugs (character kept speaking after the home button; voice never came back on return). Three cooperating pieces, all default-on:

1. **Hide → release** (`manageBrowserLifecycle`, default true, browser-only): `visibilitychange`(hidden)/`pagehide` call `releaseVoice()`. Its synchronous prefix emits `livekit_leave` over the still-open socket (the server deletes the room — billing and character audio stop immediately, per the 7/28 backend fix) and starts the room disconnect, before iOS suspends the page. Without this, the bot's WebRTC `<audio>` element keeps playing in the background — iOS keeps pages with active audio alive — and the room bills until the server reaper fires.
2. **Show → resume**: `visibilitychange`(visible)/`pageshow` restart voice if it was active at hide time. If the page was hidden ≥30s (`STALE_SOCKET_AFTER_HIDDEN_MS`, past the server's Engine.IO ping window), the socket is presumed a zombie — it still reports `connected` locally after iOS suspension — and is force-reconnected first. Any resume failure retries once over a guaranteed-fresh connection.
3. **Disconnect → release + resume-on-reconnect** (`resumeVoiceOnReconnect`, default true): any socket `disconnected` releases voice (a stale manager otherwise stays `isActive` — mic hot, next `startVoice()` throws VOICE_ALREADY_ACTIVE). If the drop was unexpected (not `'manual'`, not `'io server disconnect'`) and voice was active, voice restarts after the next successful connect. Idle reaps never auto-resume: `session_timeout`/`voice_timeout` null the manager synchronously before their disconnect arrives, so the flag is never set.

`SocketManager.connect()` is hardened to support this: concurrent calls dedupe onto one in-flight promise (a resume racing the engine's own reconnect must not open a second socket — the loser would hold a phantom billed session), an explicit connect clears any pending reconnect timer, the previous socket is torn down before a new `io()` is created, and `disconnect()` settles (rejects) an in-flight connect instead of leaving it hung. A failed reconnect attempt now schedules the next one (the old `.catch` comment claimed `handleDisconnect` would — it never fired on a first-attempt `connect_error`, so the retry loop silently died after one failure).

App guidance: the resumed mic comes up **unmuted** — re-apply user mute state in a `voiceStarted` handler (see estuary-web-ar-demo's `EstuaryVoiceConnection.ts`). `dispose()` (not just `disconnect()`) unbinds the lifecycle listeners when discarding a client for good.

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
