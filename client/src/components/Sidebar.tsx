import { useState } from 'react';
import type { GameData, Entity, Quest, CombatTurn } from '../types';

// ── Entity card ────────────────────────────────────────────────────────────────

function EntityCard({ entity }: { entity: Entity }) {
  const [open, setOpen] = useState(false);
  const hpPct  = entity.hp.current / entity.hp.max;
  const hpCol  = hpPct > 0.5 ? '#22c55e' : hpPct > 0.25 ? '#f59e0b' : '#ef4444';
  const isDead = entity.conditions.includes('dead');

  return (
    <div className={`entity-card ${isDead ? 'dead' : ''}`} onClick={() => setOpen(o => !o)}>
      <div className="entity-header">
        <span className={`entity-badge ${entity.type}`}>
          {entity.type === 'player' ? '🧙' : entity.type === 'npc' ? '👤' : '💀'}
        </span>
        <strong>{entity.name}</strong>
        {entity.class && <span className="entity-sub">{entity.class} {entity.level}</span>}
      </div>

      {/* HP bar */}
      <div className="hp-track">
        <div className="hp-fill" style={{ width: `${hpPct * 100}%`, background: hpCol }} />
      </div>
      <div className="hp-label">
        {entity.hp.current}/{entity.hp.max} PV
        {entity.hp.temporary > 0 && <span style={{ color: '#93c5fd' }}> +{entity.hp.temporary}PVt</span>}
        &nbsp;·&nbsp;CA {entity.ac}
      </div>

      {entity.conditions.length > 0 && (
        <div className="conditions">
          {entity.conditions.map(c => <span key={c} className="condition-tag">{c}</span>)}
        </div>
      )}

      {open && (
        <div className="entity-detail">
          {entity.stats && (
            <div className="stats-grid">
              {(Object.entries(entity.stats) as [string, number][]).map(([k, v]) => (
                <div key={k} className="stat-block">
                  <div className="stat-name">{k}</div>
                  <div className="stat-val">{v}</div>
                  <div className="stat-mod">{v >= 10 ? '+' : ''}{Math.floor((v - 10) / 2)}</div>
                </div>
              ))}
            </div>
          )}
          {entity.position && (
            <div className="entity-pos">📍 ({entity.position.x}, {entity.position.y})</div>
          )}
          <div className="entity-pos">💰 {entity.gold} po</div>
          {entity.inventory.length > 0 && (
            <div className="inventory">
              <strong>Inventaire</strong>
              {entity.inventory.map(item => (
                <div key={item.id} className="inv-item">
                  {item.name} ×{item.quantity}
                  {item.properties?.damage && <span className="inv-prop"> [{item.properties.damage}]</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Combat tracker ─────────────────────────────────────────────────────────────

function CombatTracker({ combat, entities }: { combat: GameData['combat']; entities: GameData['entities'] }) {
  if (!combat) return <div className="panel-empty">Aucun état de combat.</div>;
  if (!combat.active) return (
    <div className="panel-empty">
      <p>Aucun combat en cours.</p>
      <p style={{ opacity: 0.5, fontSize: 12 }}>Le Narrateur lancera <code>start_combat</code> au besoin.</p>
    </div>
  );

  return (
    <div className="combat-tracker">
      <div className="combat-round">Round {combat.round}</div>

      <div className="initiative-order">
        {combat.turnOrder.map((turn: CombatTurn, i) => {
          const entity = entities[turn.entityId];
          const isCurrent = i === combat.currentTurnIndex;
          const hpPct = entity ? entity.hp.current / entity.hp.max : 1;

          return (
            <div key={turn.entityId} className={`turn-row ${isCurrent ? 'current-turn' : ''} ${turn.isDead ? 'dead' : ''}`}>
              <span className="turn-marker">{isCurrent ? '▶' : '　'}</span>
              <span className="turn-ini">{turn.initiative}</span>
              <span className="turn-name">{entity?.name ?? turn.entityId}</span>
              <div className="turn-hp-bar">
                <div style={{ width: `${hpPct * 100}%`, height: '100%', background: hpPct > 0.5 ? '#22c55e' : '#ef4444', borderRadius: 2 }} />
              </div>
              <span className="turn-actions">
                {turn.hasAction ? '⚔️' : '·'}
                {turn.hasBonusAction ? '✦' : '·'}
              </span>
            </div>
          );
        })}
      </div>

      {combat.log.length > 0 && (
        <div className="combat-log">
          {combat.log.slice(-12).map((line, i) => (
            <div key={i} className="log-line">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quest log ──────────────────────────────────────────────────────────────────

function QuestLog({ quests }: { quests: GameData['quests'] }) {
  const all = Object.values(quests);
  const active    = all.filter(q => q.status === 'active');
  const completed = all.filter(q => q.status === 'completed');
  const failed    = all.filter(q => q.status === 'failed');

  const QuestCard = ({ quest }: { quest: Quest }) => (
    <div className={`quest-card quest-${quest.status}`}>
      <div className="quest-title">
        {quest.status === 'completed' ? '✅' : quest.status === 'failed' ? '❌' : '📜'} {quest.title}
      </div>
      <div className="quest-desc">{quest.description}</div>
      <div className="quest-objectives">
        {quest.objectives.map(obj => (
          <div key={obj.id} className={`quest-obj ${obj.completed ? 'done' : ''}`}>
            {obj.completed ? '☑' : '☐'} {obj.description}
            {obj.optional && <span className="optional"> (optionnel)</span>}
          </div>
        ))}
      </div>
      {quest.rewards && (
        <div className="quest-rewards">
          {quest.rewards.xp && <span>⭐ {quest.rewards.xp} XP</span>}
          {quest.rewards.gold && <span>💰 {quest.rewards.gold} po</span>}
        </div>
      )}
    </div>
  );

  return (
    <div className="quest-log">
      {active.length === 0 && completed.length === 0 && (
        <div className="panel-empty">Aucune quête active.</div>
      )}
      {active.map(q => <QuestCard key={q.id} quest={q} />)}
      {completed.map(q => <QuestCard key={q.id} quest={q} />)}
      {failed.map(q => <QuestCard key={q.id} quest={q} />)}
    </div>
  );
}

// ── Main sidebar ───────────────────────────────────────────────────────────────

type Tab = 'entities' | 'combat' | 'quests' | 'notes';

interface Props {
  gameData: GameData;
}

export function Sidebar({ gameData }: Props) {
  const [tab, setTab] = useState<Tab>('entities');
  const { state, entities, combat, quests } = gameData;
  const entityList = Object.values(entities);

  return (
    <div className="sidebar">
      {/* Session info strip */}
      {state && (
        <div className="session-strip">
          <span>Jour {state.day} · {state.timeOfDay}</span>
          <span>{state.weather}</span>
          {state.activeCombat && <span className="combat-badge">⚔️ Combat</span>}
        </div>
      )}

      {/* Tabs */}
      <div className="sidebar-tabs">
        {(['entities', 'combat', 'quests', 'notes'] as Tab[]).map(t => (
          <button
            key={t}
            className={`tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {{ entities: '👥 Entités', combat: '⚔️ Combat', quests: '📜 Quêtes', notes: '📝 Notes' }[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="sidebar-content">
        {tab === 'entities' && (
          <div className="entity-list">
            {entityList.length === 0
              ? <div className="panel-empty">Aucune entité. Demande au Narrateur d'en créer.</div>
              : entityList.map(e => <EntityCard key={e.id} entity={e} />)
            }
          </div>
        )}

        {tab === 'combat' && <CombatTracker combat={combat} entities={entities} />}

        {tab === 'quests' && <QuestLog quests={quests} />}

        {tab === 'notes' && (
          <div className="notes-panel">
            {(state?.globalNotes ?? []).length === 0
              ? <div className="panel-empty">Aucune note.</div>
              : (state?.globalNotes ?? []).map((n, i) => (
                  <div key={i} className="note-line">{n}</div>
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}
