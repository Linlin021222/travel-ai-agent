import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { QueryFlightDelayDto } from '../../flight-delay/dto/query-flight-delay.dto.js';
import { FlightDelayService } from '../../flight-delay/flight-delay.service.js';
import {
  buildEntityDictionary,
  getEntityDictionary,
  setEntityDictionary,
} from './entity-dictionary.js';

/**
 * Fills the carrier / airport catalogue the parameter extractor reads.
 *
 * The extractor must stay synchronous, so this service does the one async
 * database read up front and publishes the result to the module-level holder.
 * A failure is never fatal: without a catalogue the extractor simply stops
 * translating names into codes and every other filter still works.
 */
@Injectable()
export class EntityDictionaryService implements OnModuleInit {
  private readonly logger = new Logger('EntityDictionary');
  private loading: Promise<void> | null = null;

  constructor(private readonly flights: FlightDelayService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  /** Loads the catalogue once; concurrent callers share the same promise. */
  async ensureLoaded(): Promise<boolean> {
    if (getEntityDictionary()) return true;
    if (!this.loading) {
      this.loading = this.load().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    return getEntityDictionary() !== null;
  }

  /** Re-reads the catalogue, e.g. after a data re-ingest. */
  async refresh(): Promise<{ carriers: number; airports: number } | null> {
    await this.load();
    const dictionary = getEntityDictionary();
    if (!dictionary) return null;
    return { carriers: dictionary.carriers.length, airports: dictionary.airports.length };
  }

  private async load(): Promise<void> {
    try {
      const options = await this.flights.getFilterOptions({} as QueryFlightDelayDto);
      const dictionary = buildEntityDictionary(options.carriers ?? [], options.airports ?? []);
      setEntityDictionary(dictionary);
      this.logger.log(
        `entity dictionary loaded: ${dictionary.carriers.length} carriers, ${dictionary.airports.length} airports`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`entity dictionary unavailable, name filters disabled: ${message}`);
    }
  }
}
