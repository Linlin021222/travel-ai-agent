/**
 * Aggregate the BTS flight-level archive files into the 21 column `flight_delay`
 * table used by the Flight info page.
 *
 * Usage:
 *   node --env-file=.env scripts/ingest-flight-delay.mjs
 *   node --env-file=.env scripts/ingest-flight-delay.mjs --dry-run          (parse only, no DB)
 *   node --env-file=.env scripts/ingest-flight-delay.mjs --limit-rows=2000000
 *   node --env-file=.env scripts/ingest-flight-delay.mjs --years=2017,2018
 *   node --env-file=.env scripts/ingest-flight-delay.mjs --no-truncate      (append instead of rebuild)
 */

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BKND_ROOT = resolve(__dirname, '..');
const DATA_DIR = process.env.FLIGHT_DELAY_DATA_DIR
  ? resolve(process.env.FLIGHT_DELAY_DATA_DIR)
  : resolve(BKND_ROOT, '..', 'trip_airline_delay');
const CACHE_DIR = resolve(BKND_ROOT, '..', '.cache');

const args = parseArgs(process.argv.slice(2));
const DRY_RUN = args['dry-run'] === true;
const LIMIT_ROWS = args['limit-rows'] ? Number(args['limit-rows']) : Infinity;
const ONLY_YEARS = args.years ? String(args.years).split(',').map((v) => Number(v.trim())) : null;
const TRUNCATE = args.truncate !== false;
const BATCH_SIZE = Number(args['batch-size'] ?? 1000);

// ---------------------------------------------------------------------------
// Metric layout inside the aggregation buffer
// ---------------------------------------------------------------------------
const M = {
  arr_flights: 0,
  arr_del15: 1,
  carrier_ct: 2,
  weather_ct: 3,
  nas_ct: 4,
  security_ct: 5,
  late_aircraft_ct: 6,
  arr_cancelled: 7,
  arr_diverted: 8,
  arr_delay: 9,
  carrier_delay: 10,
  weather_delay: 11,
  nas_delay: 12,
  security_delay: 13,
  late_aircraft_delay: 14,
};
const METRIC_COUNT = 15;

const DELAYED_MINUTES = 15;

// ---------------------------------------------------------------------------
// Name lookups (carrier code -> full name, airport code -> full name)
// ---------------------------------------------------------------------------
const CARRIER_NAMES = {
  '9E': 'Endeavor Air (Pinnacle Airlines)',
  '9K': 'Cape Air',
  '9L': 'Colgan Air',
  '9W': 'Jet Airways',
  AA: 'American Airlines Inc.',
  AS: 'Alaska Airlines Inc.',
  AX: 'Trans States Airlines',
  B6: 'JetBlue Airways',
  C5: 'CommutAir',
  CO: 'Continental Air Lines Inc.',
  DL: 'Delta Air Lines Inc.',
  EV: 'ExpressJet Airlines Inc.',
  F9: 'Frontier Airlines Inc.',
  FL: 'AirTran Airways Corporation',
  G4: 'Allegiant Air',
  G7: 'GoJet Airlines LLC',
  HA: 'Hawaiian Airlines Inc.',
  KS: 'Peninsula Airways (PenAir)',
  MQ: 'American Eagle Airlines Inc. (Envoy Air)',
  NK: 'Spirit Air Lines',
  NW: 'Northwest Airlines Inc.',
  OH: 'Comair Inc.',
  OO: 'SkyWest Airlines Inc.',
  PT: 'Piedmont Airlines',
  QX: 'Horizon Air',
  RP: 'Chautauqua Airlines',
  S5: 'Shuttle America',
  SY: 'Sun Country Airlines',
  TZ: 'ATA Airlines',
  UA: 'United Air Lines Inc.',
  US: 'US Airways Inc.',
  VX: 'Virgin America',
  WN: 'Southwest Airlines Co.',
  XE: 'ExpressJet Airlines Inc. (XE)',
  YV: 'Mesa Airlines Inc.',
  YX: 'Republic Airline',
  ZW: 'Air Wisconsin Airlines Corp',
  '3M': 'Silver Airways',
  '7H': 'Ravn Alaska (Era Aviation)',
};

/** Codes missing from the OpenFlights reference data. */
const AIRPORT_NAMES_OVERRIDE = {
  EAR: 'Kearney Regional Airport, Kearney',
  IFP: 'Laughlin/Bullhead International Airport, Bullhead City',
};

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function loadAirportNames() {
  const map = new Map();
  const file = join(CACHE_DIR, 'airports.dat');
  if (!existsSync(file)) return map;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    const iata = (cols[4] ?? '').trim();
    const name = (cols[1] ?? '').trim();
    const city = (cols[2] ?? '').trim();
    if (!iata || iata === '\\N' || !name) continue;
    const label = city && !name.includes(city) ? `${name}, ${city}` : name;
    if (!map.has(iata)) map.set(iata, label);
  }
  return map;
}

