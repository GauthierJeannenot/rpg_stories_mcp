// ─── Core stat types ──────────────────────────────────────────────────────────

export type StatKey = 'STR' | 'DEX' | 'CON' | 'INT' | 'WIS' | 'CHA';

export interface Stats {
  STR: number;
  DEX: number;
  CON: number;
  INT: number;
  WIS: number;
  CHA: number;
}

// ─── Items ────────────────────────────────────────────────────────────────────

export type ItemType = 'weapon' | 'armor' | 'shield' | 'consumable' | 'tool' | 'treasure' | 'misc';

export interface ItemProperties {
  damage?: string;          // e.g. "1d8"
  damageType?: string;      // slashing, piercing, bludgeoning, fire, etc.
  ac?: number;              // armor class bonus
  acBase?: number;          // base AC (for armor)
  range?: { normal: number; long: number };
  healing?: string;         // e.g. "2d4+2"
  uses?: number;
  twoHanded?: boolean;
  finesse?: boolean;
  effect?: string;
}

export interface Item {
  id: string;
  name: string;
  type: ItemType;
  description: string;
  weight: number;
  value: number;           // gold pieces
  quantity: number;
  properties?: ItemProperties;
}

// ─── Conditions ───────────────────────────────────────────────────────────────

export type Condition =
  | 'blinded' | 'charmed' | 'deafened' | 'frightened' | 'grappled'
  | 'incapacitated' | 'invisible' | 'paralyzed' | 'poisoned' | 'prone'
  | 'restrained' | 'stunned' | 'unconscious' | 'dead' | 'exhaustion_1'
  | 'exhaustion_2' | 'exhaustion_3' | 'concentrating';

// ─── Spells ───────────────────────────────────────────────────────────────────

export interface Spell {
  id: string;
  name: string;
  level: number;           // 0 = cantrip
  school: string;
  castingTime: string;
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  description: string;
  damage?: string;
  savingThrow?: StatKey;
  healingAmount?: string;
}

export interface SpellSlots {
  [level: number]: { max: number; remaining: number };
}

// ─── Entities (players, NPCs, monsters) ───────────────────────────────────────

export type EntityType = 'player' | 'npc' | 'monster';

export interface MonsterAction {
  name: string;
  description: string;
  attackBonus?: number;
  damage?: string;
  damageType?: string;
  saveDC?: number;
  saveType?: StatKey;
  recharge?: string;       // e.g. "5-6"
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;

  // Background
  class?: string;
  subclass?: string;
  race?: string;
  background?: string;
  alignment?: string;
  description?: string;

  // Level & XP
  level: number;
  xp?: number;
  xpToNextLevel?: number;

  // Core stats
  stats: Stats;
  proficiencyBonus: number;
  savingThrowProficiencies: StatKey[];
  skillProficiencies: string[];
  skills: Record<string, number>;   // skill name -> total bonus

  // Combat stats
  hp: { current: number; max: number; temporary: number };
  ac: number;
  speed: number;           // ft per turn
  initiative?: number;     // set at start of combat
  attackBonus: number;
  deathSaves?: { successes: number; failures: number };

  // Position on map (null if not placed)
  position: { x: number; y: number } | null;
  mapId?: string;

  // State
  conditions: Condition[];

  // Inventory
  inventory: Item[];
  equippedWeaponId?: string;
  equippedArmorId?: string;
  equippedShieldId?: string;
  gold: number;

  // Spellcasting
  spellcastingAbility?: StatKey;
  spellSaveDC?: number;
  spellAttackBonus?: number;
  spellSlots?: SpellSlots;
  spells?: Spell[];
  concentratingOn?: string;  // spell id

  // Monster-specific
  challengeRating?: number;
  xpReward?: number;
  actions?: MonsterAction[];
  legendaryActions?: MonsterAction[];
  reactions?: MonsterAction[];
  senses?: string[];
  languages?: string[];
  damageImmunities?: string[];
  damageResistances?: string[];
  conditionImmunities?: Condition[];
}

// ─── Map ──────────────────────────────────────────────────────────────────────

