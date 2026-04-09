import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ToolCallRecord } from '../types';

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (text: string) => void;
}

function ToolBadge({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  let result: unknown;
  try { result = JSON.parse(call.result); } catch { result = call.result; }
  const ok = (result as { success?: boolean })?.success !== false;

  return (
    <div className={`tool-badge ${ok ? 'ok' : 'fail'}`} onClick={() => setOpen(o => !o)}>
      <span className="tool-icon">{ok ? '🎲' : '⚠️'}</span>
      <span className="tool-name">{call.name}</span>
      {open && (
        <pre className="tool-detail">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-role">{isUser ? 'Joueur' : 'Narrateur'}</div>
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="tool-calls">
          {msg.toolCalls.map((tc, i) => <ToolBadge key={i} call={tc} />)}
        </div>
      )}
      <div className="message-content">{msg.content}</div>
      <div className="message-time">
        {new Date(msg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}

export function Chat({ messages, isLoading, onSend }: Props) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    onSend(text);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span>💬 Conversation</span>
        {isLoading && <span className="typing-indicator">Le Narrateur réfléchit…</span>}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>⚔️ <strong>RPG Stories</strong></p>
            <p>Parle au Narrateur pour commencer l'aventure.</p>
            <p style={{ opacity: 0.5, fontSize: 12 }}>
              Essaie : <em>"Crée mon personnage, un guerrier humain nommé Aldric"</em>
            </p>
          </div>
        )}

        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-role">Narrateur</div>
            <div className="message-content loading-dots">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Décris ton action… (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"
          rows={3}
          disabled={isLoading}
          className="chat-input"
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          className="chat-send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
