import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import type Anthropic from '@anthropic-ai/sdk';
import { getMcpClient, getAnthropicTools, readMcpResource, callMcpTool } from './mcp.js';
import { runAgenticLoop } from './claude.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

const app = express();
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '50mb' }));

let cachedTools: Awaited<ReturnType<typeof getAnthropicTools>> = [];

// ─── System prompt ────────────────────────────────────────────────────────────
// Short role definition only — actual rules and module content come from
// the document blocks injected at the start of each conversation.

const SYSTEM_PROMPT = `Tu es le Narrateur et Maître du Jeu d'une partie de jeu de rôle.
Les documents de référence (module d'aventure, règles MJ, règles joueur) sont fournis
au début de la conversation. L'état courant du jeu est injecté dans chaque message.

## Rôle
1. **Narrer** les actions, décrire le monde, donner vie aux PNJ.
2. **Appliquer les mécaniques** en utilisant les outils MCP disponibles.

## Ton narratif
- Toujours décrire en 2ème personne du pluriel ("Vous entrez dans...")
- Rendre les combats cinématiques, les réussites satisfaisantes, les échecs intéressants
- Ne jamais briser l'immersion sauf si le joueur pose une question hors-jeu

## Workflow pour chaque action joueur
1. Détermine si un jet est nécessaire (ability_check, saving_throw, resolve_attack)
2. Applique les résultats mécaniques (apply_damage, heal_entity, move_entity…)
3. Met à jour les quêtes si pertinent (complete_objective, start_quest)
4. Narre le résultat de façon immersive
5. Décris ce que les joueurs voient/entendent/ressentent maintenant

## Format de réponse
- 2–4 paragraphes narratifs
- Si combat : décrit mécaniquement ET cinématiquement chaque action
- Termine par une question ouverte ou une description de la situation actuelle`;

// ─── Document injection ───────────────────────────────────────────────────────
// PDFs or Markdown files are loaded from disk and sent to Claude as document
// blocks with cache_control so Anthropic caches them across turns.

let activeModuleFileId: string | null = null;

// Per-path cache: null = not found, string = content (base64 for PDF, text for MD)
const docCache = new Map<string, { kind: 'pdf'; data: string } | { kind: 'md'; data: string } | null>();

async function loadDocEntry(basePath: string) {
  if (docCache.has(basePath)) return docCache.get(basePath)!;

  // Try PDF first, then Markdown
  for (const [ext, kind] of [['pdf', 'pdf'], ['md', 'md']] as const) {
    try {
      const raw = await fs.readFile(`${basePath}.${ext}`);
      const entry = kind === 'pdf'
        ? { kind: 'pdf' as const, data: raw.toString('base64') }
        : { kind: 'md' as const, data: raw.toString('utf-8') };
      docCache.set(basePath, entry);
      return entry;
    } catch {
      // file not found, try next extension
    }
  }

  docCache.set(basePath, null);
  return null;
}

type DocBlock = Anthropic.DocumentBlockParam & { cache_control: { type: 'ephemeral' } };

function entryToBlock(entry: { kind: 'pdf'; data: string } | { kind: 'md'; data: string }, title: string): DocBlock {
  if (entry.kind === 'pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: entry.data },
      title,
      cache_control: { type: 'ephemeral' },
    };
  }
  return {
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: entry.data },
    title,
    cache_control: { type: 'ephemeral' },
  };
}

// Returns a 2-turn context prefix (user: docs, assistant: ack) or [] if no docs found
async function buildContextMessages(): Promise<Anthropic.MessageParam[]> {
  const blocks: DocBlock[] = [];

  if (activeModuleFileId) {
    const entry = await loadDocEntry(path.join(DATA_DIR, 'adventures', activeModuleFileId));
    if (entry) blocks.push(entryToBlock(entry, 'Module d\'aventure'));
  }

  const gmEntry = await loadDocEntry(path.join(DATA_DIR, 'rules', 'gm-rules'));
  if (gmEntry) blocks.push(entryToBlock(gmEntry, 'Règles du Maître de Jeu'));

  const playerEntry = await loadDocEntry(path.join(DATA_DIR, 'rules', 'player-rules'));
  if (playerEntry) blocks.push(entryToBlock(playerEntry, 'Règles du Joueur'));

  if (blocks.length === 0) return [];

  return [
    {
      role: 'user',
      content: [
        ...blocks,
        { type: 'text', text: 'Voici les documents de référence pour cette session. Mémorise-les.' },
      ],
    },
    {
      role: 'assistant',
      content: 'J\'ai pris connaissance du module d\'aventure, des règles MJ et des règles joueur. Je suis prêt à narrer.',
    },
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readJson(uri: string) {
  try {
    const text = await readMcpResource(uri);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// List all available adventure modules (reads data/adventures/*.json)
app.get('/api/modules', async (_req, res) => {
  try {
    const dir = path.join(DATA_DIR, 'adventures');
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter(f => f.endsWith('.json'));
    } catch {
      files = [];
    }

    const modules = await Promise.all(
      files.map(async file => {
        try {
          const raw = await fs.readFile(path.join(dir, file), 'utf-8');
          const m = JSON.parse(raw);
          const fileId = file.replace('.json', '');
          // Check if a narrative document exists alongside the JSON
          const hasDoc = await fs.access(path.join(dir, `${fileId}.pdf`))
            .then(() => 'pdf')
            .catch(() => fs.access(path.join(dir, `${fileId}.md`))
              .then(() => 'md')
              .catch(() => null));
          return {
            id: m.id ?? fileId,
            title: m.title ?? fileId,
            synopsis: m.synopsis ?? '',
            setting: m.setting ?? '',
            tone: m.tone ?? '',
            levelRange: m.levelRange ?? { min: 1, max: 5 },
            mapCount: (m.maps ?? []).length,
            locationCount: (m.locations ?? []).length,
            encounterCount: (m.encounters ?? []).length,
            fileId,
            narrativeFormat: hasDoc, // 'pdf' | 'md' | null
          };
        } catch {
          return null;
        }
      }),
    );

    res.json(modules.filter(Boolean));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Load an adventure module by file ID, return fresh state
app.post('/api/modules/load', async (req, res) => {
  const { moduleId } = req.body as { moduleId: string };
  if (!moduleId) {
    res.status(400).json({ error: 'moduleId required' });
    return;
  }

  try {
    const result = await callMcpTool('load_adventure_module', { moduleId });
    const parsed = JSON.parse(result);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.message });
      return;
    }

    // Track active module and bust its doc cache entry so a fresh load is forced
    activeModuleFileId = moduleId;
    docCache.delete(path.join(DATA_DIR, 'adventures', moduleId));

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

// Full game state snapshot
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
    // Fresh game state injected into the last user message
    const stateSummary = await readMcpResource('game://state');
    const conversationMessages: Anthropic.MessageParam[] = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user') {
        return {
          role: 'user',
          content: `<game_state>\n${stateSummary}\n</game_state>\n\n${m.content}`,
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    // Prepend document context (PDFs / MD files) — Anthropic caches these via cache_control
    const contextMessages = await buildContextMessages();
    const allMessages = [...contextMessages, ...conversationMessages];

    const result = await runAgenticLoop(
      allMessages,
      cachedTools as Anthropic.Tool[],
      SYSTEM_PROMPT,
    );

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

  const PORT = process.env.PORT ?? 3001;
  app.listen(PORT, () => console.log(`\n🗡️  RPG Stories server → http://localhost:${PORT}`));
}

init().catch(err => {
  console.error('Fatal init error:', err);
  process.exit(1);
});
