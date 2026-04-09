import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { rollDice, rollD, statModifier, attackRoll, rollDamage } from './dice.js';
import type {
  GameState, Entity, Item, Quest,
  AdventureModule, GameMap, MapCell, Condition,
  ToolResult, CombatTurn,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAVES_DIR = path.join(__dirname, '../../saves');
const DATA_DIR  = path.join(__dirname, '../../data');

// ─── Default adventure module stub (replaced when data file is loaded) ────────

function makeDefaultAdventureModule(): AdventureModule {
  return {
    id: 'la-mine-des-ombres',
    title: 'La Mine des Ombres',
    synopsis: 'Les aventuriers sont engagés pour explorer une mine abandonnée d\'où des créatures ont commencé à émerger.',
    setting: 'Un complexe minier souterrain infesté de morts-vivants et de démons mineurs.',
    tone: 'Sombre, tendu, avec des moments de découverte et d\'horreur.',
    levelRange: { min: 1, max: 3 },
    mainQuestId: 'quest-main',
    startingLocationId: 'loc-entrance',
    locations: [
      {
        id: 'loc-entrance',
        name: 'Hall d\'entrée',
        description: 'L\'air froid s\'engouffre depuis la surface. Des murs de pierre noire suintent d\'humidité. Deux torches éteintes flanquent un couloir sombre vers le bas.',
        gmNotes: 'Premier contact. Laisser les joueurs s\'orienter. Un goblin explorateur peut être présent si l\'alarme n\'a pas été déclenchée.',
        connections: [{ locationId: 'loc-guard', direction: 'south', description: 'Un couloir s\'enfonce vers le bas.' }],
        entityIds: [],
        questIds: [],
      },
      {
        id: 'loc-guard',
        name: 'Salle de garde',
        description: 'Une ancienne salle de repos des mineurs. Des casiers fracturés, une table renversée. Odeur de chair en décomposition.',
        gmNotes: 'Deux squelettes patrouillent. Fouille: clé de la salle du boss (Perception DC 14), 15 po dans un casier.',
        connections: [
          { locationId: 'loc-entrance', direction: 'north' },
          { locationId: 'loc-central', direction: 'east' },
        ],
        entityIds: ['skeleton-1', 'skeleton-2'],
        questIds: ['quest-main'],
        loot: [
          { id: uuidv4(), name: 'Clé rouillée', type: 'tool', description: 'Une clé en fer rouillée. Elle ouvre quelque chose en bas.', weight: 0.1, value: 0, quantity: 1 },
        ],
      },
      {
        id: 'loc-central',
        name: 'Hall central',
        description: 'Une large salle voûtée. Des colonnes de pierre soutiennent le plafond. Au centre, un puits scellé par une grille cadenassée.',
        gmNotes: 'Le puits descend vers une poche de gaz (si ouvert, poison DC 13 CON, 2d6 dégâts). NPC mineur Gorrick peut être trouvé ici, blessé.',
        connections: [
          { locationId: 'loc-guard', direction: 'west' },
          { locationId: 'loc-boss', direction: 'south', description: 'Une lourde porte ferrée.' },
        ],
        entityIds: ['gorrick-npc'],
        questIds: ['quest-main', 'quest-gorrick'],
      },
      {
        id: 'loc-boss',
        name: 'Chambre du Seigneur Ombre',
        description: 'Une vaste salle taillée dans la roche noire. Des runes rougeoyantes couvrent le sol. Au centre, une silhouette encapuchonnée se tient sur un pentagramme.',
        gmNotes: 'Boss: Umbrak le Seigneur Ombre (spectre de niveau 3). Phase 1: invoque 2 squelettes. Phase 2 (<50% hp): vol + attaque de terreur. Trésor: Épée du Crépuscule + 200po + gemmes.',
        connections: [{ locationId: 'loc-central', direction: 'north' }],
        entityIds: ['umbrak-boss'],
        questIds: ['quest-main'],
      },
    ],
    npcs: [
      {
        id: 'gorrick-npc',
        name: 'Gorrick le Mineur',
        role: 'Survivant blessé',
        personality: 'Effrayé, reconnaissant, parle vite.',
        motivation: 'Fuir la mine et retrouver sa famille.',
        dialogueHooks: [
          'Il décrit le Seigneur Ombre qu\'il a aperçu dans les profondeurs.',
          'Il mentionne la clé cachée dans la salle de garde.',
          'Il supplie les joueurs de l\'escorter vers la sortie.',
        ],
        secrets: [
          'Il a accidentellement brisé le sceau qui a libéré les créatures.',
          'Il cache 50 po sur lui.',
        ],
        questIds: ['quest-gorrick'],
      },
    ],
    encounters: [
      {
        id: 'enc-patrol',
        name: 'Patrouille de squelettes',
        description: 'Deux squelettes armés de vieilles piques patrouillent la salle de garde.',
        trigger: 'Entrée dans la salle de garde',
        difficulty: 'easy',
        monsterTemplates: ['skeleton', 'skeleton'],
        tactics: 'Les squelettes attaquent le personnage le plus proche. Ils ne fuient jamais.',
        rewards: { xp: 100, gold: 0 },
      },
      {
        id: 'enc-boss',
        name: 'Umbrak le Seigneur Ombre',
        description: 'Un spectre puissant lié à la mine par un ancien rituel.',
        trigger: 'Entrée dans la chambre du boss',
        difficulty: 'hard',
        monsterTemplates: ['shadow_lord'],
        tactics: 'Commence par invoquer des squelettes. En dessous de 50% PV: passe en vol et utilise Terreur Obscure.',
        rewards: { xp: 700, gold: 200 },
      },
    ],
    lore: [
      'La mine fut creusée il y a 200 ans par le clan Duradin.',
      'Un accident provoqua l\'effondrement d\'une galerie, tuant 30 mineurs.',
      'Leurs âmes sont restées piégées, corrompues par un shard de cristal ténébreux.',
      'Umbrak était autrefois le contremaître de la mine, mort dans l\'effondrement.',
      'Le cristal ténébreux est au cœur du pentagramme dans la chambre du boss.',
    ],
  };
}

function makeDefaultState(): GameState {
  return {
    session: {
      id: uuidv4(),
      name: 'Partie sans titre',
      startedAt: new Date().toISOString(),
    },
    currentMapId: '',
    maps: {},
    entities: {},
    playerIds: [],
    combat: {
      active: false,
      round: 0,
      turnOrder: [],
      currentTurnIndex: 0,
      log: [],
    },
    quests: {},
    adventureModule: makeDefaultAdventureModule(),
    globalNotes: [],
    day: 1,
    timeOfDay: '18:00',
    weather: 'Clair.',
  };
}

// ─── GameEngine singleton ──────────────────────────────────────────────────────

export class GameEngine {
  private static _instance: GameEngine;
  private state: GameState;

  private constructor() {
    this.state = makeDefaultState();
  }

  static getInstance(): GameEngine {
    if (!GameEngine._instance) {
      GameEngine._instance = new GameEngine();
    }
    return GameEngine._instance;
  }

  // ── State access ─────────────────────────────────────────────────────────

  getState(): GameState { return this.state; }

  getMap(mapId?: string): GameMap | undefined {
    return this.state.maps[mapId ?? this.state.currentMapId];
  }

  getEntity(id: string): Entity | undefined {
    return this.state.entities[id];
  }

  getPlayers(): Entity[] {
    return this.state.playerIds.map(id => this.state.entities[id]).filter(Boolean);
  }

  getCurrentCombatTurn(): CombatTurn | null {
    const { active, turnOrder, currentTurnIndex } = this.state.combat;
    if (!active || turnOrder.length === 0) return null;
    return turnOrder[currentTurnIndex] ?? null;
  }

  // ── Entity operations ─────────────────────────────────────────────────────

  createEntity(data: Omit<Entity, 'id'>): ToolResult {
    const id = uuidv4();
    const entity: Entity = { ...data, id };
    this.state.entities[id] = entity;
    if (entity.type === 'player') this.state.playerIds.push(id);
    return { success: true, message: `Entité "${entity.name}" créée.`, data: entity };
  }

  updateEntity(id: string, updates: Partial<Omit<Entity, 'id'>>): ToolResult {
    const entity = this.state.entities[id];
    if (!entity) return { success: false, message: `Entité "${id}" introuvable.` };
    Object.assign(entity, updates);
    return { success: true, message: `"${entity.name}" mis à jour.`, data: entity };
  }

  removeEntity(id: string): ToolResult {
    const entity = this.state.entities[id];
    if (!entity) return { success: false, message: `Entité "${id}" introuvable.` };
    delete this.state.entities[id];
    this.state.playerIds = this.state.playerIds.filter(pid => pid !== id);
    // Remove from map
    for (const map of Object.values(this.state.maps)) {
      for (const row of map.cells) {
        for (const cell of row) {
          cell.entities = cell.entities.filter(eid => eid !== id);
        }
      }
    }
    return { success: true, message: `"${entity.name}" supprimé.` };
  }

  // ── Map operations ────────────────────────────────────────────────────────

  createMap(config: {
    id?: string;
    name: string;
    description?: string;
    width: number;
    height: number;
    cellSize?: number;
    imageKey?: string;
    ambientLight?: GameMap['ambientLight'];
  }): ToolResult {
    const id = config.id ?? config.name.toLowerCase().replace(/\s+/g, '-');
    if (this.state.maps[id]) return { success: false, message: `Une carte avec l'id "${id}" existe déjà.` };

    // Build empty cell grid — all unrevealed, not blocked by default
    const cells: MapCell[][] = [];
    for (let y = 0; y < config.height; y++) {
      cells[y] = [];
      for (let x = 0; x < config.width; x++) {
        cells[y][x] = { x, y, revealed: false, visible: false, blocked: false, entities: [], items: [] };
      }
    }

    const map: GameMap = {
      id,
      name: config.name,
      description: config.description ?? '',
      width: config.width,
      height: config.height,
      cellSize: config.cellSize ?? 64,
      imageKey: config.imageKey,
      cells,
      pointsOfInterest: [],
      ambientLight: config.ambientLight ?? 'dim',
    };

    this.state.maps[id] = map;
    if (!this.state.currentMapId) this.state.currentMapId = id;
    return { success: true, message: `Carte "${map.name}" créée (${config.width}×${config.height}).`, data: { id, width: config.width, height: config.height } };
  }

  setCurrentMap(mapId: string): ToolResult {
    if (!this.state.maps[mapId]) return { success: false, message: `Carte "${mapId}" introuvable.` };
    this.state.currentMapId = mapId;
    return { success: true, message: `Carte courante: "${this.state.maps[mapId].name}".` };
  }

  moveEntity(entityId: string, x: number, y: number, mapId?: string): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };

    const targetMapId = mapId ?? this.state.currentMapId;
    const map = this.state.maps[targetMapId];
    if (!map) return { success: false, message: `Carte "${targetMapId}" introuvable.` };

    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
      return { success: false, message: `Position (${x},${y}) hors de la carte.` };
    }

    const cell = map.cells[y][x];
    if (cell.blocked) {
      return { success: false, message: `La case (${x},${y}) est bloquée.` };
    }

    // Remove from old position
    if (entity.position) {
      const oldCell = map.cells[entity.position.y]?.[entity.position.x];
      if (oldCell) oldCell.entities = oldCell.entities.filter(id => id !== entityId);
    }

    // Place at new position
    entity.position = { x, y };
    entity.mapId = targetMapId;
    cell.entities.push(entityId);

    // Reveal area around new position
    this.revealArea(x, y, 3, targetMapId);

    return { success: true, message: `"${entity.name}" déplacé en (${x},${y}).`, data: { x, y } };
  }

  revealArea(cx: number, cy: number, radius: number, mapId?: string): void {
    const map = this.state.maps[mapId ?? this.state.currentMapId];
    if (!map) return;
    for (let y = Math.max(0, cy - radius); y <= Math.min(map.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(map.width - 1, cx + radius); x++) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (dist <= radius) {
          map.cells[y][x].revealed = true;
          map.cells[y][x].visible = dist <= radius * 0.6;
        }
      }
    }
  }

  updateCell(x: number, y: number, updates: Partial<MapCell>, mapId?: string): ToolResult {
    const map = this.state.maps[mapId ?? this.state.currentMapId];
    if (!map) return { success: false, message: 'Carte introuvable.' };
    if (x < 0 || x >= map.width || y < 0 || y >= map.height) {
      return { success: false, message: `Position (${x},${y}) hors de la carte.` };
    }
    Object.assign(map.cells[y][x], updates);
    return { success: true, message: `Case (${x},${y}) mise à jour.`, data: map.cells[y][x] };
  }

  // ── Combat operations ─────────────────────────────────────────────────────

  startCombat(participantIds: string[]): ToolResult {
    if (this.state.combat.active) {
      return { success: false, message: 'Un combat est déjà en cours.' };
    }

    const missing = participantIds.filter(id => !this.state.entities[id]);
    if (missing.length > 0) {
      return { success: false, message: `Entités introuvables: ${missing.join(', ')}` };
    }

    // Roll initiative for each participant
    const turns: CombatTurn[] = participantIds.map(id => {
      const e = this.state.entities[id];
      const dexMod = statModifier(e.stats.DEX);
      const initiative = rollD(20) + dexMod;
      e.initiative = initiative;
      return {
        entityId: id,
        initiative,
        hasAction: true,
        hasBonusAction: true,
        hasReaction: true,
        movementRemaining: e.speed,
        isDead: false,
      };
    });

    // Sort by initiative descending (ties broken by DEX)
    turns.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      const dexA = this.state.entities[a.entityId].stats.DEX;
      const dexB = this.state.entities[b.entityId].stats.DEX;
      return dexB - dexA;
    });

    this.state.combat = {
      active: true,
      round: 1,
      turnOrder: turns,
      currentTurnIndex: 0,
      log: [`⚔️ Combat commencé! Round 1. Initiative: ${turns.map(t => `${this.state.entities[t.entityId].name}(${t.initiative})`).join(' > ')}`],
    };

    return {
      success: true,
      message: 'Combat démarré.',
      data: { turnOrder: turns.map(t => ({ name: this.state.entities[t.entityId].name, initiative: t.initiative })) },
    };
  }

  resolveAttack(attackerId: string, targetId: string, weaponId?: string): ToolResult {
    const attacker = this.state.entities[attackerId];
    const target = this.state.entities[targetId];
    if (!attacker) return { success: false, message: `Attaquant "${attackerId}" introuvable.` };
    if (!target) return { success: false, message: `Cible "${targetId}" introuvable.` };
    if (target.conditions.includes('dead')) {
      return { success: false, message: `${target.name} est déjà mort.` };
    }

    // Determine weapon
    const weapon = weaponId
      ? attacker.inventory.find(i => i.id === weaponId)
      : attacker.inventory.find(i => i.id === attacker.equippedWeaponId);

    const attackBonus = attacker.attackBonus;
    const damageDice = weapon?.properties?.damage ?? '1d4';
    const damageType = weapon?.properties?.damageType ?? 'bludgeoning';

    const hit = attackRoll(attackBonus, target.ac);
    let damageDealt = 0;
    let damageBreakdown = '';

    if (hit.success) {
      const dmg = rollDamage(hit.critical ? `${damageDice}+${damageDice}` : damageDice);
      damageDealt = Math.max(0, dmg.total);
      damageBreakdown = dmg.breakdown;
      this.applyDamage(targetId, damageDealt, damageType);
    }

    const logEntry = hit.success
      ? `${attacker.name} frappe ${target.name} [${hit.breakdown}] pour ${damageDealt} dégâts (${damageType}) [${damageBreakdown}].${hit.critical ? ' COUP CRITIQUE!' : ''}`
      : `${attacker.name} rate ${target.name} [${hit.breakdown}].${hit.fumble ? ' FUMBLE!' : ''}`;

    this.state.combat.log.push(logEntry);

    return {
      success: true,
      message: logEntry,
      data: { hit: hit.success, critical: hit.critical, fumble: hit.fumble, damageDealt, targetHp: target.hp },
    };
  }

  applyDamage(entityId: string, amount: number, damageType: string = 'untyped'): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };

    // Temporary HP absorbs first
    let remaining = amount;
    if (entity.hp.temporary > 0) {
      const absorbed = Math.min(entity.hp.temporary, remaining);
      entity.hp.temporary -= absorbed;
      remaining -= absorbed;
    }

    entity.hp.current = Math.max(0, entity.hp.current - remaining);

    let msg = `${entity.name} subit ${amount} dégâts (${damageType}). PV: ${entity.hp.current}/${entity.hp.max}`;

    if (entity.hp.current <= 0) {
      if (entity.type === 'player') {
        entity.conditions.push('unconscious');
        msg += ' — INCONSCIENT (jets de sauvegarde contre la mort)';
      } else {
        entity.conditions.push('dead');
        msg += ' — MORT';
        this.removeEntityFromMap(entityId);
      }
    }

    this.state.combat.log.push(msg);
    return { success: true, message: msg, data: entity.hp };
  }

  healEntity(entityId: string, amount: number, temporary = false): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };

    if (temporary) {
      entity.hp.temporary += amount;
    } else {
      entity.conditions = entity.conditions.filter(c => c !== 'unconscious');
      entity.hp.current = Math.min(entity.hp.max, entity.hp.current + amount);
    }

    const msg = `${entity.name} récupère ${amount} PV${temporary ? ' temporaires' : ''}. PV: ${entity.hp.current}/${entity.hp.max}`;
    return { success: true, message: msg, data: entity.hp };
  }

  applyCondition(entityId: string, condition: Condition): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };
    if (!entity.conditions.includes(condition)) {
      entity.conditions.push(condition);
    }
    return { success: true, message: `${entity.name} est maintenant ${condition}.` };
  }

  removeCondition(entityId: string, condition: Condition): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };
    entity.conditions = entity.conditions.filter(c => c !== condition);
    return { success: true, message: `Condition ${condition} retirée de ${entity.name}.` };
  }

  advanceTurn(): ToolResult {
    const combat = this.state.combat;
    if (!combat.active) return { success: false, message: 'Aucun combat actif.' };

    // Find next non-dead participant
    let next = (combat.currentTurnIndex + 1) % combat.turnOrder.length;
    let loops = 0;
    while (combat.turnOrder[next].isDead && loops < combat.turnOrder.length) {
      next = (next + 1) % combat.turnOrder.length;
      loops++;
    }

    // New round?
    if (next <= combat.currentTurnIndex) {
      combat.round++;
      combat.log.push(`\n--- Round ${combat.round} ---`);
    }

    combat.currentTurnIndex = next;

    // Reset turn resources
    const turn = combat.turnOrder[next];
    const entity = this.state.entities[turn.entityId];
    turn.hasAction = true;
    turn.hasBonusAction = true;
    turn.hasReaction = true;
    turn.movementRemaining = entity?.speed ?? 30;

    const msg = `C'est le tour de ${entity?.name ?? turn.entityId} (initiative ${turn.initiative}).`;
    combat.log.push(msg);
    return { success: true, message: msg, data: turn };
  }

  endCombat(outcome: string): ToolResult {
    this.state.combat = {
      active: false,
      round: 0,
      turnOrder: [],
      currentTurnIndex: 0,
      log: [...this.state.combat.log, `\n✅ Combat terminé: ${outcome}`],
    };
    return { success: true, message: `Combat terminé. ${outcome}` };
  }

  // ── Inventory operations ──────────────────────────────────────────────────

  addItem(entityId: string, itemData: Omit<Item, 'id'>): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };
    const item: Item = { ...itemData, id: uuidv4() };
    entity.inventory.push(item);
    return { success: true, message: `"${item.name}" ajouté à l'inventaire de ${entity.name}.`, data: item };
  }

  removeItem(entityId: string, itemId: string): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };
    const idx = entity.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return { success: false, message: `Objet "${itemId}" introuvable dans l'inventaire.` };
    const [removed] = entity.inventory.splice(idx, 1);
    return { success: true, message: `"${removed.name}" retiré de l'inventaire de ${entity.name}.` };
  }

  equipItem(entityId: string, itemId: string): ToolResult {
    const entity = this.state.entities[entityId];
    if (!entity) return { success: false, message: `Entité "${entityId}" introuvable.` };
    const item = entity.inventory.find(i => i.id === itemId);
    if (!item) return { success: false, message: `Objet "${itemId}" introuvable.` };

    if (item.type === 'weapon') {
      entity.equippedWeaponId = itemId;
    } else if (item.type === 'armor') {
      entity.equippedArmorId = itemId;
      if (item.properties?.acBase) entity.ac = item.properties.acBase + statModifier(entity.stats.DEX);
    } else if (item.type === 'shield') {
      entity.equippedShieldId = itemId;
      entity.ac += item.properties?.ac ?? 2;
    } else {
      return { success: false, message: `"${item.name}" ne peut pas être équipé.` };
    }

    return { success: true, message: `${entity.name} équipe "${item.name}".` };
  }

  transferItem(fromId: string, toId: string, itemId: string): ToolResult {
    const from = this.state.entities[fromId];
    const to = this.state.entities[toId];
    if (!from) return { success: false, message: `Entité source "${fromId}" introuvable.` };
    if (!to) return { success: false, message: `Entité cible "${toId}" introuvable.` };

    const idx = from.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return { success: false, message: `Objet "${itemId}" introuvable chez ${from.name}.` };

    const [item] = from.inventory.splice(idx, 1);
    to.inventory.push(item);
    return { success: true, message: `"${item.name}" transféré de ${from.name} à ${to.name}.` };
  }

  // ── Quest operations ──────────────────────────────────────────────────────

  addQuest(questData: Omit<Quest, 'id'>): ToolResult {
    const id = uuidv4();
    const quest: Quest = { ...questData, id };
    this.state.quests[id] = quest;
    return { success: true, message: `Quête "${quest.title}" ajoutée.`, data: quest };
  }

  updateQuestObjective(questId: string, objectiveId: string, completed: boolean, count?: number): ToolResult {
    const quest = this.state.quests[questId];
    if (!quest) return { success: false, message: `Quête "${questId}" introuvable.` };
    const obj = quest.objectives.find(o => o.id === objectiveId);
    if (!obj) return { success: false, message: `Objectif "${objectiveId}" introuvable.` };

    obj.completed = completed;
    if (count !== undefined && obj.count) obj.count.current = count;

    const allDone = quest.objectives.filter(o => !o.optional).every(o => o.completed);
    if (allDone && quest.status === 'active') {
      quest.status = 'completed';
      return { success: true, message: `Objectif complété. 🎉 Quête "${quest.title}" terminée!`, data: quest };
    }

    return { success: true, message: `Objectif "${obj.description}" ${completed ? 'complété' : 'mis à jour'}.`, data: quest };
  }

  setQuestStatus(questId: string, status: Quest['status'], note?: string): ToolResult {
    const quest = this.state.quests[questId];
    if (!quest) return { success: false, message: `Quête "${questId}" introuvable.` };
    quest.status = status;
    if (note) quest.notes.push(note);
    return { success: true, message: `Quête "${quest.title}" → ${status}.`, data: quest };
  }

  // ── XP & leveling ─────────────────────────────────────────────────────────

  awardXP(playerIds: string[], amount: number): ToolResult {
    const results: string[] = [];
    for (const id of playerIds) {
      const p = this.state.entities[id];
      if (!p || p.type !== 'player') continue;
      p.xp = (p.xp ?? 0) + amount;
      const next = p.xpToNextLevel ?? 300;
      if (p.xp >= next) {
        p.level++;
        results.push(`${p.name} gagne ${amount} XP et passe au niveau ${p.level}! 🎊`);
      } else {
        results.push(`${p.name} gagne ${amount} XP (${p.xp}/${next}).`);
      }
    }
    return { success: true, message: results.join('\n') };
  }

  // ── Session ───────────────────────────────────────────────────────────────

  async saveGame(slot: string = 'default'): Promise<ToolResult> {
    try {
      await fs.mkdir(SAVES_DIR, { recursive: true });
      const file = path.join(SAVES_DIR, `${slot}.json`);
      this.state.session.lastSaved = new Date().toISOString();
      this.state.session.saveSlot = slot;
      await fs.writeFile(file, JSON.stringify(this.state, null, 2), 'utf-8');
      return { success: true, message: `Partie sauvegardée dans le slot "${slot}".` };
    } catch (e) {
      return { success: false, message: `Erreur de sauvegarde: ${String(e)}` };
    }
  }

  async loadGame(slot: string = 'default'): Promise<ToolResult> {
    try {
      const file = path.join(SAVES_DIR, `${slot}.json`);
      const raw = await fs.readFile(file, 'utf-8');
      this.state = JSON.parse(raw) as GameState;
      return { success: true, message: `Partie "${slot}" chargée.` };
    } catch (e) {
      return { success: false, message: `Impossible de charger "${slot}": ${String(e)}` };
    }
  }

  async listSaves(): Promise<string[]> {
    try {
      await fs.mkdir(SAVES_DIR, { recursive: true });
      const files = await fs.readdir(SAVES_DIR);
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  async loadRulesFile(type: 'player' | 'gm'): Promise<string> {
    try {
      const file = path.join(DATA_DIR, 'rules', `${type}-rules.md`);
      return await fs.readFile(file, 'utf-8');
    } catch {
      return `[Fichier de règles "${type}" introuvable]`;
    }
  }

  async loadAdventureModule(moduleId: string): Promise<ToolResult> {
    try {
      const file = path.join(DATA_DIR, 'adventures', `${moduleId}.json`);
      const raw = await fs.readFile(file, 'utf-8');
      this.state.adventureModule = JSON.parse(raw) as AdventureModule;
      return { success: true, message: `Module "${moduleId}" chargé.` };
    } catch (e) {
      return { success: false, message: `Module "${moduleId}" introuvable: ${String(e)}` };
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private removeEntityFromMap(entityId: string): void {
    for (const map of Object.values(this.state.maps)) {
      for (const row of map.cells) {
        for (const cell of row) {
          cell.entities = cell.entities.filter(id => id !== entityId);
        }
      }
    }
    const e = this.state.entities[entityId];
    if (e) e.position = null;
  }

  setTime(timeOfDay: string, day?: number, weather?: string): ToolResult {
    this.state.timeOfDay = timeOfDay;
    if (day !== undefined) this.state.day = day;
    if (weather) this.state.weather = weather;
    return { success: true, message: `Heure: ${timeOfDay}, Jour ${this.state.day}, Météo: ${this.state.weather}` };
  }

  addGlobalNote(note: string): ToolResult {
    this.state.globalNotes.push(`[Jour ${this.state.day} ${this.state.timeOfDay}] ${note}`);
    return { success: true, message: 'Note ajoutée.' };
  }
}
