import { useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Circle, Text, Line, Group } from 'react-konva';
import useImage from 'use-image';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { GameMap as GameMapType, Entity, MapCell } from '../types';

// Map imageKey → local asset URL
// Add your JPEG assets here as you create maps
const MAP_ASSETS: Record<string, string> = {
  // 'mine-des-ombres': '/assets/maps/mine-des-ombres.jpg',
};

const TOKEN_COLOR: Record<string, string> = {
  player:  '#3b82f6',
  npc:     '#22c55e',
  monster: '#ef4444',
};

const GRID_COLOR    = 'rgba(255,255,255,0.12)';
const FOG_COLOR     = '#000';
const DIM_COLOR     = 'rgba(0,0,0,0.45)';
const POI_COLOR     = '#f59e0b';
const BLOCKED_COLOR = 'rgba(255,0,0,0.18)';

interface Props {
  map: GameMapType;
  entities: Entity[];
  onCellClick?: (cell: MapCell) => void;
}

export function GameMap({ map, entities, onCellClick }: Props) {
  const imageUrl = map.imageKey ? (MAP_ASSETS[map.imageKey] ?? '') : '';
  const [bgImage, bgStatus] = useImage(imageUrl);

  const cs = map.cellSize;
  const stageW = map.width  * cs;
  const stageH = map.height * cs;

  // Zoom + pan
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const factor = e.evt.deltaY < 0 ? 1.1 : 0.91;
    setScale(s => Math.max(0.25, Math.min(4, s * factor)));
  };

  // Flatten cells once (avoid calling .flat() in every render sub-expression)
  const flatCells = map.cells.flatMap(row => row);
  const placedEntities = entities.filter(e => e.position !== null);

  return (
    <div className="map-wrapper" style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#0d0d1a' }}>
      <Stage
        width={typeof window !== 'undefined' ? window.innerWidth * 0.55 : 800}
        height={typeof window !== 'undefined' ? window.innerHeight * 0.75 : 600}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        draggable
        onWheel={handleWheel}
        onDragStart={() => { isDragging.current = true; }}
        onDragEnd={e => {
          isDragging.current = false;
          setPos({ x: e.target.x(), y: e.target.y() });
        }}
      >
        <Layer>
          {/* ── Background JPEG ── */}
          {bgStatus === 'loaded' && bgImage
            ? <KonvaImage image={bgImage} width={stageW} height={stageH} />
            : <Rect width={stageW} height={stageH} fill="#1a1a2e" />
          }

          {/* ── Grid lines ── */}
          {Array.from({ length: map.width + 1 }, (_, i) => (
            <Line key={`v${i}`}
              points={[i * cs, 0, i * cs, stageH]}
              stroke={GRID_COLOR} strokeWidth={0.5} listening={false} />
          ))}
          {Array.from({ length: map.height + 1 }, (_, i) => (
            <Line key={`h${i}`}
              points={[0, i * cs, stageW, i * cs]}
              stroke={GRID_COLOR} strokeWidth={0.5} listening={false} />
          ))}

          {/* ── Blocked cell overlay (debug / GM mode) ── */}
          {flatCells.filter(c => c.revealed && c.blocked).map(cell => (
            <Rect key={`blk-${cell.x}-${cell.y}`}
              x={cell.x * cs} y={cell.y * cs}
              width={cs} height={cs}
              fill={BLOCKED_COLOR} listening={false} />
          ))}

          {/* ── Fog of war: unrevealed = solid black ── */}
          {flatCells.filter(c => !c.revealed).map(cell => (
            <Rect key={`fog-${cell.x}-${cell.y}`}
              x={cell.x * cs} y={cell.y * cs}
              width={cs} height={cs}
              fill={FOG_COLOR} listening={false} />
          ))}

          {/* ── Dim: revealed but not currently visible ── */}
          {flatCells.filter(c => c.revealed && !c.visible).map(cell => (
            <Rect key={`dim-${cell.x}-${cell.y}`}
              x={cell.x * cs} y={cell.y * cs}
              width={cs} height={cs}
              fill={DIM_COLOR} listening={false} />
          ))}

          {/* ── Items on ground ── */}
          {flatCells.filter(c => c.revealed && c.items.length > 0).map(cell => (
            <Text key={`itm-${cell.x}-${cell.y}`}
              x={cell.x * cs} y={cell.y * cs + cs * 0.55}
              width={cs} height={cs * 0.4}
              text="💰" fontSize={cs * 0.3}
              align="center" listening={false} />
          ))}

          {/* ── Points of interest ── */}
          {map.pointsOfInterest.filter(p => {
            const cell = map.cells[p.y]?.[p.x];
            return cell?.revealed;
          }).map(poi => (
            <Group key={poi.id} x={poi.x * cs + cs / 2} y={poi.y * cs + cs / 2}>
              <Circle radius={cs * 0.18} fill={POI_COLOR} opacity={0.9} />
              <Text text="!" x={-cs * 0.1} y={-cs * 0.15}
                fontSize={cs * 0.28} fontStyle="bold" fill="#000" />
            </Group>
          ))}

          {/* ── Entity tokens ── */}
          {placedEntities.map(entity => {
            const { x, y } = entity.position!;
            const cell = map.cells[y]?.[x];
            if (!cell?.revealed) return null;

            const isDead = entity.conditions.includes('dead');
            const hpPct  = entity.hp.current / entity.hp.max;
            const hpCol  = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
            const color  = isDead ? '#555' : (TOKEN_COLOR[entity.type] ?? '#888');
            const radius = cs * 0.38;
            const pad    = cs * 0.12;

            return (
              <Group
                key={entity.id}
                x={x * cs + cs / 2}
                y={y * cs + cs / 2}
                opacity={isDead ? 0.4 : 1}
                onClick={() => {
                  const c = map.cells[y]?.[x];
                  if (c) onCellClick?.(c);
                }}
              >
                {/* Shadow */}
                <Circle radius={radius + 1} fill="rgba(0,0,0,0.5)" y={2} />
                {/* Token */}
                <Circle radius={radius} fill={color} />
                {/* Initial */}
                <Text
                  text={entity.name[0].toUpperCase()}
                  x={-radius} y={-radius * 0.65}
                  width={radius * 2} align="center"
                  fontSize={radius * 1.1} fontStyle="bold" fill="white"
                />
                {/* HP bar */}
                {!isDead && entity.type !== 'monster' && (
                  <>
                    <Rect x={-radius} y={radius + pad}    width={radius * 2} height={3} fill="#222" cornerRadius={1} />
                    <Rect x={-radius} y={radius + pad}    width={radius * 2 * hpPct} height={3} fill={hpCol} cornerRadius={1} />
                  </>
                )}
                {/* Name label */}
                <Text
                  text={entity.name}
                  x={-cs * 0.6} y={radius + pad + 5}
                  width={cs * 1.2} align="center"
                  fontSize={9} fill="rgba(255,255,255,0.8)"
                />
              </Group>
            );
          })}

          {/* ── Clickable cell overlay (transparent, for description tooltip) ── */}
          {flatCells.filter(c => c.revealed && c.description).map(cell => (
            <Rect
              key={`click-${cell.x}-${cell.y}`}
              x={cell.x * cs} y={cell.y * cs}
              width={cs} height={cs}
              fill="transparent"
              onClick={() => onCellClick?.(cell)}
            />
          ))}
        </Layer>
      </Stage>

      {/* Map info overlay */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: 'rgba(0,0,0,0.7)', color: '#aaa',
        fontSize: 11, padding: '3px 8px', borderRadius: 4, pointerEvents: 'none',
      }}>
        {map.name} · {map.width}×{map.height} · {cs}px/case · scroll pour zoomer
      </div>
    </div>
  );
}
