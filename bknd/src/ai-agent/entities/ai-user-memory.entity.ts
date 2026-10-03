import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AI_USER_MEMORY_TABLE = 'ai_user_memory';

export const MEMORY_CATEGORIES = ['preference', 'fact', 'context'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export const MEMORY_SCOPES = ['user', 'session', 'global'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

/**
 * Long term facts the agent remembers about a user (preferred airlines,
 * favourite metrics, ...). `memory_key` is unique per user + scope so an upsert
 * can safely overwrite.
 */
@Entity(AI_USER_MEMORY_TABLE)
@Index('idx_ai_user_memory_user_updated', ['userId', 'updatedAt'])
@Index('idx_ai_user_memory_tenant', ['tenantId'])
@Index('uq_ai_user_memory_key', ['userId', 'memoryKey', 'scope'], { unique: true })
export class AiUserMemoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Logical reference to `users.id`. */
  @Column({ type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  tenantId!: string;

  @Column({ type: 'text' })
  memoryKey!: string;

  @Column({ type: 'jsonb' })
  memoryValue!: unknown;

  @Column({ type: 'text', default: 'fact' })
  category!: MemoryCategory;

  @Column({ type: 'text', default: 'user' })
  scope!: MemoryScope;

  @Column({ type: 'uuid', nullable: true })
  sessionId!: string | null;

  /** 0..100 — higher survives memory trimming. */
  @Column({ type: 'int', default: 0 })
  importance!: number;

  @Column({ type: 'text', nullable: true })
  source!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      tenantId: this.tenantId,
      memoryKey: this.memoryKey,
      memoryValue: this.memoryValue,
      category: this.category,
      scope: this.scope,
      sessionId: this.sessionId,
      importance: this.importance ?? 0,
      source: this.source,
      expiresAt: this.expiresAt?.toISOString?.() ?? null,
      createdAt: this.createdAt?.toISOString?.() ?? null,
      updatedAt: this.updatedAt?.toISOString?.() ?? null,
    };
  }
}
