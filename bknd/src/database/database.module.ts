import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

const logger = new Logger('DatabaseModule');

/**
 * The flight delay schema lives next to the ingest script so both the script
 * and the API bootstrap agree on the exact DDL.
 */
function readFlightDelaySchema(): string | null {
  const candidates = [
    join(process.cwd(), 'scripts', 'flight-delay-schema.sql'),
    join(process.cwd(), 'src', 'flight-delay', 'flight-delay-schema.sql'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  return null;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });

        await pool.query(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        const flightDelaySchema = readFlightDelaySchema();
        if (flightDelaySchema) {
          await pool.query(flightDelaySchema);
        } else {
          logger.warn(
            'flight-delay-schema.sql not found; run `npm run ingest:flight-delay` to create the table',
          );
        }

        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
