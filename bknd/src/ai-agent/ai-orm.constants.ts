/**
 * Named TypeORM connection used exclusively by the AI module.
 *
 * Business code keeps using the raw `pg` pool (PG_POOL); the AI module owns
 * this DataSource so its entities can never collide with business tables.
 */
export const AI_DATA_SOURCE = 'ai';