function loadAirlineNames() {
  const map = new Map();
  const file = join(CACHE_DIR, 'airlines.dat');
  if (!existsSync(file)) return map;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    const iata = (cols[3] ?? '').trim();
    const name = (cols[1] ?? '').trim();
    if (!iata || iata === '\\N' || !name) continue;
    if (!map.has(iata)) map.set(iata, name);
  }
  return map;
}

const AIRPORT_NAMES = loadAirportNames();
const AIRLINE_NAMES = loadAirlineNames();

function carrierName(code) {
  return CARRIER_NAMES[code] ?? AIRLINE_NAMES.get(code) ?? code;
}
function airportName(code) {
  return AIRPORT_NAMES_OVERRIDE[code] ?? AIRPORT_NAMES.get(code) ?? code;
}

// ---------------------------------------------------------------------------
// Fast ASCII numeric parsing without allocations
// ---------------------------------------------------------------------------
function readNumber(buf, from, to) {
  if (from >= to) return 0;
  let pos = from;
  let negative = false;
  if (buf[pos] === 45) {
    negative = true;
    pos += 1;
  }
  let int = 0;
  while (pos < to) {
    const c = buf[pos];
    if (c === 46) break;
    int = int * 10 + (c - 48);
    pos += 1;
  }
  let frac = 0;
  let scale = 1;
  if (pos < to && buf[pos] === 46) {
    pos += 1;
    while (pos < to) {
      frac = frac * 10 + (buf[pos] - 48);
      scale *= 10;
      pos += 1;
    }
  }
  const value = int + frac / scale;
  return negative ? -value : value;
}

// Encode a 1-3 character uppercase code as a number so we can use numeric Map keys.
function codeToNumber(buf, from, to) {
  let v = 0;
  for (let i = from; i < to; i += 1) v = v * 64 + buf[i];
  return v;
}

// ---------------------------------------------------------------------------
// Streaming aggregation
// ---------------------------------------------------------------------------
const carriers = new Map(); // numeric code -> { id, code }
const airports = new Map(); // numeric code -> { id, code }
const groups = new Map(); // composite numeric key -> Float64Array

function carrierId(buf, from, to) {
  const key = codeToNumber(buf, from, to);
  let entry = carriers.get(key);
  if (!entry) {
    entry = { id: carriers.size, code: buf.toString('latin1', from, to) };
    carriers.set(key, entry);
  }
  return entry.id;
}

function airportId(buf, from, to) {
  const key = codeToNumber(buf, from, to);
  let entry = airports.get(key);
  if (!entry) {
    entry = { id: airports.size, code: buf.toString('latin1', from, to) };
    airports.set(key, entry);
  }
  return entry.id;
}

const fieldStart = new Int32Array(32);
const fieldEnd = new Int32Array(32);

