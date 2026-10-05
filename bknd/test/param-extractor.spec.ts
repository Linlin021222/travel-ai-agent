import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildEntityDictionary,
  setEntityDictionary,
} from '../src/ai-agent/tools/entity-dictionary.js';
import {
  extractFilters,
  extractRanges,
  extractTopN,
  parseCjkNumber,
} from '../src/ai-agent/tools/param-extractor.js';

/**
 * Regression tests for the parameter extractor.
 *
 * These cover the three defects found in manual testing:
 *   1. "取前五名" was not understood (Chinese numerals),
 *   2. a named airline ("Alaska Airlines" / "阿拉斯加航空") was ignored,
 *   3. "当前/之前" was mis-read as a top-N request.
 */

const CATALOGUE = buildEntityDictionary(
  [
    { code: 'AS', name: 'Alaska Airlines Inc.' },
    { code: 'WN', name: 'Southwest Airlines Co.' },
    { code: 'UA', name: 'United Air Lines Inc.' },
    { code: 'EV', name: 'ExpressJet Airlines Inc.' },
    { code: 'US', name: 'US Airways Inc.' },
  ],
  [
    { code: 'ATL', name: 'Hartsfield Jackson Atlanta International Airport' },
    { code: 'SEA', name: 'Seattle Tacoma International Airport' },
  ],
);

beforeAll(() => setEntityDictionary(CATALOGUE));
afterAll(() => setEntityDictionary(null));

describe('parseCjkNumber', () => {
  it('parses the numerals used in ranking questions', () => {
    expect(parseCjkNumber('五')).toBe(5);
    expect(parseCjkNumber('十')).toBe(10);
    expect(parseCjkNumber('十五')).toBe(15);
    expect(parseCjkNumber('二十五')).toBe(25);
    expect(parseCjkNumber('一百二十')).toBe(120);
    expect(parseCjkNumber('7')).toBe(7);
  });

  it('rejects anything it cannot parse', () => {
    expect(parseCjkNumber('')).toBeUndefined();
    expect(parseCjkNumber('好几个')).toBeUndefined();
    expect(parseCjkNumber('零')).toBeUndefined();
  });
});

describe('extractTopN', () => {
  it('understands Chinese and Arabic rankings', () => {
    expect(extractTopN('按航司统计取消航班的条形图，取前五名')).toBe(5);
    expect(extractTopN('按机场统计延误航班数，取前十名')).toBe(10);
    expect(extractTopN('给我前 5 名航司')).toBe(5);
    expect(extractTopN('Top 3 carriers by cancellations')).toBe(3);
    expect(extractTopN('取消航班最多的第一名是谁')).toBe(1);
    expect(extractTopN('前二十五名')).toBe(25);
  });

  it('does not fire on words that merely contain 前', () => {
    expect(extractTopN('当前有哪些航司')).toBeUndefined();
    expect(extractTopN('与之前相比怎么样')).toBeUndefined();
    expect(extractTopN('目前延误最严重的机场')).toBeUndefined();
  });

  it('returns nothing when no ranking is requested', () => {
    expect(extractTopN('按航司统计取消航班的条形图')).toBeUndefined();
  });
});

describe('entity resolution', () => {
  it('maps an English airline name to its IATA code', () => {
    const filters = extractFilters('Alaska Airlines航司层级气泡图');
    expect(filters.carriers).toEqual(['AS']);
  });

  it('maps Chinese airline aliases', () => {
    expect(extractFilters('阿拉斯加航空的延误情况条形图').carriers).toEqual(['AS']);
    expect(extractFilters('美联航2017年的延误').carriers).toEqual(['UA']);
    expect(extractFilters('西南航空取消航班数').carriers).toEqual(['WN']);
  });

  it('maps literal codes and airport names', () => {
    expect(extractFilters('ATL 的延误趋势条形图').airports).toEqual(['ATL']);
    expect(extractFilters('西雅图机场的取消航班数').airports).toEqual(['SEA']);
  });

  it('leaves the filter empty when no entity is mentioned', () => {
    expect(extractFilters('按航司统计取消航班的条形图').carriers).toBeUndefined();
    expect(extractFilters('按机场统计延误航班数，取前十名').airports).toBeUndefined();
  });
});

describe('extractFilters', () => {
  it('keeps the filters of a fully specified question', () => {
    const filters = extractFilters('2017年美联航按机场统计延误航班数的条形图，取前十名');
    expect(filters.carriers).toEqual(['UA']);
    expect(filters.dimension).toBe('airport');
    expect(filters.metric).toBe('arr_del15');
    expect(filters.topN).toBe(10);
    expect(filters.dateFrom).toBe(201701);
    expect(filters.dateTo).toBe(201712);
  });

  it('never invents a topN default', () => {
    expect(extractFilters('航司层级气泡图').topN).toBeUndefined();
  });
});

describe('extractRanges', () => {
  it('reads magnitude filters with a unit', () => {
    expect(extractRanges('取消航班数超过1万的航司', 'arr_cancelled')).toEqual({
      arr_cancelled: { min: 10_000 },
    });
    expect(extractRanges('总延误分钟低于5万的机场', 'arr_delay')).toEqual({
      arr_delay: { max: 50_000 },
    });
  });

  it('ignores small numbers without a unit', () => {
    expect(extractRanges('延误15分钟以上的航班', 'arr_del15')).toBeUndefined();
  });

  it('needs a metric to attach the range to', () => {
    expect(extractRanges('超过1万', undefined)).toBeUndefined();
  });
});
