import { useState, useCallback } from 'react';
import { GameMap } from './components/GameMap';
import { Chat } from './components/Chat';
import { Sidebar } from './components/Sidebar';
import { ModuleSelect } from './components/ModuleSelect';
import { sendMessage } from './api';
import type { GameData, ChatMessage, MapCell } from './types';
import './styles.css';

const EMPTY_GAME_DATA: GameData = {
  state: null,
  map: null,
  entities: {},
  combat: null,
  quests: {},
};

export default function App() {
  const [view, setView] = useState<'select' | 'game'>('select');
  const [gameData, setGameData] = useState<GameData>(EMPTY_GAME_DATA);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cellInfo, setCellInfo] = useState<MapCell | null>(null);

  function handleModuleLoaded(data: GameData) {
    setGameData(data);
    setMessages([]);
    setView('game');
  }

  const handleSend = useCallback(async (content: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      // Build history (user+assistant only, no system)
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await sendMessage(history);

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.text,
        toolCalls: response.toolCalls,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMsg]);

      // Update full game state from response
      setGameData({
        state:    response.state,
        map:      response.map,
        entities: response.entities ?? {},
        combat:   response.combat,
        quests:   response.quests ?? {},
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const mapOk = gameData.map && !('error' in gameData.map);

  if (view === 'select') {
    return <ModuleSelect onModuleLoaded={handleModuleLoaded} />;
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">⚔️ RPG Stories</h1>
        {gameData.state && (
          <div className="header-meta">
            <span>{gameData.state.session.name}</span>
            <span className="sep">·</span>
            <span>Jour {gameData.state.day} {gameData.state.timeOfDay}</span>
            <span className="sep">·</span>
            <span>{gameData.state.weather}</span>
            {gameData.state.activeCombat && (
              <span className="header-badge combat">⚔️ COMBAT</span>
            )}
          </div>
        )}
        <button className="change-module-btn" onClick={() => setView('select')} title="Changer de module">
          ☰ Modules
        </button>
      </header>

      {/* Main grid */}
      <div className="app-body">
        {/* Left: map */}
        <section className="map-section">
          {mapOk
            ? (
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <GameMap
                  map={gameData.map!}
                  entities={Object.values(gameData.entities)}
                  onCellClick={setCellInfo}
                />
                {/* Cell description tooltip */}
                {cellInfo?.description && (
                  <div className="cell-tooltip" onClick={() => setCellInfo(null)}>
                    📍 ({cellInfo.x},{cellInfo.y}) — {cellInfo.description}
                  </div>
                )}
              </div>
            )
            : (
              <div className="map-empty">
                <div>
                  <p>🗺️ Aucune carte active</p>
                  <p>Dis au Narrateur de créer une carte :</p>
                  <code>crée une carte "Donjon" de 20×15 avec cellSize 64</code>
                </div>
              </div>
            )
          }
        </section>

        {/* Center: chat */}
        <Chat
          messages={messages}
          isLoading={isLoading}
          onSend={handleSend}
        />

        {/* Right: sidebar */}
        <Sidebar gameData={gameData} />
      </div>

      {/* Error toast */}
      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}
