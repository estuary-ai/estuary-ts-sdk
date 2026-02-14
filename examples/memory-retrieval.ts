/**
 * Memory retrieval example (works in Node.js — no WebSocket needed).
 * Usage: npx tsx examples/memory-retrieval.ts
 */
import { EstuaryClient } from '../src';

const client = new EstuaryClient({
  serverUrl: process.env.ESTUARY_SERVER_URL || 'http://localhost:4001',
  apiKey: process.env.ESTUARY_API_KEY || 'est_your_api_key',
  characterId: process.env.ESTUARY_CHARACTER_ID || 'your-character-id',
  playerId: 'example-player',
});

async function main() {
  // Memory API uses REST — no WebSocket connection needed
  const memories = await client.memory.getMemories({ status: 'active', limit: 10 });
  console.log(`Found ${memories.total} memories`);

  const facts = await client.memory.getCoreFacts();
  console.log(`Core facts: ${facts.coreFacts.length}`);

  const graph = await client.memory.getGraph({ includeEntities: true });
  console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  const results = await client.memory.search('favorite', 5);
  console.log(`Search: ${results.total} results`);

  const timeline = await client.memory.getTimeline({ groupBy: 'week' });
  console.log(`Timeline: ${timeline.timeline.length} periods`);

  const stats = await client.memory.getStats();
  console.log('Stats:', JSON.stringify(stats, null, 2));
}

main().catch(console.error);
