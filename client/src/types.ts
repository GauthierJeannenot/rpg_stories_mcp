// Mirrors the MCP server's game state types (client-side subset)

export interface Stats {
  STR: number; DEX: number; CON: number;
  INT: number; WIS: number; CHA: number;
}

export interface Item {
  id: string;
  name: string;
  type: string;
  description: string;
  quantity: number;
  value: number;
  properties?: { damage?: string; healing?: string; ac?: number; effect?: string };
}

export interface Entity {
  id: string;
  name: string;
  type: 'player' | 'npc' | 'monster';
  class?: string;
  race?: string;
  level: number;
  stats: Stats;
  hp: { current: number; max: number; temporary: number };
  ac: number;
  speed: number;
  initiative?: number;
  conditions: string[];
  position: { x: number; y: number } | null;
  mapId?: string;
  gold: number;
  inventory: Item[];
  equippedWeaponId?: string;
  xp?: number;
  description?: string;
  challengeRating?: number;
}

export interface MapCell {
  x: number;
  y: number;
  revealed: boolean;
  visible: boolean;
  blocked: boolean;
  entities: string[];
  items: Item[];
  description?: string;
}

export interface PointOfInterest {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
  type: string;
  visited: boolean;
}

export interface GameMap {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  cellSize: number;
  imageKey?: string;
  cells: MapCell[][];
  pointsOfInterest: PointOfInterest[];
  ambientLight: 'bright' | 'dim' | 'dark';
}

export interface CombatTurn {
  entityId: string;
  initiative: number;
  hasAction: boolean;
  hasBonusAction: boolean;
  hasReaction: boolean;
  movementRemaining: number;
  isDead: boolean;
}

export interface CombatState {
  active: boolean;
  round: number;
  turnOrder: CombatTurn[];
  currentTurnIndex: number;
  log: string[];
}

export interface QuestObjective {
  id: string;
  description: string;
  completed: boolean;
  optional: boolean;
  count?: { current: number; required: number };
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  giver?: string;
  status: 'inactive' | 'active' | 'completed' | 'failed';
  objectives: QuestObjective[];
  rewards?: { xp?: number; gold?: number };
  notes: string[];
}

// Summary returned by game://state
export interface StateSummary {
  session: { id: string; name: string; startedAt: string };
  day: number;
  timeOfDay: string;
  weather: string;
  currentMapId: string;
  mapName?: string;
  players: {
    id: string;
    name: string;
    hp: { current: number; max: number; temporary: number };
    ac: number;
    conditions: string[];
    position: { x: number; y: number } | null;
  }[];
  activeCombat: boolean;
  currentTurn: CombatTurn | null;
  activeQuests: { id: string; title: string; objectives: QuestObjective[] }[];
  globalNotes: string[];
}

export interface GameData {
  state: StateSummary | null;
  map: GameMap | null;
  entities: Record<string, Entity>;
  combat: CombatState | null;
  quests: Record<string, Quest>;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallRecord[];
  timestamp: number;
}
