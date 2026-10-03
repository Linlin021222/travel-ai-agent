"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalMessage,
  getSession,
  listSessions,
  listProviders,
  loadCachedSessionId,
  saveCachedSessionId,
  sendChatMessage,
  toHistory,
  type ChatAttachment,
  type ChatMessage,
  type ChatSession,
  type ProvidersResponse,
} from "./ai-agent";

/**
 * Owns the current chat session.
 *
 * Persistence strategy: the session id lives in localStorage and the messages
 * live in Postgres, so a page refresh (or reopening the launcher) restores the
 * exact same conversation.
 */
export function useChatSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Empty = use the backend default provider (LLM_PROVIDER). */
  const [provider, setProvider] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  // Restore on mount: cached session id → backend history.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Provider list is best-effort; the chat still works if it fails.
      listProviders()
        .then((info) => {
          if (!cancelled) setProviders(info);
        })
        .catch(() => {});

      try {
        const known = await listSessions();
        if (cancelled) return;
        setSessions(known);

        const cached = loadCachedSessionId();
        const target =
          (cached && known.find((item) => item.id === cached)?.id) ?? known[0]?.id ?? null;

        if (target) {
          const detail = await getSession(target);
          if (cancelled) return;
          setSessionId(target);
          saveCachedSessionId(target);
          setMessages(detail.messages ?? []);
        }
      } catch {
        // Not signed in or backend unavailable — start empty rather than crash.
      } finally {
        if (!cancelled) setLoading(false);
        scrollToBottom();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(
    async (text: string, attachments: ChatAttachment[] = []) => {
      if (!text && !attachments.length) return;
      setError(null);

      const userMessage = createLocalMessage("user", text, { attachments });
      const pendingMessage = createLocalMessage("assistant", "", { pending: true });
      setMessages((prev) => [...prev, userMessage, pendingMessage]);
      setSending(true);
      scrollToBottom();

      try {
        const history = toHistory(messages);
        const reply = await sendChatMessage({
          sessionId,
          content: text,
          history,
          attachments,
          provider: provider || undefined,
        });

        setSessionId(reply.sessionId);
        saveCachedSessionId(reply.sessionId);
        setMessages((prev) =>
          prev.map((item) =>
            item.id === pendingMessage.id
              ? { ...reply.message, id: reply.message.id || pendingMessage.id }
              : item,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "发送失败，请稍后重试";
        setError(message);
        setMessages((prev) =>
          prev.map((item) =>
            item.id === pendingMessage.id
              ? { ...item, pending: false, error: true, content: `⚠️ ${message}` }
              : item,
          ),
        );
      } finally {
        setSending(false);
        scrollToBottom();
      }
    },
    [messages, sessionId, provider, scrollToBottom],
  );

  /** Record a human-in-the-loop choice on a confirm card. */
  const confirmAction = useCallback((messageId: string, actionId: string, label: string) => {
    setMessages((prev) =>
      prev.map((item) =>
        item.id === messageId
          ? { ...item, confirmation: { actionId, label, at: new Date().toISOString() } }
          : item,
      ),
    );
  }, []);

  /** Start a brand new conversation (keeps history in DB under the old id). */
  const startNewSession = useCallback(() => {
    setSessionId(null);
    saveCachedSessionId(null);
    setMessages([]);
    setError(null);
  }, []);

  const openSession = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const detail = await getSession(id);
      setSessionId(id);
      saveCachedSessionId(id);
      setMessages(detail.messages ?? []);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [scrollToBottom]);

  return {
    sessionId,
    messages,
    sessions,
    providers,
    provider,
    setProvider,
    loading,
    sending,
    error,
    scrollRef,
    sendMessage,
    confirmAction,
    startNewSession,
    openSession,
  };
}
