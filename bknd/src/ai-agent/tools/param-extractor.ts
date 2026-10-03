import type { ChartDimension, ChartMetric } from '../../flight-delay/flight-delay.fields.js';

/**
 * Lightweight Chinese parameter extraction.
 *
 * Deliberately conservative: it only claims a value when the question is
 * explicit. Anything it cannot determine is left `undefined` so the tool falls
 * back to the service default instead of guessing wrong.
 */

export interface ExtractedFilters {
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  /** `yyyymm` bounds, matching the `date_from` / `date_to` contract. */
  dateFrom?: number;
  dateTo?: number;
  keyword?: string;
  dimension?: ChartDimension;
  metric?: ChartMetric;
  topN?: number;
}

export function extractYears(query: string): number[] {
  const found = new Set<number>();
  for (const match of query.matchAll(/(19|20)\d{2}/g)) {
    const year = Number(match[0]);
    if (year >= 1980 && year <= 2100) found.add(year);
  }
  return [...found].sort((a, b) => a - b);
}

export function extractMonths(query: string): number[] {
  const found = new Set<number>();
  for (const match of query.matchAll(/(\d{1,2})\s*月/g)) {
    const month = Number(match[1]);
    if (month >= 1 && month <= 12) found.add(month);
  }
  return [...found].sort((a, b) => a - b);
}

export function extractDimension(query: string): ChartDimension | undefined {
  if (/(航司|航空公司|承运人)/.test(query) && !/(机场)/.test(query)) return 'carrier';
  if (/(机场|航站楼|目的地)/.test(query)) return 'airport';
  if (/(按月|每月|月份|日期|时间|趋势|年度|历年)/.test(query)) return 'date';
  return undefined;
}

export function extractMetric(query: string): ChartMetric | undefined {
  if (/备降/.test(query)) return 'arr_diverted';
  if (/取消/.test(query)) return 'arr_cancelled';
  if (/(延误分钟|延误时长|总延误|延误时间)/.test(query)) return 'arr_delay';
  if (/(延误15|延误超过15|延误)/.test(query)) return 'arr_del15';
  if (/(抵达|到达|到达航班|航班总数|航班量)/.test(query)) return 'arr_flights';
  return undefined;
}

/** Pulls 「…」/“…”/‘…’ content, or the word after 搜索/查询/包含. */
export function extractKeyword(query: string): string | undefined {
  const quoted = /[「“"'『]([^」”"'』]{1,30})[」”"'』]/.exec(query);
  if (quoted) return quoted[1].trim();

  const afterVerb = /(?:搜索|查询|包含|关键词[:：]?)\s*([^\s，,。？?]{1,20})/.exec(query);
  if (afterVerb) return afterVerb[1].trim();

  return undefined;
}

export function extractTopN(query: string): number | undefined {
  const match = /(?:前|top|TOP)\s*(\d{1,3})/i.exec(query);
  if (!match) return undefined;
  const value = Number(match[1]);
  return value > 0 ? value : undefined;
}

/** Converts `2018年3月` into the `yyyymm` bounds used by the flight service. */
export function toYearMonth(year: number, month: number): number {
  return year * 100 + month;
}

export function extractFilters(query: string): ExtractedFilters {
  const years = extractYears(query);
  const months = extractMonths(query);

  const result: ExtractedFilters = {};
  if (years.length) result.years = years;
  if (months.length) result.months = months;

  const keyword = extractKeyword(query);
  if (keyword) result.keyword = keyword;

  const dimension = extractDimension(query);
  if (dimension) result.dimension = dimension;

  const metric = extractMetric(query);
  if (metric) result.metric = metric;

  const topN = extractTopN(query);
  if (topN) result.topN = topN;

  // `2018年` alone means the whole year; `2018年3月` narrows to that month.
  if (years.length === 1 && months.length === 1) {
    result.dateFrom = toYearMonth(years[0], months[0]);
    result.dateTo = toYearMonth(years[0], months[0]);
    delete result.years;
    delete result.months;
  } else if (years.length >= 1 && !months.length) {
    result.dateFrom = toYearMonth(years[0], 1);
    result.dateTo = toYearMonth(years[years.length - 1], 12);
  }

  return result;
}