function processLine(buf, start, end) {
  // trim CR
  if (end > start && buf[end - 1] === 13) end -= 1;
  if (end <= start) return;
  // header
  if (buf[start] === 70 && buf[start + 1] === 76 && buf[start + 2] === 95) return;

  // Walk the line once, recording field boundaries we care about.
  let index = 0;
  let fs = start;
  for (let i = start; i <= end; i += 1) {
    const isSep = i === end || buf[i] === 44;
    if (!isSep) continue;
    if (index < 32) {
      fieldStart[index] = fs;
      fieldEnd[index] = i;
    }
    index += 1;
    fs = i + 1;
    if (index > 27) break;
  }

  // 0 = FL_DATE (YYYY-MM-DD)
  const dateStart = fieldStart[0];
  if (fieldEnd[0] - dateStart < 10) return;
  let year = 0;
  for (let i = dateStart; i < dateStart + 4; i += 1) year = year * 10 + (buf[i] - 48);
  const month = (buf[dateStart + 5] - 48) * 10 + (buf[dateStart + 6] - 48);

  const cId = carrierId(buf, fieldStart[1], fieldEnd[1]);
  const aId = airportId(buf, fieldStart[4], fieldEnd[4]);

  // 14 = ARR_DELAY, 15 = CANCELLED, 17 = DIVERTED, 22..26 = cause delays
  const arrDelay = readNumber(buf, fieldStart[14], fieldEnd[14]);
  const cancelled = readNumber(buf, fieldStart[15], fieldEnd[15]);
  const diverted = readNumber(buf, fieldStart[17], fieldEnd[17]);

  const key = (year * 12 + (month - 1)) * 1e8 + cId * 1e5 + aId;
  let bucket = groups.get(key);
  if (!bucket) {
    bucket = new Float64Array(METRIC_COUNT);
    groups.set(key, bucket);
  }

  bucket[M.arr_flights] += 1;
  if (cancelled >= 1) bucket[M.arr_cancelled] += 1;
  if (diverted >= 1) bucket[M.arr_diverted] += 1;

  if (arrDelay >= DELAYED_MINUTES) {
    const carrierDelay = readNumber(buf, fieldStart[22], fieldEnd[22]);
    const weatherDelay = readNumber(buf, fieldStart[23], fieldEnd[23]);
    const nasDelay = readNumber(buf, fieldStart[24], fieldEnd[24]);
    const securityDelay = readNumber(buf, fieldStart[25], fieldEnd[25]);
    const lateAircraftDelay = readNumber(buf, fieldStart[26], fieldEnd[26]);

    bucket[M.arr_del15] += 1;
    bucket[M.arr_delay] += arrDelay;

    // Attribute the whole arrival delay to the dominant cause (BTS convention:
    // carrier_delay + weather_delay + nas_delay + security_delay +
    // late_aircraft_delay === arr_delay).
    let dominant = -1;
    let dominantValue = 0;
    if (carrierDelay > dominantValue) {
      dominant = M.carrier_delay;
      dominantValue = carrierDelay;
    }
    if (weatherDelay > dominantValue) {
      dominant = M.weather_delay;
      dominantValue = weatherDelay;
    }
    if (nasDelay > dominantValue) {
      dominant = M.nas_delay;
      dominantValue = nasDelay;
    }
    if (securityDelay > dominantValue) {
      dominant = M.security_delay;
      dominantValue = securityDelay;
    }
    if (lateAircraftDelay > dominantValue) {
      dominant = M.late_aircraft_delay;
      dominantValue = lateAircraftDelay;
    }

    if (dominant >= 0) {
      bucket[dominant] += arrDelay;
      if (dominant === M.carrier_delay) bucket[M.carrier_ct] += 1;
      else if (dominant === M.weather_delay) bucket[M.weather_ct] += 1;
      else if (dominant === M.nas_delay) bucket[M.nas_ct] += 1;
      else if (dominant === M.security_delay) bucket[M.security_ct] += 1;
      else bucket[M.late_aircraft_ct] += 1;
    }
  }
}

async function aggregateFile(file, state) {
  const stream = createReadStream(file, { highWaterMark: 32 * 1024 * 1024 });
  let leftover = Buffer.alloc(0);
  for await (const chunk of stream) {
    let data;
    if (leftover.length > 0) {
      data = Buffer.concat([leftover, chunk]);
    } else {
      data = chunk;
    }
    const limit = data.length;
    let start = 0;
    while (start < limit) {
      const nl = data.indexOf(10, start);
      if (nl === -1) break;
      processLine(data, start, nl);
      start = nl + 1;
      state.rows += 1;
      if (state.rows >= LIMIT_ROWS) {
        stream.destroy();
        return true;
      }
    }
    leftover = Buffer.from(data.subarray(start));
    if (state.rows >= LIMIT_ROWS) return true;
  }
  if (leftover.length > 0 && leftover[0] !== 10) {
    processLine(leftover, 0, leftover.length);
  }
  return state.rows >= LIMIT_ROWS;
}

// ---------------------------------------------------------------------------
// Load into PostgreSQL
// ---------------------------------------------------------------------------
const INSERT_COLUMNS = [
  'year',
  'month',
  'carrier_code',
  'carrier_name',
  'airport_code',
  'airport_name',
  'arr_flights',
  'arr_del15',
  'carrier_ct',
  'weather_ct',
  'nas_ct',
  'security_ct',
  'late_aircraft_ct',
  'arr_cancelled',
  'arr_diverted',
  'arr_delay',
  'carrier_delay',
  'weather_delay',
  'nas_delay',
  'security_delay',
  'late_aircraft_delay',
];

