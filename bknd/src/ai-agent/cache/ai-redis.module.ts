import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const AI_REDIS = Symbol('AI_REDIS');

const logger = new Logger('AiRedisModule');

/**
 * AI owned Redis connection.
 *
 * Deliberately *not* `@Global()`: business modules must not reach for a raw
 * client. Every AI Redis operation goes through `AiCacheService`.
 */
@Module({
  providers: [
    {
      provide: AI_REDIS,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        const client = new Redis(url, {
          maxRetriesPerRequest: 2,
          lazyConnect: false,
          retryStrategy: (times) => Math.min(times * 500, 5000),
        });
        client.on('error', (error: Error) => {
          logger.warn(`redis error: ${error.message}`);
        });
        try {
          await client.ping();
          logger.log(`redis connected (${url})`);
        } catch (error) {
          // Never block API startup on Redis: caches simply degrade to misses.
          logger.warn(
            `redis unavailable, AI caches will degrade to no-op: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return client;
      },
    },
  ],
  exports: [AI_REDIS],
})
export class AiRedisModule {}
