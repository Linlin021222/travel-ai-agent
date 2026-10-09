import { apiRequest } from "./api";

/* ------------------------------------------------------------------ types */

/** Renderer selector — each value maps to exactly one message component. */
export const CHAT_MESSAGE_TYPES = [
  "text",
  "table",
  "chart",
  "report",
  "confirm",
  "preview",
] as const;
export type ChatMessageType = (typeof CHAT_MESSAGE_TYPES)[number];

export type ChatRole = "user" | "assistant" | "system";

export interface ChatAttachment {
  name: string;
  size?: number;
  type?: string;
}

/* ---- per-type payloads (mirrors bknd/src/ai-agent/entities) ---- */

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
}

export interface TablePayload {
  title?: string;
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null>>;
  caption?: string;
}

export interface ChartPayload {
  title?: string;
  chartType?: "bar" | "line" | "pie";
  xLabel?: string;
  yLabel?: string;
  series: Array<{ label: string; value: number }>;
}

export interface ReportSection {
  heading: string;
  body: string;
}

export interface ReportPayload {
  title?: string;
  summary?: string;
  sections: ReportSection[];
  meta?: Array<{ label: string; value: string }>;
}

export interface ConfirmPayload {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  actions?: Array<{ id: string; label: string }>;
}

/* ---------- standardised tool result (week 2) ---------- */

/** One Dashboard KPI card. `formatted` already applies the K/M/B rule. */
export interface MetricCardItem {
  key: string;
  label: string;
  value: number;
  formatted: string;
  unit: string | null;
  ratio?: { label: string; value: number; percent: number } | null;
}

export interface MetricCardData {
  chartType: "metric";
  cards: MetricCardItem[];
  range?: { from: string | null; to: string | null } | null;
}

export interface BarPoint {
  key: string;
  label: string;
  value: number;
}

export interface BarChartData {
  chartType: "bar";
  dimension: string;
  dimensionLabel: string;
  metric: string;
  metricLabel: string;
  points: BarPoint[];
}

export interface BubbleNode {
  id: string;
  name: string;
  level: number;
  value: number;
  metrics?: Record<string, number>;
  children?: BubbleNode[];
}

export interface BubbleChartData {
  chartType: "bubble";
  metric: string;
  metricLabel: string;
  nodes: BubbleNode[];
}

export type ToolChartData = MetricCardData | BarChartData | BubbleChartData;
export type ToolData = ToolChartData | TablePayload | WritePreviewData | null;

/**
 * What a write tool returns *instead of* executing.
 *
 * It deliberately carries no parameters: the arguments stay on the server,
 * bound to `confirmationToken`, so the UI confirms with the token alone and a
 * password never has to round-trip through the browser.
 */
export interface WritePreviewData {
  previewType: "write-preview";
  toolName: string;
  action: "create" | "update" | "delete" | "batchDelete";
  targetLabel: string;
  affectedCount: number;
  changes: Array<{ field: string; label: string; from: unknown; to: unknown }>;
  warnings: string[];
  requiresConfirmation: true;
  confirmationToken: string;
  expiresInSec: number;
}

/** Envelope every tool returns; `resultType` selects the renderer. */
export interface ToolResultPayload<T = ToolData> {
  code: number;
  message: string;
  resultType: ChatMessageType;
  data: T;
  toolName: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    rangeStart?: number;
    rangeEnd?: number;
  } | null;
  meta?: Record<string, unknown> | null;
  durationMs: number;
  timestamp: string;
}

export function isToolResult(payload: unknown): payload is ToolResultPayload {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "resultType" in (payload as Record<string, unknown>) &&
      "toolName" in (payload as Record<string, unknown>),
  );
}

/** A single chat message as consumed by the UI. */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  type: ChatMessageType;
  /** Markdown for `text`; a short summary for the other types. */
  content: string;
  payload?: TablePayload | ChartPayload | ReportPayload | ConfirmPayload | ToolResultPayload | null;
  createdAt?: string;
  attachments?: ChatAttachment[];
  /** Optimistic UI states (not persisted). */
  pending?: boolean;
  error?: boolean;
  /** Result of a confirm interaction, kept client-side. */
  confirmation?: { actionId: string; label: string; at: string } | null;
}

export interface ChatSession {
  id: string;
  title: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionDetail extends ChatSession {
  messages: ChatMessage[];
}

export interface ChatReply {
  sessionId: string;
  message: ChatMessage;
  model: string;
  provider: string;
  /** Tool that answered, when the question matched one. */
  tool?: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ProviderInfo {
  id: string;
  label: string;
  defaultModel: string;
  configured: boolean;
}

export interface ProvidersResponse {
  default: string;
  defaultModel: string;
  providers: ProviderInfo[];
}

/* -------------------------------------------------------------------- api */

export interface SendChatOptions {
  sessionId?: string | null;
  content: string;
  history?: Array<{ role: ChatRole; content: string }>;
  provider?: string;
  model?: string;
  attachments?: ChatAttachment[];
}

export function listProviders() {
  return apiRequest<ProvidersResponse>("/ai-agent/providers");
}

/**
 * The API returns a page envelope; the UI only needs the items.
 * Pass `pageSize` when you want more than the default 20.
 */
export async function listSessions(pageSize = 20): Promise<ChatSession[]> {
  const page = await apiRequest<{
    items: ChatSession[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>(`/ai-agent/sessions?page=1&pageSize=${pageSize}`);
  return page.items ?? [];
}

export function createSession(title?: string, provider?: string) {
  return apiRequest<ChatSession>("/ai-agent/sessions", {
    method: "POST",
    body: { title, provider },
  });
}

export function getSession(sessionId: string) {
  return apiRequest<ChatSessionDetail>(`/ai-agent/sessions/${sessionId}`);
}

export function sendChatMessage(options: SendChatOptions) {
  const body: Record<string, unknown> = { content: options.content };
  if (options.sessionId) body.sessionId = options.sessionId;
  if (options.history?.length) body.history = options.history;
  if (options.provider) body.provider = options.provider;
  if (options.model) body.model = options.model;
  if (options.attachments?.length) {
    body.attachments = options.attachments.map((a) => ({
      name: a.name,
      size: a.size ?? 0,
      type: a.type ?? "application/octet-stream",
    }));
  }
  return apiRequest<ChatReply>("/ai-agent/chat", { method: "POST", body });
}

/**
 * Executes a write tool with the confirmation token from its preview.
 *
 * No parameters are sent: the server replays the ones it stored when the
 * preview was issued, which is what makes "confirm" impossible to tamper with.
 */
export function confirmWriteTool(toolName: string, token: string) {
  return apiRequest<ToolResultPayload>(`/ai-agent/tools/${toolName}/confirm`, {
    method: "POST",
    body: { token },
  });
}

/* ----------------------------------------------------------------- helpers */

let localSeq = 0;

export function createLocalMessage(
  role: ChatRole,
  content: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  localSeq += 1;
  return {
    id: `local-${Date.now()}-${localSeq}`,
    role,
    type: "text",
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

/** Trim history to the last N turns so requests stay small. */
export function toHistory(messages: ChatMessage[], limit = 20) {
  return messages
    .filter((m) => !m.pending && !m.error && m.type === "text")
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Session id cached in localStorage so a refresh restores the conversation. */
const SESSION_KEY = "flight_agent_chat_session_id";

export function loadCachedSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function saveCachedSessionId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(SESSION_KEY, id);
  else window.localStorage.removeItem(SESSION_KEY);
}
