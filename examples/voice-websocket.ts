/**
 * WebSocket voice chat example (browser environment required).
 */
import { EstuaryClient } from '../src';

const client = new EstuaryClient({
  serverUrl: 'http://localhost:4001',
  apiKey: 'est_your_api_key',
  characterId: 'your-character-id',
  playerId: 'voice-demo-player',
  voiceTransport: 'websocket',
  debug: true,
});

client.on('sttResponse', (stt) => {
  console.log(stt.isFinal ? `[You] ${stt.text}` : `[You...] ${stt.text}`);
});

client.on('botResponse', (r) => {
  if (r.isFinal) console.log(`[Bot] ${r.text}`);
});

client.on('audioPlaybackComplete', (id) => console.log('Audio done:', id));

async function main() {
  await client.connect();
  await client.startVoice();
  console.log('Voice active! Speak into your microphone.');
}

main().catch(console.error);
