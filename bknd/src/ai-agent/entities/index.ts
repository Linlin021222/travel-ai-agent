/**
 * AI owned entities. These live inside the ai-agent module on purpose: the
 * business schema (users / flight_delay) must stay untouched.
 *
 * Table inventory per the architecture spec:
 *   1. ai_chat_session      — conversation header
 *   1b. ai_chat_message     — line items of ai_chat_session (detail table)
 *   2. ai_user_memory       — long term per-user facts
 *   3. ai_task_record       — durable agent task outcome
 *   4. ai_operation_audit   — append-only operation log
 */
import { AiChatMessageEntity } from './ai-chat-message.entity.js';
import { AiChatSessionEntity } from './ai-chat-session.entity.js';
import { AiOperationAuditEntity } from './ai-operation-audit.entity.js';
import { AiTaskRecordEntity } from './ai-task-record.entity.js';
import { AiUserMemoryEntity } from './ai-user-memory.entity.js';

export * from './ai-chat-message.entity.js';
export * from './ai-chat-session.entity.js';
export * from './ai-operation-audit.entity.js';
export * from './ai-task-record.entity.js';
export * from './ai-user-memory.entity.js';

export const AI_ENTITIES = [
  AiChatSessionEntity,
  AiChatMessageEntity,
  AiUserMemoryEntity,
  AiTaskRecordEntity,
  AiOperationAuditEntity,
] as const;
