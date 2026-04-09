import type { GameData, ToolCallRecord } from './types';

const BASE = '/api'; // proxied by Vite to http://localhost:3001

export async function fetchGameState(): Promise<GameData> {
  const res = await fetch(`${BASE}/state`);
  if (!res.ok) throw new Error(`State fetch failed: ${res.statusText}`);
  return res.json();
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCallRecord[];
  state: GameData['state'];
  map: GameData['map'];
  entities: GameData['entities'];
  combat: GameData['combat'];
  quests: GameData['quests'];
}

export async function sendMessage(
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}
