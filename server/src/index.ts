import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type Anthropic from '@anthropic-ai/sdk';
import { getMcpClient, getAnthropicTools, readMcpResource, getMcpPrompt } from './mcp.js';
import { runAgenticLoop } from './claude.js';

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '2mb' }));

let cachedTools: Awaited<ReturnType<typeof getAnthropicTools>> = [];
let systemPrompt = '';

async function readJson(uri: string) {
  try {
    const text = await readMcpResource(uri);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Full game state for initial load + React state sync
app.get('/api/state', async (_req, res) => {
  try {
    const [state, map, entities, combat, quests] = await Promise.all([
      readJson('game://state'),
      readJson('game://map'),
      readJson('game://entities'),
      readJson('game://combat'),
      readJson('game://quests'),
    ]);
    res.json({ state, map, entities, combat, quests });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Main chat endpoint — runs Claude agentic loop with MCP tools
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] };

  try {
    // Inject fresh game state into the context of the last user message
    const stateSummary = await readMcpResource('game://state');
    const typedMessages = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user') {
        return {
          role: 'user' as const,
          content: `<game_state>\n${stateSummary}\n</game_state>\n\n${m.content}`,
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    const result = await runAgenticLoop(
      typedMessages as Anthropic.MessageParam[],
      cachedTools as Anthropic.Tool[],
      systemPrompt,
    );

    // Return updated state so React can re-render immediately
    const [updatedState, updatedMap, updatedEntities, updatedCombat, updatedQuests] = await Promise.all([
      readJson('game://state'),
      readJson('game://map'),
      readJson('game://entities'),
      readJson('game://combat'),
      readJson('game://quests'),
    ]);

    res.json({
      text: result.text,
      toolCalls: result.toolCalls,
      state: updatedState,
      map: updatedMap,
      entities: updatedEntities,
      combat: updatedCombat,
      quests: updatedQuests,
    });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  console.log('⚙️  Connecting to MCP game engine...');
  await getMcpClient();

  cachedTools = await getAnthropicTools();
  console.log(`✅ ${cachedTools.length} tools loaded`);

  try {
    systemPrompt = await getMcpPrompt('narrator');
    console.log('✅ Narrator prompt loaded');
  } catch {
    systemPrompt = 'Tu es le narrateur et maître du jeu d\'un RPG de style D&D.';
    console.warn('⚠️  Narrator prompt not found, using fallback');
  }

  const PORT = process.env.PORT ?? 3001;
  app.listen(PORT, () => console.log(`\n🗡️  RPG Stories server → http://localhost:${PORT}`));
}

init().catch(err => {
  console.error('Fatal init error:', err);
  process.exit(1);
});
