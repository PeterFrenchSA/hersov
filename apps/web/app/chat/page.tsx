'use client';

import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';

type ChatThread = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string | null;
};

type ChatMessage = {
  id: string;
  role: string;
  contentText: string;
  toolName: string | null;
  createdAt: string;
};

export default function ChatPage() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadThreads();
  }, []);

  const loadThreads = async (): Promise<void> => {
    setLoadingThreads(true);

    const response = await fetch('/api/chat/threads?page=1&pageSize=30', {
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      setError('Failed to load chat threads');
      setLoadingThreads(false);
      return;
    }

    const payload = (await response.json()) as { data: ChatThread[] };
    setThreads(payload.data ?? []);
    setLoadingThreads(false);
  };

  const loadThread = async (id: string): Promise<void> => {
    setError(null);

    const response = await fetch(`/api/chat/threads/${id}`, {
      credentials: 'include',
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok) {
      setError('Failed to load chat thread');
      return;
    }

    const payload = (await response.json()) as {
      thread: { id: string };
      messages: ChatMessage[];
    };

    setThreadId(payload.thread.id);
    setMessages(payload.messages ?? []);
    setAssistantDraft('');
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const message = input.trim();

    if (!message || sending) {
      return;
    }

    setSending(true);
    setError(null);
    setAssistantDraft('');
    setToolActivity(null);
    setMessages((previous) => [
      ...previous,
      {
        id: `tmp-user-${Date.now()}`,
        role: 'user',
        contentText: message,
        toolName: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setInput('');

    const response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        threadId,
        message,
      }),
    });

    if (!response.ok || !response.body) {
      setError('Failed to send chat message');
      setSending(false);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let streamedAssistantText = '';

    let streamOpen = true;
    while (streamOpen) {
      const { done, value } = await reader.read();
      if (done) {
        streamOpen = false;
        continue;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        handleSseEvent(rawEvent, {
          onThread: (incomingThreadId) => setThreadId(incomingThreadId),
          onDelta: (delta) => {
            streamedAssistantText += delta;
            setAssistantDraft(streamedAssistantText);
          },
          onTool: (name, status) => setToolActivity(`${name}: ${status}`),
          onDone: () => {
            if (streamedAssistantText.length > 0) {
              setMessages((previous) => [
                ...previous,
                {
                  id: `tmp-assistant-${Date.now()}`,
                  role: 'assistant',
                  contentText: streamedAssistantText,
                  toolName: null,
                  createdAt: new Date().toISOString(),
                },
              ]);
              setAssistantDraft('');
              streamedAssistantText = '';
            }
            setToolActivity(null);
          },
          onError: (messageText) => {
            setError(messageText);
            setToolActivity(null);
          },
        });

        separatorIndex = buffer.indexOf('\n\n');
      }
    }

    if (streamedAssistantText.length > 0) {
      setMessages((previous) => [
        ...previous,
        {
          id: `tmp-assistant-final-${Date.now()}`,
          role: 'assistant',
          contentText: streamedAssistantText,
          toolName: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setAssistantDraft('');
    }

    setSending(false);
    void loadThreads();
  };

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <h1>Chat</h1>
      <p>Ask natural language questions about contacts. Tool calls are executed server-side.</p>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: '1rem' }}>
        <aside className="card grid" style={{ gap: '0.5rem' }}>
          <h2 style={{ margin: 0 }}>Threads</h2>
          {loadingThreads ? <p>Loading threads...</p> : null}
          {!loadingThreads && threads.length === 0 ? <p>No threads yet.</p> : null}
          {!loadingThreads
            ? threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className="button secondary"
                  style={{ textAlign: 'left' }}
                  onClick={() => {
                    void loadThread(thread.id);
                  }}
                >
                  <div>{thread.title ?? 'Untitled thread'}</div>
                  <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                    {thread.lastMessagePreview ?? 'No messages'}
                  </div>
                </button>
              ))
            : null}
        </aside>

        <div className="card grid" style={{ gap: '0.75rem' }}>
          <div className="grid" style={{ gap: '0.5rem', maxHeight: 420, overflowY: 'auto' }}>
            {messages.length === 0 ? <p>No messages yet.</p> : null}
            {messages.map((message) => (
              <article
                key={message.id}
                style={{
                  border: '1px solid #d8dee9',
                  borderRadius: 8,
                  padding: '0.6rem',
                  background: message.role === 'user' ? '#f7fafc' : '#ffffff',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>
                  {message.role}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{renderMessageContent(message.contentText)}</div>
              </article>
            ))}
            {assistantDraft ? (
              <article
                style={{
                  border: '1px solid #d8dee9',
                  borderRadius: 8,
                  padding: '0.6rem',
                  background: '#ffffff',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.25rem' }}>assistant (streaming)</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{renderMessageContent(assistantDraft)}</div>
              </article>
            ) : null}
          </div>

          {toolActivity ? <p>Tool activity: {toolActivity}</p> : null}

          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask a CRM question"
            />
            <button className="button" type="submit" disabled={sending}>
              {sending ? 'Sending...' : 'Send'}
            </button>
          </form>

          <p style={{ fontSize: '0.85rem', color: '#475569' }}>
            Tip: ask for a specific contact and then open the profile directly via{' '}
            <Link href="/contacts">Contacts</Link>.
          </p>

          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function handleSseEvent(
  rawEvent: string,
  handlers: {
    onThread: (threadId: string) => void;
    onDelta: (delta: string) => void;
    onTool: (name: string, status: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
): void {
  const lines = rawEvent.split(/\r?\n/);
  let eventName = 'message';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      data += line.slice(5).trimStart();
    }
  }

  if (!data) {
    return;
  }

  const payload = JSON.parse(data) as Record<string, unknown>;

  if (eventName === 'thread') {
    const value = payload.threadId;
    if (typeof value === 'string') {
      handlers.onThread(value);
    }
    return;
  }

  if (eventName === 'delta') {
    const value = payload.text;
    if (typeof value === 'string') {
      handlers.onDelta(value);
    }
    return;
  }

  if (eventName === 'tool') {
    const name = typeof payload.name === 'string' ? payload.name : 'tool';
    const status = typeof payload.status === 'string' ? payload.status : 'unknown';
    handlers.onTool(name, status);
    return;
  }

  if (eventName === 'done') {
    handlers.onDone();
    return;
  }

  if (eventName === 'error') {
    const message = typeof payload.message === 'string' ? payload.message : 'Chat error';
    handlers.onError(message);
  }
}

function renderMessageContent(content: string): ReactNode[] {
  const parts = content.split(/(\/contacts\/[A-Za-z0-9_-]+)/g);

  return parts.map((part, index) => {
    if (/^\/contacts\/[A-Za-z0-9_-]+$/.test(part)) {
      return (
        <Link key={`${part}-${index}`} href={part}>
          {part}
        </Link>
      );
    }

    return part;
  });
}
