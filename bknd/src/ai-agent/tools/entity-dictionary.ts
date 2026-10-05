import type { AirportOption, CarrierOption } from '../../flight-delay/flight-delay.fields.js';
import { AIRPORT_ALIASES, CARRIER_ALIASES, NAME_STOPWORDS } from './entity-aliases.js';

/**
 * Carrier / airport lookup used by the *synchronous* parameter extractor.
 *
 * The extractor has to stay synchronous (the tool registry calls it while
 * matching), so the catalogue is loaded once at startup from the same
 * `getFilterOptions` the Flight info page uses, then held in this module-level
 * holder. Nothing here queries the database.
 */

export interface EntityEntry {
  code: string;
  /** Authoritative name straight from the database. */
  name: string;
  /** Name words usable for matching ("Alaska Airlines Inc." -> ["alaska"]). */
  tokens: string[];
  /** Extra spellings from {@link CARRIER_ALIASES} / {@link AIRPORT_ALIASES}. */
  aliases: string[];
}

export interface EntityDictionary {
  carriers: EntityEntry[];
  airports: EntityEntry[];
  loadedAt: number;
}

let current: EntityDictionary | null = null;

export function setEntityDictionary(dictionary: EntityDictionary | null): void {
  current = dictionary;
}

export function getEntityDictionary(): EntityDictionary | null {
  return current;
}

/**
 * Splits a supplier name into matchable words.
 *
 * "Southwest Airlines Co." -> ["southwest"]: legal forms and generic industry
 * words are dropped, and only words of 4+ characters are kept so that
 * abbreviations such as "US" or "PSA" never match by accident.
 */
export function nameTokens(name: string): string[] {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s&-]/g, ' ')
    .split(/[\s&-]+/)
    .filter((word) => word.length >= 4 && !NAME_STOPWORDS.has(word));
}

export function buildEntityDictionary(
  carriers: CarrierOption[],
  airports: AirportOption[],
): EntityDictionary {
  return {
    carriers: carriers.map((item) => ({
      code: item.code,
      name: item.name,
      tokens: nameTokens(item.name),
      aliases: CARRIER_ALIASES[item.code] ?? [],
    })),
    airports: airports.map((item) => ({
      code: item.code,
      name: item.name,
      tokens: nameTokens(item.name),
      aliases: AIRPORT_ALIASES[item.code] ?? [],
    })),
    loadedAt: Date.now(),
  };
}

/** Uppercase codes written literally in the question ("WN", "ATL"). */
function explicitCodes(query: string, codes: ReadonlySet<string>): string[] {
  const found = new Set<string>();
  for (const match of query.matchAll(/\b([A-Z0-9]{2,3})\b/g)) {
    const code = match[1];
    if (codes.has(code)) found.add(code);
  }
  return [...found];
}

function asciiWordPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
}

/**
 * Resolves every entity mentioned in the question to its code.
 *
 * Three passes, cheapest first: literal code, alias (Chinese or English), then
 * name word. Returns `undefined` when nothing matched so callers can tell
 * "no filter" apart from "filter matched nothing".
 */
function resolve(query: string, entries: EntityEntry[]): string[] | undefined {
  if (!query || !entries.length) return undefined;

  const haystack = query.toLowerCase();
  const codeSet = new Set(entries.map((entry) => entry.code));
  const found = new Set<string>(explicitCodes(query, codeSet));

  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (!alias) continue;
      // Chinese aliases are matched as-is, ASCII ones case-insensitively.
      if (query.includes(alias) || haystack.includes(alias.toLowerCase())) {
        found.add(entry.code);
        break;
      }
    }
  }

  if (found.size) return [...found];

  // Name words are only consulted when nothing explicit matched, so "Atlanta"
  // cannot drag in the carrier whose name happens to contain it.
  for (const entry of entries) {
    for (const token of entry.tokens) {
      if (asciiWordPattern(token).test(haystack)) {
        found.add(entry.code);
        break;
      }
    }
  }

  return found.size ? [...found] : undefined;
}

export function resolveCarriers(query: string, dictionary: EntityDictionary | null): string[] | undefined {
  if (!dictionary) return undefined;
  return resolve(query, dictionary.carriers);
}

export function resolveAirports(query: string, dictionary: EntityDictionary | null): string[] | undefined {
  if (!dictionary) return undefined;
  return resolve(query, dictionary.airports);
}

/**
 * Turns codes back into readable names for tool messages, so a filtered answer
 * says "Alaska Airlines Inc." instead of "AS".
 */
export function describeCodes(kind: 'carriers' | 'airports', codes: string[]): string {
  const dictionary = getEntityDictionary();
  const entries = kind === 'carriers' ? dictionary?.carriers : dictionary?.airports;
  return codes
    .map((code) => entries?.find((entry) => entry.code === code)?.name ?? code)
    .join('、');
}
