import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const AI_OPERATION_AUDIT_TABLE = 'ai_operation_audit';

export const AUDIT_ACTIONS = [
  'chat.send',
  'chat.cache.invalidate',
  'session.create',
  'session.read',
  'session.update',
  'session.delete',
  'message.create',
  'memory.create',
  'memory.update',
  'memory.delete',
  'task.create',
  'task.update',
  'task.delete',
  'cache.invalidate',
  /** Written automatically by the `@AuditedTool()` decorator for every tool run. */
  'tool.execute',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OPERATIONS = ['create', 'read', 'update', 'delete'] as const;
export type AuditOperation = (typeof AUDIT_OPERATIONS)[number];

/**
 * Append-only audit trail of every AI operation.
 * Regular users only ever see their own rows; administrators (see
 * `AI_ADMIN_EMAILS`) can read the whole table.
 */
@Entity(AI_OPERATION_AUDIT_TABLE)
@Index('idx_ai_audit_user_created', ['userId', 'createdAt'])
@Index('idx_ai_audit_tenant_created', ['tenantId', 'createdAt'])
@Index('idx_ai_audit_action', ['action'])
@Index('idx_ai_audit_resource', ['resourceType', 'resourceId'])
export class AiOperationAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Logical reference to `users.id`. */
  @Column({ type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  tenantId!: string;

  @Column({ type: 'uuid', nullable: true })
  sessionId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  taskId!: string | null;

  @Column({ type: 'text' })
  action!: string;

  @Column({ type: 'text', default: '' })
  resourceType!: string;

  @Column({ type: 'text', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'text', default: 'read' })
  operation!: AuditOperation;

  @Column({ type: 'jsonb', nullable: true })
  requestPayload!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  responseSummary!: Record<string, unknown> | null;

  @Column({ type: 'int', nullable: true })
  statusCode!: number | null;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ type: 'text', nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      tenantId: this.tenantId,
      sessionId: this.sessionId ?? null,
      taskId: this.taskId ?? null,
      action: this.action,
      resourceType: this.resourceType,
      resourceId: this.resourceId ?? null,
      operation: this.operation,
      requestPayload: this.requestPayload ?? null,
      responseSummary: this.responseSummary ?? null,
      statusCode: this.statusCode ?? null,
      success: this.success ?? true,
      ipAddress: this.ipAddress ?? null,
      userAgent: this.userAgent ?? null,
      durationMs: this.durationMs ?? null,
      createdAt: this.createdAt?.toISOString?.() ?? null,
    };
  }
}
