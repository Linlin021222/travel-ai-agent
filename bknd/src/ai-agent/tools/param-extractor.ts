import type { ChartDimension, ChartMetric } from '../../flight-delay/flight-delay.fields.js';
import { getEntityDictionary, resolveAirports, resolveCarriers } from './entity-dictionary.js';

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
  /** `{ arr_cancelled: { min: 1000 } }` — y-axis style numeric filters. */
  ranges?: Record<string, { min?: number; max?: number }>;
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
  if (/(延误分钟|延误时长|总延误|延误时间|延误多少分钟)/.test(query)) return 'arr_delay';
  if (/(延误15|延误超过15|延误)/.test(query)) return 'arr_del15';
  if (/(抵达|到达|到达航班|航班总数|航班量|航班数)/.test(query)) return 'arr_flights';
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

/** Chinese numerals as used in "前五名" / "前十" / "前二十五". */
const CJK_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/**
 * Parses `十五` / `二十` / `二十五` / `一百二十` into a number.
 * Returns `undefined` for anything outside 1–999 so the caller keeps `topN`
 * unset rather than applying a nonsense limit.
 */
export function parseCjkNumber(text: string): number | undefined {
  if (!text) return undefined;
  if (/^\d{1,3}$/.test(text)) return Number(text);

  let section = 0;
  let digit = 0;
  let seen = false;

  for (const char of text) {
    const value = CJK_DIGITS[char];
    if (value !== undefined) {
      digit = value;
      seen = true;
      continue;
    }
    if (char === '十') {
      section += (digit || 1) * 10;
      digit = 0;
      seen = true;
      continue;
    }
    if (char === '百') {
      section += (digit || 1) * 100;
      digit = 0;
      seen = true;
      continue;
    }
    return undefined;
  }

  const total = section + digit;
  if (!seen || total <= 0 || total > 999) return undefined;
  return total;
}

/**
 * Extracts "前 N 名 / 前十 / Top 5 / 第一名".
 *
 * The negative lookbehind keeps everyday words that merely *contain* 前
 * ("当前", "之前", "目前") from being read as a ranking request — that was the
 * reason "取前五名" used to fall back to the single-row default.
 */
export function extractTopN(query: string): number | undefined {
  const patterns = [
    /(?<![当之目以跟向])前\s*([0-9]{1,3}|[零一二两三四五六七八九十百]{1,4})\s*(?:名|个|位|条|大|强)?/,
    /第\s*([0-9]{1,3}|[零一二两三四五六七八九十百]{1,4})\s*(?:名|位|个)/,
    /\btop\s*([0-9]{1,3})/i,
    /\btop\s*([零一二两三四五六七八九十百]{1,4})/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(query);
    if (!match) continue;
    const value = parseCjkNumber(match[1]);
    if (value && value > 0) return Math.min(999, value);
  }
  return undefined;
}

/** `1 万` -> 10000, `3.5千` -> 3500. */
const SCALE_UNITS: Record<string, number> = { 万: 10_000, 千: 1_000, 亿: 100_000_000 };

/**
 * Numeric range filters such as 「取消航班数超过 1 万」「延误分钟低于 5 万」.
 *
 * A bare two-digit number is ignored on purpose: "延误 15 分钟以上" names the
 * `arr_del15` metric, it is not a range filter.
 */
export function extractRanges(
  query: string,
  metric: ChartMetric | undefined,
): Record<string, { min?: number; max?: number }> | undefined {
  if (!metric) return undefined;

  const patterns: Array<{ re: RegExp; kind: 'min' | 'max' }> = [
    { re: /(超过|高于|大于|多于|至少|不低于)\s*([\d.]+)\s*(万|千|亿)?/, kind: 'min' },
    { re: /(少于|低于|小于|不足|不超过|至多|最多)\s*([\d.]+)\s*(万|千|亿)?/, kind: 'max' },
  ];

  for (const { re, kind } of patterns) {
    const match = re.exec(query);
    if (!match) continue;
    const raw = Number(match[2]);
    const unit = match[3];
    if (!Number.isFinite(raw) || raw <= 0) continue;
    // Without a unit only unambiguous magnitudes (1000+) are accepted.
    if (!unit && raw < 1000) continue;
    const value = unit ? Math.round(raw * SCALE_UNITS[unit]) : Math.round(raw);
    return { [metric]: kind === 'min' ? { min: value } : { max: value } };
  }

  return undefined;
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

  const ranges = extractRanges(query, metric);
  if (ranges) result.ranges = ranges;

  // Carrier / airport names ("Alaska Airlines", "阿拉斯加航空", "ATL") are
  // translated through the catalogue loaded from the business service, so the
  // filters the user actually typed are applied instead of being dropped.
  const dictionary = getEntityDictionary();
  const carriers = resolveCarriers(query, dictionary);
  if (carriers?.length) result.carriers = carriers;

  const airports = resolveAirports(query, dictionary);
  if (airports?.length) result.airports = airports;

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
