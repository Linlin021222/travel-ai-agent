import type { AuthUser } from '../../common/auth/auth-user.js';

/* -------------------------------------------------------------------------- */
/* Intents & result types                                                     */
/* -------------------------------------------------------------------------- */

export const TOOL_INTENTS = [
  'QUERY_DATA',
  'STATISTICS_ANALYSIS',
  'DATA_EXPORT',
  'WRITE_DATA',
  'SYSTEM',
] as const;
export type ToolIntent = (typeof TOOL_INTENTS)[number];

/** Drives which front-end renderer is used. */
export const RESULT_TYPES = ['text', 'table', 'chart', 'report', 'preview'] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

/* -------------------------------------------------------------------------- */
/* Execution context — every tool call MUST carry the caller identity          */
/* -------------------------------------------------------------------------- */

export interface ToolContext {
  /** Authenticated caller. Never undefined: the registry rejects anonymous calls. */
  user: AuthUser;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * Write-tool gate. Only present when the call carries a valid confirmation
   * token issued by the pre-validation layer. Read tools ignore it.
   */
  execution?: {
    confirmed?: boolean;
    token?: string | null;
  };
}

/* -------------------------------------------------------------------------- */
/* Standardised result envelope                                               */
/* -------------------------------------------------------------------------- */

export interface ToolPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rangeStart?: number;
  rangeEnd?: number;
}

export interface ToolResult<T = unknown> {
  /** 0 = success. Non-zero values are safe to display to end users. */
  code: number;
  message: string;
  resultType: ResultType;
  data: T | null;
  toolName: string;
  pagination?: ToolPagination | null;
  meta?: Record<string, unknown> | null;
  durationMs: number;
  timestamp: string;
}

export const TOOL_OK = 0;
export const TOOL_ERR_VALIDATION = 400;
export const TOOL_ERR_FORBIDDEN = 403;
export const TOOL_ERR_NOT_FOUND = 404;
export const TOOL_ERR_DISABLED = 409;
/** Write tool called without a valid confirmation token. */
export const TOOL_ERR_CONFIRM_REQUIRED = 428;
export const TOOL_ERR_INTERNAL = 500;

export function toolSuccess<D>(
  toolName: string,
  resultType: ResultType,
  data: D,
  options: {
    message?: string;
    pagination?: ToolPagination | null;
    meta?: Record<string, unknown> | null;
    durationMs?: number;
  } = {},
): ToolResult<D> {
  return {
    code: TOOL_OK,
    message: options.message ?? 'ok',
    resultType,
    data,
    toolName,
    pagination: options.pagination ?? null,
    meta: options.meta ?? null,
    durationMs: options.durationMs ?? 0,
    timestamp: new Date().toISOString(),
  };
}

export function toolFailure(
  toolName: string,
  code: number,
  message: string,
  options: { resultType?: ResultType; meta?: Record<string, unknown> | null; durationMs?: number } = {},
): ToolResult<null> {
  return {
    code,
    message,
    resultType: options.resultType ?? 'text',
    data: null,
    toolName,
    pagination: null,
    meta: options.meta ?? null,
    durationMs: options.durationMs ?? 0,
    timestamp: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Payload shapes consumed by the front-end renderers                         */
/* -------------------------------------------------------------------------- */

export interface MetricRatio {
  label: string;
  /** Ratio itself, 0..1 */
  value: number;
  /** Already multiplied by 100 and rounded. */
  percent: number;
}

export interface MetricCardItem {
  key: string;
  label: string;
  value: number;
  /** Pre-formatted with the K/M/B rule so the front end never re-implements it. */
  formatted: string;
  unit: string | null;
  ratio?: MetricRatio | null;
}

export interface MetricCardPayload {
  chartType: 'metric';
  cards: MetricCardItem[];
  range?: { from: string | null; to: string | null } | null;
}

export interface BarPoint {
  key: string;
  label: string;
  value: number;
}

export interface BarChartPayload {
  chartType: 'bar';
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

export interface BubbleChartPayload {
  chartType: 'bubble';
  metric: string;
  metricLabel: string;
  nodes: BubbleNode[];
}

export interface TableColumn {
  key: string;
  label: string;
}

export interface TablePayload {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}

/* -------------------------------------------------------------------------- */
/* Write-tools: preview before execution                                       */
/* -------------------------------------------------------------------------- */

export type WriteAction = 'create' | 'update' | 'delete' | 'batchDelete';

export interface WritePreviewChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

/**
 * What a write tool hands back *instead of* executing.
 *
 * A write tool never mutates data on its own: the registry turns an
 * unconfirmed call into this payload, and only a call carrying the matching
 * confirmation token reaches `execute()`.
 */
export interface WritePreviewPayload {
  previewType: 'write-preview';
  toolName: string;
  action: WriteAction;
  /** Human description of what will be touched, e.g. 「用户 alice@example.com」. */
  targetLabel: string;
  affectedCount: number;
  changes: WritePreviewChange[];
  /** Business-rule warnings surfaced by pre-validation, e.g. 删除后不可恢复。 */
  warnings: string[];
  requiresConfirmation: true;
  /** Opaque, single-use token; execution without it is refused. */
  confirmationToken: string;
  expiresInSec: number;
}

/* -------------------------------------------------------------------------- */
/* Sensitive field masking (audit trail + non-admin visibility)               */
/* -------------------------------------------------------------------------- */

const FULLY_MASKED_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'authorization',
  'apikey',
]);

const PARTIALLY_MASKED_KEYS = new Set(['email', 'mail', 'phone', 'mobile', 'idcard']);

/**
 * Stem matching so prefixed variants are covered too: `contactEmail` and
 * `user_token` must be masked exactly like `email` and `token`.
 */
const FULLY_MASKED_STEMS = [
  'password',
  'passwd',
  'token',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'credential',
] as const;

const PARTIALLY_MASKED_STEMS = ['email', 'mail', 'phone', 'mobile', 'idcard', 'id_card'] as const;

/** `alice@example.com` -> `al***@example.com` */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***${domain}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-clones `payload` while masking credentials and partially masking
 * personal identifiers. Used for every audit record so the audit table never
 * stores raw secrets.
 */
export function maskSensitive<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => maskSensitive(item)) as unknown as T;
  }
  if (!isPlainObject(payload)) {
    return typeof payload === 'string' && payload.length > 200
      ? (`${payload.slice(0, 200)}…` as unknown as T)
      : payload;
  }

  const output: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(payload)) {
    const key = rawKey.toLowerCase();
    if (FULLY_MASKED_KEYS.has(key) || FULLY_MASKED_STEMS.some((stem) => key.includes(stem))) {
      output[rawKey] = '***';
      continue;
    }
    const partiallySensitive =
      PARTIALLY_MASKED_KEYS.has(key) || PARTIALLY_MASKED_STEMS.some((stem) => key.includes(stem));
    if (partiallySensitive && typeof value === 'string') {
      output[rawKey] = key.includes('mail') ? maskEmail(value) : `${value.slice(0, 3)}***`;
      continue;
    }
    output[rawKey] = maskSensitive(value);
  }
  return output as T;
}