async function persist(pool) {
  const client = await pool.connect();
  try {
    await client.query(readFileSync(join(__dirname, 'flight-delay-schema.sql'), 'utf8'));
    if (TRUNCATE) {
      await client.query('TRUNCATE TABLE flight_delay RESTART IDENTITY');
      console.log('[ingest] table flight_delay truncated');
    }

    const carrierById = new Map();
    for (const entry of carriers.values()) carrierById.set(entry.id, entry.code);
    const airportById = new Map();
    for (const entry of airports.values()) airportById.set(entry.id, entry.code);

    const rows = [];
    for (const [key, bucket] of groups) {
      const ym = Math.floor(key / 1e8);
      const rest = key - ym * 1e8;
      const cId = Math.floor(rest / 1e5);
      const aId = rest - cId * 1e5;
      const year = Math.floor(ym / 12);
      const month = (ym % 12) + 1;
      const carrierCode = carrierById.get(cId);
      const airportCode = airportById.get(aId);
      rows.push([
        year,
        month,
        carrierCode,
        carrierName(carrierCode),
        airportCode,
        airportName(airportCode),
        bucket[M.arr_flights],
        bucket[M.arr_del15],
        bucket[M.carrier_ct],
        bucket[M.weather_ct],
        bucket[M.nas_ct],
        bucket[M.security_ct],
        bucket[M.late_aircraft_ct],
        bucket[M.arr_cancelled],
        bucket[M.arr_diverted],
        bucket[M.arr_delay],
        bucket[M.carrier_delay],
        bucket[M.weather_delay],
        bucket[M.nas_delay],
        bucket[M.security_delay],
        bucket[M.late_aircraft_delay],
      ]);
    }

    console.log(`[ingest] writing ${rows.length.toLocaleString()} aggregated rows`);

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values = [];
      const params = [];
      let p = 0;
      for (const row of batch) {
        const placeholders = [];
        for (const value of row) {
          params.push(value);
          p += 1;
          placeholders.push(`$${p}`);
        }
        values.push(`(${placeholders.join(', ')})`);
      }
      await client.query(
        `INSERT INTO flight_delay (${INSERT_COLUMNS.join(', ')})
         VALUES ${values.join(', ')}
         ON CONFLICT (year, month, carrier_code, airport_code) DO UPDATE SET
           arr_flights = EXCLUDED.arr_flights,
           arr_del15 = EXCLUDED.arr_del15,
           carrier_ct = EXCLUDED.carrier_ct,
           weather_ct = EXCLUDED.weather_ct,
           nas_ct = EXCLUDED.nas_ct,
           security_ct = EXCLUDED.security_ct,
           late_aircraft_ct = EXCLUDED.late_aircraft_ct,
           arr_cancelled = EXCLUDED.arr_cancelled,
           arr_diverted = EXCLUDED.arr_diverted,
           arr_delay = EXCLUDED.arr_delay,
           carrier_delay = EXCLUDED.carrier_delay,
           weather_delay = EXCLUDED.weather_delay,
           nas_delay = EXCLUDED.nas_delay,
           security_delay = EXCLUDED.security_delay,
           late_aircraft_delay = EXCLUDED.late_aircraft_delay`,
        params,
      );
      const done = Math.min(offset + BATCH_SIZE, rows.length);
      if (done % (BATCH_SIZE * 20) === 0 || done === rows.length) {
        console.log(`[ingest]   ${done.toLocaleString()} / ${rows.length.toLocaleString()}`);
      }
    }

    await client.query('ANALYZE flight_delay');
    return rows.length;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  if (out['no-truncate']) out.truncate = false;
  return out;
}

async function main() {
  const files = (await readdir(DATA_DIR))
    .filter((name) => /^\d{4}\.csv$/.test(name))
    .filter((name) => (ONLY_YEARS ? ONLY_YEARS.includes(Number(name.slice(0, 4))) : true))
    .sort();

  if (files.length === 0) {
    throw new Error(`No CSV files found in ${DATA_DIR}`);
  }
  console.log(`[ingest] source dir: ${DATA_DIR}`);
  console.log(`[ingest] files: ${files.join(', ')}`);

  const state = { rows: 0 };
  const started = Date.now();
  for (const name of files) {
    const fileStart = Date.now();
    const before = state.rows;
    const stopped = await aggregateFile(join(DATA_DIR, name), state);
    const parsed = state.rows - before;
    console.log(
      `[ingest] ${name}: ${parsed.toLocaleString()} rows in ${((Date.now() - fileStart) / 1000).toFixed(1)}s`,
    );
    if (stopped) break;
  }
  console.log(
    `[ingest] parsed ${state.rows.toLocaleString()} flight records in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(
    `[ingest] aggregated into ${groups.size.toLocaleString()} rows (${carriers.size} carriers, ${airports.size} airports)`,
  );

  const totals = new Float64Array(METRIC_COUNT);
  for (const bucket of groups.values()) {
    for (let i = 0; i < METRIC_COUNT; i += 1) totals[i] += bucket[i];
  }
  console.log(
    `[ingest] totals: flights=${totals[M.arr_flights]} del15=${totals[M.arr_del15]} ` +
      `cancelled=${totals[M.arr_cancelled]} diverted=${totals[M.arr_diverted]} ` +
      `arrDelayMin=${Math.round(totals[M.arr_delay])}`,
  );

  if (DRY_RUN) {
    console.log('[ingest] dry-run: skipping database write');
    return;
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const written = await persist(pool);
    console.log(`[ingest] done, ${written.toLocaleString()} rows stored`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[ingest] failed:', error);
  process.exit(1);
});
