import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AI_CHAT_SESSION_TABLE = 'ai_chat_session';

export const SESSION_STATUSES = ['active', 'archived', 'closed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * One conversation between a user and the agent.
 *
 * Association with the business `users` table is logical (`user_id` -> `users.id`)
 * and intentionally **not** a database foreign key, so the AI schema can never
 * block or alter business data.
 *
 * `ai_chat_message` is the line-item table of this entity.
 */
@Entity(AI_CHAT_SESSION_TABLE)
@Index('idx_ai_chat_session_user_updated', ['userId', 'updatedAt'])
@Index('idx_ai_chat_session_tenant', ['tenantId'])
@Index('idx_ai_chat_session_status', ['status'])
export class AiChatSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Logical reference to `users.id`. */
  @Column({ type: 'text' })
  userId!: string;

  /** Tenant owner; defaults to the user id when the token carries no tenant. */
  @Column({ type: 'text' })
  tenantId!: string;

  @Column({ type: 'text', default: '新对话' })
  title!: string;

  @Column({ type: 'text', default: 'deepseek' })
  provider!: string;

  @Column({ type: 'text', default: '' })
  model!: string;

  @Column({ type: 'text', default: 'active' })
  status!: SessionStatus;

  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /** Shape consumed by the frontend (`ChatSession`). */
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      tenantId: this.tenantId,
      title: this.title,
      provider: this.provider,
      model: this.model,
      status: this.status,
      messageCount: this.messageCount ?? 0,
      createdAt: this.createdAt?.toISOString?.() ?? null,
      updatedAt: this.updatedAt?.toISOString?.() ?? null,
    };
  }
}
