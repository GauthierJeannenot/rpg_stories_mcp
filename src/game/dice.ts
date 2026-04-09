import type { DiceResult } from './types.js';

// Parse and roll standard dice notation: "2d6+3", "1d20", "1d8-1", "4d6kh3"
export function rollDice(notation: string): DiceResult {
  const raw = notation.trim().toLowerCase();

  // Pattern: [N]d[SIDES][+/-MOD] — optionally "kh3" (keep highest N) or "kl3" (keep lowest)
  const pattern = /^(\d+)d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?$/;
  const match = raw.match(pattern);

  if (!match) {
    throw new Error(`Invalid dice notation: "${notation}". Use format like "2d6", "1d20+3", "4d6kh3".`);
  }

  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const keepMode = match[3] as 'kh' | 'kl' | undefined;
  const keepCount = match[4] ? parseInt(match[4], 10) : undefined;
  const modifier = match[5] ? parseInt(match[5], 10) : 0;

  if (count < 1 || count > 100) throw new Error(`Dice count must be 1–100, got ${count}`);
  if (sides < 2 || sides > 1000) throw new Error(`Dice sides must be 2–1000, got ${sides}`);

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }

  let keptRolls = [...rolls];
  if (keepMode && keepCount !== undefined) {
    const sorted = [...rolls].sort((a, b) => b - a);
    keptRolls = keepMode === 'kh' ? sorted.slice(0, keepCount) : sorted.slice(-keepCount);
  }

  const diceSum = keptRolls.reduce((a, b) => a + b, 0);
  const total = diceSum + modifier;

  const rollStr = rolls.map((r, i) => {
    const kept = keptRolls.includes(r);
    return keepMode ? (kept ? `[${r}]` : `(${r})`) : String(r);
  }).join(', ');

  const modStr = modifier !== 0 ? ` ${modifier > 0 ? '+' : ''}${modifier}` : '';
  const breakdown = `${rollStr}${modStr} = ${total}`;

  return { notation, rolls, modifier, total, breakdown };
}

// Roll a single die of given sides
export function rollD(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

// Stat modifier: (stat - 10) / 2 rounded down
export function statModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

// Format modifier for display: "+3", "-1", "+0"
export function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : String(mod);
}

// d20 check: roll + bonus vs DC
export interface CheckResult {
  roll: number;
  bonus: number;
  total: number;
  dc: number;
  success: boolean;
  critical: boolean;  // natural 20
  fumble: boolean;    // natural 1
  breakdown: string;
}

export function d20Check(bonus: number, dc: number): CheckResult {
  const roll = rollD(20);
  const total = roll + bonus;
  const critical = roll === 20;
  const fumble = roll === 1;
  const success = critical ? true : fumble ? false : total >= dc;

  return {
    roll,
    bonus,
    total,
    dc,
    success,
    critical,
    fumble,
    breakdown: `d20(${roll}) ${formatMod(bonus)} = ${total} vs DC ${dc} → ${success ? 'SUCCESS' : 'FAILURE'}${critical ? ' (CRITIQUE!)' : fumble ? ' (FUMBLE!)' : ''}`,
  };
}

// Attack roll: d20 + attack bonus vs target AC
export function attackRoll(attackBonus: number, targetAC: number): CheckResult {
  return d20Check(attackBonus, targetAC);
}

// Roll damage from notation, return total
export function rollDamage(notation: string): { total: number; breakdown: string } {
  const result = rollDice(notation);
  return { total: result.total, breakdown: result.breakdown };
}
