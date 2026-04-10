import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GameEngine } from './game/GameEngine.js';
import { rollDice, d20Check, statModifier } from './game/dice.js';
import type { Condition, Entity, Item, Quest } from './game/types.js';

const engine = GameEngine.getInstance();

// ─── Helper: wrap engine result as MCP tool response ──────────────────────────

function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

function err(msg: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, message: msg }) }] };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  // ── Dice & Checks ──────────────────────────────────────────────────────────
  {
    name: 'roll_dice',
    description: 'Lance des dés avec une notation standard (ex: "2d6+3", "1d20", "4d6kh3"). Retourne chaque résultat individuel et le total.',
    inputSchema: {
      type: 'object', required: ['notation'],
      properties: {
        notation: { type: 'string', description: 'Notation de dés: "1d20", "2d8+5", "4d6kh3" (garde les 3 plus hauts)' },
        label: { type: 'string', description: 'Contexte du jet (ex: "Attaque épée", "Initiative")' },
      },
    },
  },
  {
    name: 'ability_check',
    description: 'Effectue un jet de caractéristique (d20 + modificateur) pour une entité contre une difficulté (DC). Retourne succès/échec, critique, fumble.',
    inputSchema: {
      type: 'object', required: ['entityId', 'stat', 'dc'],
      properties: {
        entityId: { type: 'string', description: 'ID de l\'entité qui fait le jet' },
        stat: { type: 'string', enum: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'], description: 'Caractéristique utilisée' },
        dc: { type: 'number', description: 'Difficulté (Difficulty Class)' },
        advantage: { type: 'boolean', description: 'Avantage: lance 2d20, garde le plus haut' },
        disadvantage: { type: 'boolean', description: 'Désavantage: lance 2d20, garde le plus bas' },
      },
    },
  },
  {
    name: 'saving_throw',
    description: 'Effectue un jet de sauvegarde pour une entité contre un DC.',
    inputSchema: {
      type: 'object', required: ['entityId', 'stat', 'dc'],
      properties: {
        entityId: { type: 'string' },
        stat: { type: 'string', enum: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] },
        dc: { type: 'number' },
        advantage: { type: 'boolean' },
        disadvantage: { type: 'boolean' },
      },
    },
  },

  // ── Entities ───────────────────────────────────────────────────────────────
  {
    name: 'create_entity',
    description: 'Crée un joueur, PNJ ou monstre et l\'ajoute à l\'état du jeu.',
    inputSchema: {
      type: 'object', required: ['name', 'type', 'level', 'stats', 'hp', 'ac', 'speed', 'attackBonus', 'proficiencyBonus'],
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['player', 'npc', 'monster'] },
        class: { type: 'string' },
        race: { type: 'string' },
        level: { type: 'number' },
        stats: {
          type: 'object',
          properties: {
            STR: { type: 'number' }, DEX: { type: 'number' }, CON: { type: 'number' },
            INT: { type: 'number' }, WIS: { type: 'number' }, CHA: { type: 'number' },
          },
          required: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
        },
        hp: { type: 'object', properties: { current: { type: 'number' }, max: { type: 'number' }, temporary: { type: 'number' } }, required: ['current', 'max', 'temporary'] },
        ac: { type: 'number' },
        speed: { type: 'number' },
        attackBonus: { type: 'number' },
        proficiencyBonus: { type: 'number' },
        gold: { type: 'number' },
        description: { type: 'string' },
        alignment: { type: 'string' },
        challengeRating: { type: 'number' },
        xpReward: { type: 'number' },
        xp: { type: 'number' },
        xpToNextLevel: { type: 'number' },
      },
    },
  },
  {
    name: 'update_entity',
    description: 'Met à jour les propriétés d\'une entité existante (stats, PV, CA, conditions, etc.).',
    inputSchema: {
      type: 'object', required: ['entityId', 'updates'],
      properties: {
        entityId: { type: 'string' },
        updates: { type: 'object', description: 'Champs à modifier (ex: {"hp": {"current": 10, "max": 20, "temporary": 0}})' },
      },
    },
  },
  {
    name: 'remove_entity',
    description: 'Supprime une entité du jeu.',
    inputSchema: {
      type: 'object', required: ['entityId'],
      properties: { entityId: { type: 'string' } },
    },
  },

  // ── Map ────────────────────────────────────────────────────────────────────
  // Note: map creation (dimensions, imageKey, cellSize) is declared in the adventure
  // module JSON by the designer — not by Claude at runtime. Claude only navigates
  // between pre-declared maps using set_current_map.
  {
    name: 'set_current_map',
    description: 'Passe sur une autre carte de l\'aventure (ex: transition donjon → village). Les cartes sont déclarées dans le module d\'aventure, pas créées à la volée.',
    inputSchema: {
      type: 'object', required: ['mapId'],
      properties: { mapId: { type: 'string' } },
    },
  },
  {
    name: 'move_entity',
    description: 'Déplace une entité vers une position (x, y) sur la carte. Met à jour la fog of war autour du nouveau point.',
    inputSchema: {
      type: 'object', required: ['entityId', 'x', 'y'],
      properties: {
        entityId: { type: 'string' },
        x: { type: 'number', description: 'Colonne (0 = gauche)' },
        y: { type: 'number', description: 'Ligne (0 = haut)' },
        mapId: { type: 'string', description: 'ID de la carte (défaut: carte courante)' },
      },
    },
  },
  {
    name: 'reveal_area',
    description: 'Révèle un cercle de cases sur la carte (fog of war). Utile quand un personnage éclaire une zone.',
    inputSchema: {
      type: 'object', required: ['x', 'y', 'radius'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        radius: { type: 'number', description: 'Rayon en cases' },
        mapId: { type: 'string' },
      },
    },
  },
  {
    name: 'update_cell',
    description: 'Modifie l\'état d\'une case (révéler, bloquer, ajouter une description). Le rendu visuel reste dans le client React.',
    inputSchema: {
      type: 'object', required: ['x', 'y', 'updates'],
      properties: {
        x: { type: 'number' }, y: { type: 'number' },
        updates: {
          type: 'object',
          description: 'Champs à modifier. Ex: {"blocked": true, "description": "Un mur s\'est effondré."}',
          properties: {
            revealed: { type: 'boolean' },
            visible: { type: 'boolean' },
            blocked: { type: 'boolean', description: 'Marque la case comme impassable' },
            description: { type: 'string' },
          },
        },
        mapId: { type: 'string' },
      },
    },
  },

  // ── Combat ─────────────────────────────────────────────────────────────────
  {
    name: 'start_combat',
    description: 'Lance un combat entre des participants. Lance les initiatives et établit l\'ordre de jeu.',
    inputSchema: {
      type: 'object', required: ['participantIds'],
      properties: {
        participantIds: { type: 'array', items: { type: 'string' }, description: 'IDs des entités qui participent au combat' },
      },
    },
  },
  {
    name: 'resolve_attack',
    description: 'Résout une attaque: jet d\'attaque (d20 + bonus) contre la CA de la cible. Si touché, lance les dégâts.',
    inputSchema: {
      type: 'object', required: ['attackerId', 'targetId'],
      properties: {
        attackerId: { type: 'string' },
        targetId: { type: 'string' },
        weaponId: { type: 'string', description: 'ID de l\'arme utilisée (défaut: arme équipée)' },
        advantage: { type: 'boolean' },
        disadvantage: { type: 'boolean' },
      },
    },
  },
  {
    name: 'apply_damage',
    description: 'Applique des dégâts directs à une entité (contourne le jet d\'attaque). Gère les PV temporaires.',
    inputSchema: {
      type: 'object', required: ['entityId', 'amount'],
      properties: {
        entityId: { type: 'string' },
        amount: { type: 'number' },
        damageType: { type: 'string', description: 'Type: slashing, piercing, fire, cold, necrotic, etc.' },
      },
    },
  },
  {
    name: 'heal_entity',
    description: 'Soigne une entité. Peut être des PV normaux ou temporaires.',
    inputSchema: {
      type: 'object', required: ['entityId', 'amount'],
      properties: {
        entityId: { type: 'string' },
        amount: { type: 'number' },
        temporary: { type: 'boolean', description: 'PV temporaires (ne s\'accumulent pas)' },
      },
    },
  },
  {
    name: 'apply_condition',
    description: 'Applique une condition à une entité (poisoned, stunned, prone, etc.).',
    inputSchema: {
      type: 'object', required: ['entityId', 'condition'],
      properties: {
        entityId: { type: 'string' },
        condition: {
          type: 'string',
          enum: ['blinded','charmed','deafened','frightened','grappled','incapacitated','invisible',
                 'paralyzed','poisoned','prone','restrained','stunned','unconscious','dead',
                 'exhaustion_1','exhaustion_2','exhaustion_3','concentrating'],
        },
      },
    },
  },
  {
    name: 'remove_condition',
    description: 'Retire une condition d\'une entité.',
    inputSchema: {
      type: 'object', required: ['entityId', 'condition'],
      properties: {
        entityId: { type: 'string' },
        condition: { type: 'string' },
      },
    },
  },
  {
    name: 'advance_turn',
    description: 'Passe au tour suivant dans l\'ordre d\'initiative. Réinitialise les actions/mouvement du combattant suivant.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'end_combat',
    description: 'Termine le combat en cours.',
    inputSchema: {
      type: 'object', required: ['outcome'],
      properties: {
        outcome: { type: 'string', description: 'Description de la fin (ex: "Les aventuriers ont vaincu les squelettes")' },
      },
    },
  },

  // ── Inventory ──────────────────────────────────────────────────────────────
  {
    name: 'give_item',
    description: 'Ajoute un objet dans l\'inventaire d\'une entité.',
    inputSchema: {
      type: 'object', required: ['entityId', 'item'],
      properties: {
        entityId: { type: 'string' },
        item: {
          type: 'object',
          required: ['name', 'type', 'description', 'weight', 'value', 'quantity'],
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['weapon', 'armor', 'shield', 'consumable', 'tool', 'treasure', 'misc'] },
            description: { type: 'string' },
            weight: { type: 'number' },
            value: { type: 'number' },
            quantity: { type: 'number' },
            properties: {
              type: 'object',
              properties: {
                damage: { type: 'string' },
                damageType: { type: 'string' },
                ac: { type: 'number' },
                acBase: { type: 'number' },
                healing: { type: 'string' },
                twoHanded: { type: 'boolean' },
                finesse: { type: 'boolean' },
                effect: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'remove_item',
    description: 'Retire un objet de l\'inventaire d\'une entité.',
    inputSchema: {
      type: 'object', required: ['entityId', 'itemId'],
      properties: {
        entityId: { type: 'string' },
        itemId: { type: 'string' },
      },
    },
  },
  {
    name: 'equip_item',
    description: 'Équipe une arme, armure ou bouclier pour une entité. Met à jour la CA si c\'est une armure.',
    inputSchema: {
      type: 'object', required: ['entityId', 'itemId'],
      properties: {
        entityId: { type: 'string' },
        itemId: { type: 'string' },
      },
    },
  },
  {
    name: 'transfer_item',
    description: 'Transfère un objet d\'une entité à une autre.',
    inputSchema: {
      type: 'object', required: ['fromEntityId', 'toEntityId', 'itemId'],
      properties: {
        fromEntityId: { type: 'string' },
        toEntityId: { type: 'string' },
        itemId: { type: 'string' },
      },
    },
  },

  // ── Quests ─────────────────────────────────────────────────────────────────
  {
    name: 'start_quest',
    description: 'Active une quête existante ou en crée une nouvelle.',
    inputSchema: {
      type: 'object', required: ['questId'],
      properties: {
        questId: { type: 'string', description: 'ID de la quête à activer (doit exister dans l\'état)' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'complete_objective',
    description: 'Marque un objectif de quête comme accompli.',
    inputSchema: {
      type: 'object', required: ['questId', 'objectiveId'],
      properties: {
        questId: { type: 'string' },
        objectiveId: { type: 'string' },
        count: { type: 'number', description: 'Compte actuel (pour objectifs à compter)' },
      },
    },
  },
  {
    name: 'set_quest_status',
    description: 'Change le statut d\'une quête (active, completed, failed).',
    inputSchema: {
      type: 'object', required: ['questId', 'status'],
      properties: {
        questId: { type: 'string' },
        status: { type: 'string', enum: ['inactive', 'active', 'completed', 'failed'] },
        note: { type: 'string' },
      },
    },
  },

  // ── XP & Progression ──────────────────────────────────────────────────────
  {
    name: 'award_xp',
    description: 'Accorde de l\'expérience aux joueurs. Déclenche une montée de niveau si le seuil est atteint.',
    inputSchema: {
      type: 'object', required: ['amount'],
      properties: {
        amount: { type: 'number' },
        playerIds: { type: 'array', items: { type: 'string' }, description: 'IDs des joueurs (défaut: tous les joueurs)' },
      },
    },
  },

  // ── Session ────────────────────────────────────────────────────────────────
  {
    name: 'save_game',
    description: 'Sauvegarde l\'état complet du jeu dans un fichier JSON.',
    inputSchema: {
      type: 'object',
      properties: { slot: { type: 'string', description: 'Nom du slot de sauvegarde (défaut: "default")' } },
    },
  },
  {
    name: 'load_game',
    description: 'Charge une sauvegarde existante.',
    inputSchema: {
      type: 'object',
      properties: { slot: { type: 'string' } },
    },
  },
  {
    name: 'list_saves',
    description: 'Liste tous les slots de sauvegarde disponibles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_time',
    description: 'Définit l\'heure du jeu, le jour et la météo.',
    inputSchema: {
      type: 'object', required: ['timeOfDay'],
      properties: {
        timeOfDay: { type: 'string', description: 'Format HH:MM, ex: "14:30"' },
        day: { type: 'number' },
        weather: { type: 'string' },
      },
    },
  },
  {
    name: 'add_gm_note',
    description: 'Ajoute une note narrative dans le journal du MJ (horodatée automatiquement).',
    inputSchema: {
      type: 'object', required: ['note'],
      properties: { note: { type: 'string' } },
    },
  },
  {
    name: 'load_adventure_module',
    description: 'Charge un module d\'aventure depuis un fichier JSON dans data/adventures/.',
    inputSchema: {
      type: 'object', required: ['moduleId'],
      properties: { moduleId: { type: 'string', description: 'Nom du fichier sans extension (ex: "la-mine-des-ombres")' } },
    },
  },
] as const;

// ─── Server factory ────────────────────────────────────────────────────────────

export function createServer(): Server {
  const server = new Server(
    { name: 'rpg-stories-mcp', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // ── List tools ───────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  // ── Call tool ────────────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      switch (name) {

        // ── Dice ──────────────────────────────────────────────────────────
        case 'roll_dice': {
          const result = rollDice(a.notation as string);
          return ok({ ...result, label: a.label });
        }

        case 'ability_check': {
          const entity = engine.getEntity(a.entityId as string);
          if (!entity) return err(`Entité "${a.entityId}" introuvable`);
          const stat = a.stat as keyof typeof entity.stats;
          let bonus = statModifier(entity.stats[stat]);
          // Add proficiency if proficient in saving throw
          if (entity.skillProficiencies?.includes(stat)) bonus += entity.proficiencyBonus;

          const rolls: number[] = [];
          rolls.push(Math.floor(Math.random() * 20) + 1);
          if (a.advantage || a.disadvantage) rolls.push(Math.floor(Math.random() * 20) + 1);
          const roll = a.advantage ? Math.max(...rolls) : a.disadvantage ? Math.min(...rolls) : rolls[0];

          const total = roll + bonus;
          const dc = a.dc as number;
          const success = roll === 20 ? true : roll === 1 ? false : total >= dc;
          return ok({
            entity: entity.name, stat, roll, bonus, total, dc, success,
            critical: roll === 20, fumble: roll === 1,
            advantage: !!a.advantage, disadvantage: !!a.disadvantage,
            rolls,
          });
        }

        case 'saving_throw': {
          const entity = engine.getEntity(a.entityId as string);
          if (!entity) return err(`Entité "${a.entityId}" introuvable`);
          const stat = a.stat as keyof typeof entity.stats;
          let bonus = statModifier(entity.stats[stat]);
          if (entity.savingThrowProficiencies?.includes(stat)) bonus += entity.proficiencyBonus;

          const rolls: number[] = [];
          rolls.push(Math.floor(Math.random() * 20) + 1);
          if (a.advantage || a.disadvantage) rolls.push(Math.floor(Math.random() * 20) + 1);
          const roll = a.advantage ? Math.max(...rolls) : a.disadvantage ? Math.min(...rolls) : rolls[0];

          const total = roll + bonus;
          const dc = a.dc as number;
          const success = roll === 20 ? true : roll === 1 ? false : total >= dc;
          return ok({ entity: entity.name, stat, roll, bonus, total, dc, success, critical: roll === 20, fumble: roll === 1 });
        }

        // ── Entities ──────────────────────────────────────────────────────
        case 'create_entity': {
          const data = {
            ...a,
            conditions: [],
            inventory: [],
            skills: {},
            savingThrowProficiencies: [],
            skillProficiencies: [],
            gold: (a.gold as number) ?? 0,
            position: null,
          } as unknown as Omit<Entity, 'id'>;
          return ok(engine.createEntity(data));
        }

        case 'update_entity':
          return ok(engine.updateEntity(a.entityId as string, a.updates as Partial<Entity>));

        case 'remove_entity':
          return ok(engine.removeEntity(a.entityId as string));

        // ── Map ───────────────────────────────────────────────────────────
        case 'set_current_map':
          return ok(engine.setCurrentMap(a.mapId as string));

        case 'move_entity':
          return ok(engine.moveEntity(a.entityId as string, a.x as number, a.y as number, a.mapId as string | undefined));

        case 'reveal_area': {
          engine.revealArea(a.x as number, a.y as number, a.radius as number, a.mapId as string | undefined);
          return ok({ success: true, message: `Zone révélée autour de (${a.x},${a.y}) rayon ${a.radius}.` });
        }

        case 'update_cell':
          return ok(engine.updateCell(a.x as number, a.y as number, a.updates as Record<string, unknown>, a.mapId as string | undefined));

        // ── Combat ────────────────────────────────────────────────────────
        case 'start_combat':
          return ok(engine.startCombat(a.participantIds as string[]));

        case 'resolve_attack':
          return ok(engine.resolveAttack(a.attackerId as string, a.targetId as string, a.weaponId as string | undefined));

        case 'apply_damage':
          return ok(engine.applyDamage(a.entityId as string, a.amount as number, a.damageType as string | undefined));

        case 'heal_entity':
          return ok(engine.healEntity(a.entityId as string, a.amount as number, a.temporary as boolean | undefined));

        case 'apply_condition':
          return ok(engine.applyCondition(a.entityId as string, a.condition as Condition));

        case 'remove_condition':
          return ok(engine.removeCondition(a.entityId as string, a.condition as Condition));

        case 'advance_turn':
          return ok(engine.advanceTurn());

        case 'end_combat':
          return ok(engine.endCombat(a.outcome as string));

        // ── Inventory ─────────────────────────────────────────────────────
        case 'give_item':
          return ok(engine.addItem(a.entityId as string, a.item as Omit<Item, 'id'>));

        case 'remove_item':
          return ok(engine.removeItem(a.entityId as string, a.itemId as string));

        case 'equip_item':
          return ok(engine.equipItem(a.entityId as string, a.itemId as string));

        case 'transfer_item':
          return ok(engine.transferItem(a.fromEntityId as string, a.toEntityId as string, a.itemId as string));

        // ── Quests ────────────────────────────────────────────────────────
        case 'start_quest': {
          const result = engine.setQuestStatus(a.questId as string, 'active', a.note as string | undefined);
          return ok(result);
        }

        case 'complete_objective':
          return ok(engine.updateQuestObjective(a.questId as string, a.objectiveId as string, true, a.count as number | undefined));

        case 'set_quest_status':
          return ok(engine.setQuestStatus(a.questId as string, a.status as Quest['status'], a.note as string | undefined));

        // ── XP ────────────────────────────────────────────────────────────
        case 'award_xp': {
          const ids = (a.playerIds as string[] | undefined) ?? engine.getState().playerIds;
          return ok(engine.awardXP(ids, a.amount as number));
        }

        // ── Session ───────────────────────────────────────────────────────
        case 'save_game':
          return ok(await engine.saveGame(a.slot as string | undefined));

        case 'load_game':
          return ok(await engine.loadGame(a.slot as string | undefined));

        case 'list_saves':
          return ok({ saves: await engine.listSaves() });

        case 'set_time':
          return ok(engine.setTime(a.timeOfDay as string, a.day as number | undefined, a.weather as string | undefined));

        case 'add_gm_note':
          return ok(engine.addGlobalNote(a.note as string));

        case 'load_adventure_module':
          return ok(await engine.loadAdventureModule(a.moduleId as string));

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Outil inconnu: ${name}`);
      }
    } catch (e) {
      if (e instanceof McpError) throw e;
      return err(String(e));
    }
  });

  // ── List resources ───────────────────────────────────────────────────────

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'game://state',
        name: 'État du jeu',
        description: 'Résumé complet de l\'état courant: session, carte, entités, combat, quêtes, météo.',
        mimeType: 'application/json',
      },
      {
        uri: 'game://map',
        name: 'Carte courante',
        description: 'État de la grille: fog of war, entités par case, cases bloquées, points d\'intérêt. Le JPEG et l\'affichage visuel sont gérés côté React/Konva.',
        mimeType: 'application/json',
      },
      {
        uri: 'game://entities',
        name: 'Toutes les entités',
        description: 'Fiches complètes de tous les joueurs, PNJ et monstres.',
        mimeType: 'application/json',
      },
      {
        uri: 'game://combat',
        name: 'État du combat',
        description: 'Tour courant, ordre d\'initiative, log de combat.',
        mimeType: 'application/json',
      },
      {
        uri: 'game://quests',
        name: 'Journal de quêtes',
        description: 'Toutes les quêtes avec leurs objectifs et statuts.',
        mimeType: 'application/json',
      },
      {
        uri: 'game://adventure',
        name: 'Module d\'aventure',
        description: 'Locations, PNJs, rencontres, lore du module chargé.',
        mimeType: 'application/json',
      },
      {
        uri: 'game://rules/player',
        name: 'Règles joueur',
        description: 'Règles visibles par les joueurs: résolution d\'actions, combat, magie, repos.',
        mimeType: 'text/markdown',
      },
      {
        uri: 'game://rules/gm',
        name: 'Règles MJ',
        description: 'Instructions narratives, tables de difficulté, gestion des monstres, style de jeu.',
        mimeType: 'text/markdown',
      },
    ],
  }));

  // ── Read resource ────────────────────────────────────────────────────────

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const state = engine.getState();

    switch (uri) {
      case 'game://state': {
        // Summary (without full cell grid to avoid token bloat)
        const summary = {
          session: state.session,
          day: state.day,
          timeOfDay: state.timeOfDay,
          weather: state.weather,
          currentMapId: state.currentMapId,
          mapName: state.maps[state.currentMapId]?.name,
          players: state.playerIds.map(id => {
            const e = state.entities[id];
            return e ? { id, name: e.name, hp: e.hp, ac: e.ac, conditions: e.conditions, position: e.position } : null;
          }).filter(Boolean),
          activeCombat: state.combat.active,
          currentTurn: engine.getCurrentCombatTurn(),
          activeQuests: Object.values(state.quests).filter(q => q.status === 'active').map(q => ({
            id: q.id, title: q.title,
            objectives: q.objectives.map(o => ({ ...o })),
          })),
          globalNotes: state.globalNotes.slice(-10),
        };
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(summary, null, 2) }] };
      }

      case 'game://map': {
        const map = engine.getMap();
        if (!map) return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ error: 'Aucune carte active. Utilise create_map pour en créer une.' }) }] };
        // Mask unrevealed cells: send minimal stub so the React client knows to draw fog
        const maskedMap = {
          ...map,
          cells: map.cells.map(row =>
            row.map(cell =>
              cell.revealed
                ? cell
                : { x: cell.x, y: cell.y, revealed: false, visible: false, blocked: false, entities: [], items: [] }
            )
          ),
        };
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(maskedMap, null, 2) }] };
      }

      case 'game://entities':
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(state.entities, null, 2) }] };

      case 'game://combat':
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(state.combat, null, 2) }] };

      case 'game://quests':
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(state.quests, null, 2) }] };

      case 'game://adventure':
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(state.adventureModule, null, 2) }] };

      case 'game://rules/player': {
        const text = await engine.loadRulesFile('player');
        return { contents: [{ uri, mimeType: 'text/markdown', text }] };
      }

      case 'game://rules/gm': {
        const text = await engine.loadRulesFile('gm');
        return { contents: [{ uri, mimeType: 'text/markdown', text }] };
      }

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Ressource inconnue: ${uri}`);
    }
  });

  // ── List prompts ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'narrator',
        description: 'Prompt système complet pour le rôle de narrateur/MJ. Inclut l\'état courant, les règles, et le module d\'aventure.',
        arguments: [
          { name: 'playerName', description: 'Nom du personnage joueur principal', required: false },
          { name: 'tone', description: 'Ton narratif: "épique", "sombre", "humoristique"', required: false },
        ],
      },
      {
        name: 'combat_narrator',
        description: 'Prompt ciblé sur la narration de combat. Décrit les actions mécaniques de façon cinématique.',
        arguments: [],
      },
    ],
  }));

  // ── Get prompt ───────────────────────────────────────────────────────────

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const state = engine.getState();
    const a = args ?? {};

    switch (name) {
      case 'narrator': {
        const playerRules = await engine.loadRulesFile('player');
        const gmRules = await engine.loadRulesFile('gm');
        const module = state.adventureModule;
        const tone = a.tone ?? module.tone ?? 'épique et immersif';

        const systemText = `# Rôle: Narrateur & Maître du Jeu

Tu es le Narrateur et Maître du Jeu d'une partie de jeu de rôle.
Ton rôle est DOUBLE:
1. **Narrer** les actions, décrire le monde, donner vie aux PNJ.
2. **Appliquer les mécaniques** en utilisant les outils MCP disponibles.

## Ton narratif
- Style: ${tone}
- Toujours décrire en 2ème personne du pluriel ("Vous entrez dans...")
- Rendre les combats cinématiques, les réussites satisfaisantes, les échecs intéressants
- Ne jamais briser l'immersion sauf si le joueur pose une question hors-jeu

## Module d'aventure actif: **${module.title}**
${module.synopsis}
**Cadre:** ${module.setting}
**Ton:** ${module.tone}

### Lore essentiel
${module.lore.map((l, i) => `${i + 1}. ${l}`).join('\n')}

### PNJ principaux
${module.npcs.map(n => `- **${n.name}** (${n.role}): ${n.personality}. Motivation: ${n.motivation}`).join('\n')}

## Règles joueur
${playerRules}

## Instructions MJ
${gmRules}

## WORKFLOW pour chaque action joueur:
1. Détermine si un jet est nécessaire (utilise \`ability_check\`, \`saving_throw\` ou \`resolve_attack\`)
2. Applique les résultats mécaniques (utilise les outils: \`apply_damage\`, \`heal_entity\`, \`move_entity\`, etc.)
3. Met à jour les quêtes si pertinent (\`complete_objective\`, \`start_quest\`)
4. Narre le résultat de façon immersive
5. Décris ce que les joueurs voient/entendent/ressentent maintenant

## Format de réponse
- 2-4 paragraphes narratifs
- Si combat: décrit mécaniquement ET cinématiquement chaque action
- Termine par une question ouverte ou une description de la situation actuelle
`;

        return {
          description: 'Prompt narrateur complet',
          messages: [{ role: 'user', content: { type: 'text', text: systemText } }],
        };
      }

      case 'combat_narrator': {
        const combat = state.combat;
        const currentTurn = engine.getCurrentCombatTurn();
        const currentEntity = currentTurn ? state.entities[currentTurn.entityId] : null;

        const text = `# Mode Combat

Un combat est en cours. Round ${combat.round}.

## Ordre d'initiative
${combat.turnOrder.map((t, i) => {
  const e = state.entities[t.entityId];
  const marker = i === combat.currentTurnIndex ? '▶' : ' ';
  return `${marker} ${e?.name ?? t.entityId} (ini ${t.initiative}) — PV ${e?.hp.current}/${e?.hp.max} | CA ${e?.ac}`;
}).join('\n')}

## Tour actuel: ${currentEntity?.name ?? '—'}
${currentTurn ? `Actions: ${currentTurn.hasAction ? '✅' : '❌'} | Bonus: ${currentTurn.hasBonusAction ? '✅' : '❌'} | Mouvement: ${currentTurn.movementRemaining}ft` : ''}

## Log de combat (récent)
${combat.log.slice(-8).join('\n')}

## Instructions combat
- Utilise \`resolve_attack\` pour chaque attaque
- Utilise \`apply_condition\` pour les effets de sorts
- Utilise \`advance_turn\` après chaque tour
- Décris chaque action avec des détails sensoriels (son, mouvement, impact)
- Les monstres agissent tactiquement selon leur intelligence
`;

        return {
          description: 'Prompt combat',
          messages: [{ role: 'user', content: { type: 'text', text } }],
        };
      }

      default:
        throw new McpError(ErrorCode.InvalidRequest, `Prompt inconnu: ${name}`);
    }
  });

  return server;
}
