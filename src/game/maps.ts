import type { GameMap, MapCell, TerrainType } from './types.js';

function makeCell(x: number, y: number, terrain: TerrainType): MapCell {
  return {
    x, y, terrain,
    passable: terrain !== 'wall',
    revealed: false,
    visible: false,
    entities: [],
    items: [],
  };
}

function wall(x: number, y: number): MapCell {
  return makeCell(x, y, 'wall');
}

function floor(x: number, y: number): MapCell {
  return makeCell(x, y, 'floor');
}

// Carve a rectangular room into an existing cell grid
function carveRoom(cells: MapCell[][], x: number, y: number, w: number, h: number): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      cells[row][col] = floor(col, row);
    }
  }
}

// Carve a horizontal corridor
function carveHCorridor(cells: MapCell[][], x1: number, x2: number, y: number): void {
  const [start, end] = x1 < x2 ? [x1, x2] : [x2, x1];
  for (let x = start; x <= end; x++) {
    cells[y][x] = floor(x, y);
  }
}

// Carve a vertical corridor
function carveVCorridor(cells: MapCell[][], y1: number, y2: number, x: number): void {
  const [start, end] = y1 < y2 ? [y1, y2] : [y2, y1];
  for (let y = start; y <= end; y++) {
    cells[y][x] = floor(x, y);
  }
}

/**
 * Generate the default dungeon map: "La Mine des Ombres"
 * A 20×20 dungeon with 5 rooms connected by corridors, doors, and a boss chamber.
 */
export function createDefaultDungeonMap(): GameMap {
  const W = 20;
  const H = 20;

  // Fill with walls
  const cells: MapCell[][] = [];
  for (let y = 0; y < H; y++) {
    cells[y] = [];
    for (let x = 0; x < W; x++) {
      cells[y][x] = wall(x, y);
    }
  }

  // ── Rooms ──────────────────────────────────────────────────────────────────
  // Room 0: Entrance hall      (top-center)
  carveRoom(cells, 8, 1, 4, 3);
  // Room 1: Guard room         (left)
  carveRoom(cells, 2, 5, 5, 4);
  // Room 2: Storage room       (right)
  carveRoom(cells, 13, 5, 5, 4);
  // Room 3: Central hall       (center)
  carveRoom(cells, 7, 8, 6, 5);
  // Room 4: Boss chamber       (bottom-center)
  carveRoom(cells, 6, 15, 8, 4);

  // ── Corridors ──────────────────────────────────────────────────────────────
  // Entrance → left guard room
  carveVCorridor(cells, 3, 7, 10);   // down from entrance
  carveHCorridor(cells, 7, 10, 7);   // left toward guard room
  // Entrance → right storage room
  carveHCorridor(cells, 10, 13, 7);  // right toward storage room
  // Guard room → central hall
  carveHCorridor(cells, 6, 7, 9);
  // Storage room → central hall
  carveHCorridor(cells, 12, 13, 9);
  // Central hall → boss chamber
  carveVCorridor(cells, 12, 15, 10);

  // ── Doors ──────────────────────────────────────────────────────────────────
  const doorAt = (x: number, y: number, locked = false, dc?: number) => {
    cells[y][x] = {
      ...floor(x, y),
      terrain: locked ? 'locked_door' : 'door',
      doorInfo: { open: false, locked, dc },
    };
  };

  doorAt(10, 4);          // entrance → corridor south
  doorAt(7, 7);           // corridor → guard room
  doorAt(13, 7);          // corridor → storage room
  doorAt(7, 9);           // guard room → central hall (already floor, mark as door)
  doorAt(13, 9);          // storage room → central hall
  doorAt(10, 14, true, 15); // central hall → boss chamber (locked)

  // ── Entrance stairs ────────────────────────────────────────────────────────
  cells[1][10] = { ...makeCell(10, 1, 'stairs_up'), description: 'Un escalier remontant vers la surface.' };

  // ── Pillars in boss chamber ────────────────────────────────────────────────
  cells[16][7]  = makeCell(7, 16, 'pillar');
  cells[16][12] = makeCell(12, 16, 'pillar');

  // ── Cell descriptions ──────────────────────────────────────────────────────
  cells[2][10].description = 'Le hall d\'entrée de la mine. L\'air sent le soufre et la rouille.';
  cells[6][4].description  = 'Une salle de garde désertée. Des armures rouillées jonchent le sol.';
  cells[6][15].description = 'Une salle de stockage. Des caisses brisées et des barils pourris.';
  cells[10][10].description = 'Le hall central. Des torches éteintes ornent les murs.';
  cells[17][10].description = 'La chambre du boss. Une lueur rouge pulse au fond de la pièce.';

  // ── Reveal entrance area ───────────────────────────────────────────────────
  for (let y = 1; y <= 4; y++) {
    for (let x = 8; x <= 12; x++) {
      cells[y][x].revealed = true;
    }
  }

  return {
    id: 'mine-des-ombres',
    name: 'La Mine des Ombres',
    description: 'Une mine abandonnée depuis des décennies, maintenant infestée de créatures des ténèbres.',
    width: W,
    height: H,
    cellSize: 5,
    cells,
    pointsOfInterest: [
      {
        id: 'poi-entrance',
        name: 'Entrée de la mine',
        x: 10, y: 1,
        description: 'Escaliers menant à la surface.',
        type: 'entrance',
        visited: true,
      },
      {
        id: 'poi-boss',
        name: 'Chambre du Seigneur Ombre',
        x: 10, y: 17,
        description: 'Une présence maléfique émane de cette salle.',
        type: 'danger',
        visited: false,
      },
    ],
    ambientLight: 'dark',
    theme: 'dungeon',
  };
}
