/**
 * Basic text chat example.
 * Usage: npx tsx examples/basic-text-chat.ts
 */
import { EstuaryClient } from '../src';

const client = new EstuaryClient({
  serverUrl: process.env.ESTUARY_SERVER_URL || 'http://localhost:4001',
  apiKey: process.env.ESTUARY_API_KEY || 'est_your_api_key',
  characterId: process.env.ESTUARY_CHARACTER_ID || 'your-character-id',
  playerId: 'example-player',
  debug: true,
});

client.on('botResponse', (response) => {
  process.stdout.write(response.text);
  if (response.isFinal) console.log('\n---');
});

client.on('error', (error) => console.error('Error:', error.message));

async function main() {
  const session = await client.connect();
  console.log('Connected! Session:', session.sessionId);

  client.sendText('Hello!');
  await new Promise((r) => setTimeout(r, 5000));

  client.sendText('What do you remember about me?');
  await new Promise((r) => setTimeout(r, 5000));

  client.disconnect();
}

main().catch(console.error);
