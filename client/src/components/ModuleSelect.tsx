import { useState, useEffect } from 'react';
import type { ModuleSummary } from '../types';
import { fetchModules, loadModule } from '../api';
import type { GameData } from '../types';

interface ModuleSelectProps {
  onModuleLoaded: (data: GameData) => void;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
  deadly: 'Mortel',
};

function levelBadge(range: { min: number; max: number }) {
  if (range.min === range.max) return `Niveau ${range.min}`;
  return `Niveaux ${range.min}–${range.max}`;
}

function ModuleCard({
  module,
  onSelect,
  loading,
}: {
  module: ModuleSummary;
  onSelect: () => void;
  loading: boolean;
}) {
  return (
    <div className={`module-card${loading ? ' module-card--loading' : ''}`}>
      <div className="module-card-header">
        <h2 className="module-card-title">{module.title}</h2>
        <span className="module-level-badge">{levelBadge(module.levelRange)}</span>
      </div>

      <p className="module-synopsis">{module.synopsis}</p>

      <div className="module-meta">
        <span className="module-meta-item">
          <span className="module-meta-icon">🗺️</span>
          {module.mapCount} carte{module.mapCount !== 1 ? 's' : ''}
        </span>
        <span className="module-meta-item">
          <span className="module-meta-icon">📍</span>
          {module.locationCount} lieu{module.locationCount !== 1 ? 'x' : ''}
        </span>
        <span className="module-meta-item">
          <span className="module-meta-icon">⚔️</span>
          {module.encounterCount} rencontre{module.encounterCount !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="module-tone">
        <span className="module-tone-label">Ambiance :</span> {module.tone}
      </div>

      <button
        className="module-start-btn"
        onClick={onSelect}
        disabled={loading}
      >
        {loading ? (
          <span className="loading-dots">
            <span /><span /><span />
          </span>
        ) : (
          'Commencer l\'aventure'
        )}
      </button>
    </div>
  );
}

export function ModuleSelect({ onModuleLoaded }: ModuleSelectProps) {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModules()
      .then(setModules)
      .catch(e => setError(`Impossible de charger les modules : ${e.message}`))
      .finally(() => setFetching(false));
  }, []);

  async function handleSelect(fileId: string) {
    setLoadingId(fileId);
    setError(null);
    try {
      const data = await loadModule(fileId);
      onModuleLoaded(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoadingId(null);
    }
  }

  return (
    <div className="module-select">
      <div className="module-select-header">
        <h1 className="module-select-title">⚔️ RPG Stories</h1>
        <p className="module-select-subtitle">Choisissez votre aventure</p>
      </div>

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          ⚠️ {error}
        </div>
      )}

      {fetching ? (
        <div className="module-select-spinner">
          <span className="loading-dots"><span /><span /><span /></span>
          <p>Chargement des modules…</p>
        </div>
      ) : modules.length === 0 ? (
        <div className="module-select-empty">
          <p>Aucun module trouvé dans <code>data/adventures/</code></p>
        </div>
      ) : (
        <div className="module-grid">
          {modules.map(m => (
            <ModuleCard
              key={m.fileId}
              module={m}
              onSelect={() => handleSelect(m.fileId)}
              loading={loadingId === m.fileId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
