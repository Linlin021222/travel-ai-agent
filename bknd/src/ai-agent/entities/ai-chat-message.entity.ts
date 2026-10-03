import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const AI_CHAT_MESSAGE_TABLE = 'ai_chat_message';

export const CHAT_ROLES = ['user', 'assistant', 'system'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const CHAT_MESSAGE_TYPES = ['text', 'table', 'chart', 'report', 'confirm'] as const;
export type ChatMessageType = (typeof CHAT_MESSAGE_TYPES)[number];

export function isChatMessageType(value: string): value is ChatMessageType {
  return (CHAT_MESSAGE_TYPES as readonly string[]).includes(value);
}

/**
 * Line items of {@link AiChatSessionEntity}. Kept as a separate table so the
 * conversation can be reconstructed from PostgreSQL whenever the Redis short
 * term memory cache expires.
 */
@Entity(AI_CHAT_MESSAGE_TABLE)
@Index('idx_ai_chat_message_session_created', ['sessionId', 'createdAt'])
@Index('idx_ai_chat_message_user', ['userId'])
export class AiChatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning session (no DB-level FK; sessions are deleted through the service). */
  @Column({ type: 'uuid' })
  sessionId!: string;

  /** Denormalised so per-user isolation never needs a join. */
  @Column({ type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  tenantId!: string;

  @Column({ type: 'text' })
  role!: ChatRole;

  @Column({ type: 'text', default: 'text' })
  messageType!: ChatMessageType;

  @Column({ type: 'text' })
  content!: string;

  /** Renderer payload: table / chart / report / confirm definitions. */
  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  tokenCount!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** Shape consumed by the frontend (`ChatMessage`). */
  toJSON() {
    const payload = this.payload as (Record<string, unknown> & { attachments?: unknown }) | null;
    return {
      id: this.id,
      sessionId: this.sessionId,
      role: this.role,
      type: this.messageType,
      content: this.content,
      payload: payload ?? null,
      attachments: payload?.attachments ?? undefined,
      createdAt: this.createdAt?.toISOString?.() ?? null,
    };
  }
}
