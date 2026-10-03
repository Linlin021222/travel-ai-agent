import { getToken } from "./auth";
import type { AggregateResult, BubbleResult, ChartQuery } from "./flight-delay";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: options.signal,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const raw = (payload as { message?: string | string[] } | null)?.message;
    const message = Array.isArray(raw) ? raw.join("；") : raw || "请求失败，请稍后重试";
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export function buildQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** Build the flat query string consumed by /api/flight-delay/* endpoints. */
export function chartQueryParams(query: ChartQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.dimension) params.dimension = query.dimension;
  if (query.metric) params.metric = query.metric;
  if (query.years?.length) params.years = query.years.join(",");
  if (query.months?.length) params.months = query.months.join(",");
  if (query.carriers?.length) params.carriers = query.carriers.join(",");
  if (query.airports?.length) params.airports = query.airports.join(",");
  if (query.dateFrom !== undefined) params.date_from = String(query.dateFrom);
  if (query.dateTo !== undefined) params.date_to = String(query.dateTo);
  if (query.metric) {
    if (query.metricRange?.min !== undefined) params[`${query.metric}_min`] = String(query.metricRange.min);
    if (query.metricRange?.max !== undefined) params[`${query.metric}_max`] = String(query.metricRange.max);
  }
  return params;
}

export function getAggregate(query: ChartQuery): Promise<AggregateResult> {
  return apiRequest<AggregateResult>(`/flight-delay/aggregate${buildQuery(chartQueryParams(query))}`);
}

export function getBubble(query: ChartQuery): Promise<BubbleResult> {
  return apiRequest<BubbleResult>(`/flight-delay/bubble${buildQuery(chartQueryParams(query))}`);
}