export type TerrainType =
  | 'floor' | 'wall' | 'door' | 'locked_door' | 'secret_door'
  | 'water' | 'deep_water' | 'lava' | 'chasm'
  | 'forest' | 'mountain' | 'road' | 'grass' | 'sand' | 'snow' | 'swamp'
  | 'stairs_up' | 'stairs_down' | 'trap' | 'altar' | 'chest' | 'pillar';

export interface TrapInfo {
  type: string;
  detected: boolean;
  disarmed: boolean;
  dc: number;
  damage?: string;
  effect?: string;
}

export interface DoorInfo {
  open: boolean;
  locked: boolean;
  dc?: number;
  key?: string;
}

export interface MapCell {
  x: number;
  y: number;
  terrain: TerrainType;
  passable: boolean;
  revealed: boolean;       // visible on React map (fog of war)
  visible: boolean;        // currently in line of sight
  entities: string[];      // entity IDs occupying this cell
  items: Item[];           // items on the ground
  description?: string;    // read-aloud description
  trapInfo?: TrapInfo;
  doorInfo?: DoorInfo;
  light?: 'bright' | 'dim' | 'dark';
  elevation?: number;
}

export interface PointOfInterest {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
  type: 'entrance' | 'exit' | 'landmark' | 'shop' | 'quest' | 'danger' | 'rest';
  visited: boolean;
  linkedLocationId?: string;
}

export interface GameMap {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  cellSize: number;        // feet per cell (usually 5)
  cells: MapCell[][];
  pointsOfInterest: PointOfInterest[];
  ambientLight: 'bright' | 'dim' | 'dark';
  theme?: string;          // dungeon, forest, city, cave…
}

// ─── Combat ───────────────────────────────────────────────────────────────────

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
  log: string[];           // narrative combat log
}

// ─── Quests ───────────────────────────────────────────────────────────────────

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
  objectives: QuestObjective[];
  status: 'inactive' | 'active' | 'completed' | 'failed';
  rewards?: {
    xp?: number;
    gold?: number;
    items?: Item[];
    reputation?: string;
  };
  notes: string[];
}

// ─── Adventure Module ─────────────────────────────────────────────────────────

export interface AdventureLocation {
  id: string;
  name: string;
  description: string;       // read-aloud text for players
  gmNotes: string;           // secret info / hints for the GM (LLM)
  connections: { locationId: string; direction: string; description?: string }[];
  entityIds: string[];       // default entities present
  questIds: string[];
  loot?: Item[];
}

export interface AdventureNPC {
  id: string;
  name: string;
  role: string;
  personality: string;
  motivation: string;
  dialogueHooks: string[];
  secrets: string[];
  questIds: string[];
}

export interface AdventureEncounter {
  id: string;
  name: string;
  description: string;
  trigger: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'deadly';
  monsterTemplates: string[];
  tactics: string;
  rewards: { xp: number; gold?: number };
}

export interface AdventureModule {
  id: string;
  title: string;
  synopsis: string;
  setting: string;
  tone: string;
  levelRange: { min: number; max: number };
  mainQuestId: string;
  locations: AdventureLocation[];
  npcs: AdventureNPC[];
  encounters: AdventureEncounter[];
  lore: string[];
  startingLocationId: string;
}

// ─── Game State ───────────────────────────────────────────────────────────────

export interface GameSession {
  id: string;
  name: string;
  startedAt: string;
  lastSaved?: string;
  saveSlot?: string;
}

export interface GameState {
  session: GameSession;
  currentMapId: string;
  maps: Record<string, GameMap>;
  entities: Record<string, Entity>;
  playerIds: string[];
  combat: CombatState;
  quests: Record<string, Quest>;
  adventureModule: AdventureModule;
  globalNotes: string[];
  day: number;
  timeOfDay: string;        // "14:30"
  weather: string;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

export interface DiceResult {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
  breakdown: string;
}

export interface ToolSuccess {
  success: true;
  message: string;
  data?: unknown;
}

export interface ToolFailure {
  success: false;
  message: string;
}

export type ToolResult = ToolSuccess | ToolFailure;
