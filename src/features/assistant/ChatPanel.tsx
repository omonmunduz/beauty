import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Spinner } from '@astryxdesign/core/Spinner';
import { PaperPlaneRight } from '@phosphor-icons/react';
import { askAssistant } from '@/lib/api';
import { errorText } from '@/lib/errors';
import type { AssistantAction } from '@/lib/types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  actions?: AssistantAction[];
  offline?: boolean;
  error?: boolean;
}

export function ChatPanel({ slug, scope, intro, suggestions }: { slug: string; scope: 'client' | 'owner'; intro: string; suggestions: string[] }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = useMutation({
    mutationFn: (history: Msg[]) =>
      askAssistant({ slug, scope, messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
    onSuccess: (r) => setMessages((m) => [...m, { role: 'assistant', content: r.text, actions: r.actions, offline: r.mode === 'offline' }]),
    onError: (e) => setMessages((m) => [...m, { role: 'assistant', content: errorText(e), error: true }]),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'end' });
  }, [messages, ask.isPending]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    const next = [...messages, { role: 'user' as const, content: t }];
    setMessages(next);
    setDraft('');
    ask.mutate(next);
  };

  return (
    <VStack gap={4}>
      <div className="chat" aria-live="polite" aria-busy={ask.isPending}>
        <div className="bubble bubble--bot">{intro}</div>
        {messages.length === 0 && (
          <div className="chat-actions" role="group" aria-label="Примеры вопросов">
            {suggestions.map((s) => (
              <Button key={s} label={s} size="sm" onClick={() => send(s)} />
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <VStack key={i} gap={1} hAlign={m.role === 'user' ? 'end' : 'start'}>
            <div className={`bubble ${m.role === 'user' ? 'bubble--user' : 'bubble--bot'}`}>{m.content}</div>
            {m.actions && m.actions.length > 0 && (
              <div className="chat-actions">
                {m.actions.map((a) =>
                  a.href.startsWith('/') ? (
                    <Link key={a.href + a.label} to={a.href} className="chip tap" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'var(--studio-accent)' }}>
                      {a.label}
                    </Link>
                  ) : (
                    <a key={a.href + a.label} href={a.href} className="chip tap" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                      {a.label}
                    </a>
                  ),
                )}
              </div>
            )}
            {m.offline && <Text type="supporting">Ответ собран из данных студии (упрощённый режим)</Text>}
          </VStack>
        ))}
        {ask.isPending && (
          <div className="bubble bubble--bot">
            <Spinner size="sm" label="Смотрю данные студии…" />
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="chat-composer glass"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={`chat-${scope}`} className="sr-only">
          Сообщение помощнику
        </label>
        <input
          ref={inputRef}
          id={`chat-${scope}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Напишите вопрос…"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={1000}
        />
        <IconButton label="Отправить" icon={<PaperPlaneRight size={18} weight="fill" />} variant="primary" isLoading={ask.isPending} isDisabled={!draft.trim()} onClick={() => send(draft)} />
      </form>
    </VStack>
  );
}
