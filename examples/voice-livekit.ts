/**
 * LiveKit voice chat example (requires livekit-client + browser).
 */
import { EstuaryClient } from '../src';

const client = new EstuaryClient({
  serverUrl: 'http://localhost:4001',
  apiKey: 'est_your_api_key',
  characterId: 'your-character-id',
  playerId: 'livekit-demo-player',
  voiceTransport: 'livekit',
  debug: true,
});

client.on('livekitConnected', (room) => console.log('LiveKit room:', room));
client.on('sttResponse', (stt) => {
  if (stt.isFinal) console.log(`[You] ${stt.text}`);
});
client.on('botResponse', (r) => {
  if (r.isFinal) console.log(`[Bot] ${r.text}`);
});

async function main() {
  await client.connect();
  await client.startVoice();
  console.log('Voice active with LiveKit WebRTC!');
}

main().catch(console.error);
