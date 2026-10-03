import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const AI_TASK_RECORD_TABLE = 'ai_task_record';

export const TASK_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Durable record of an agent task. The live, mutable state lives in Redis under
 * `ai:task_state:` (see `AiCacheService`); this table keeps the auditable
 * outcome so history survives a cache expiry.
 */
@Entity(AI_TASK_RECORD_TABLE)
@Index('idx_ai_task_record_user_created', ['userId', 'createdAt'])
@Index('idx_ai_task_record_tenant', ['tenantId'])
@Index('idx_ai_task_record_status', ['status'])
@Index('idx_ai_task_record_type', ['taskType'])
export class AiTaskRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Logical reference to `users.id`. */
  @Column({ type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  sessionId!: string | null;

  @Column({ type: 'text' })
  taskType!: string;

  @Column({ type: 'text', default: '' })
  title!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: TaskStatus;

  /** 0..100 */
  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ type: 'jsonb', nullable: true })
  input!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  output!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  /** LangGraph thread id — links this row to its `ai:task_state:` cache entry. */
  @Column({ type: 'text', nullable: true })
  threadId!: string | null;

  @Column({ type: 'text', nullable: true })
  runId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

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
      sessionId: this.sessionId,
      taskType: this.taskType,
      title: this.title,
      status: this.status,
      progress: this.progress ?? 0,
      input: this.input ?? null,
      output: this.output ?? null,
      errorMessage: this.errorMessage ?? null,
      threadId: this.threadId ?? null,
      runId: this.runId ?? null,
      startedAt: this.startedAt?.toISOString?.() ?? null,
      finishedAt: this.finishedAt?.toISOString?.() ?? null,
      durationMs: this.durationMs ?? null,
      metadata: this.metadata ?? null,
      createdAt: this.createdAt?.toISOString?.() ?? null,
      updatedAt: this.updatedAt?.toISOString?.() ?? null,
    };
  }
}
