import { DefaultNamingStrategy } from 'typeorm';
import { camelToSnake } from './string-utils.js';

/**
 * TypeORM 0.3 no longer ships `SnakeNamingStrategy`, and the AI schema must
 * follow the project's existing snake_case convention (`user_id`, `created_at`).
 * This small strategy keeps the entities camelCase while emitting snake_case
 * columns, so no extra dependency is needed.
 */
export class AiSnakeNamingStrategy extends DefaultNamingStrategy {
  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    if (customName) return customName;
    return camelToSnake(embeddedPrefixes.length ? `${embeddedPrefixes.join('_')}_${propertyName}` : propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return camelToSnake(`${relationName}_${referencedColumnName}`);
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return camelToSnake(`${propertyName}_${columnName ?? 'id'}`);
  }

  override indexName(
    tableOrName: string | { name: string },
    columns: string[],
    where?: string,
  ): string {
    const tableName = typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
    const base = `idx_${tableName}_${columns.join('_')}`;
    return where ? `${base}_${this.suffix(where)}` : base;
  }

  private suffix(where: string): string {
    return where.replace(/\W+/g, '_').toLowerCase();
  }
}
