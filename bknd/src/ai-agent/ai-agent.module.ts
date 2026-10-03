import { Module, type FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AI_DATA_SOURCE } from './ai-orm.constants.js';
import { AiSnakeNamingStrategy } from './ai-snake-naming.strategy.js';
import { AiAgentController } from './ai-agent.controller.js';
import { AiAgentService } from './ai-agent.service.js';
import { AiCacheController } from './controllers/ai-cache.controller.js';
import { AiChatSessionController } from './controllers/ai-chat-session.controller.js';
import { AiOperationAuditController } from './controllers/ai-operation-audit.controller.js';
import { AiTaskRecordController } from './controllers/ai-task-record.controller.js';
import { AiUserMemoryController } from './controllers/ai-user-memory.controller.js';
import { AiRedisModule } from './cache/ai-redis.module.js';
import { AiCacheService } from './cache/ai-cache.service.js';
import { AI_ENTITIES } from './entities/index.js';
import { AiChatSessionService } from './services/ai-chat-session.service.js';
import { AiOperationAuditService } from './services/ai-operation-audit.service.js';
import { AiTaskRecordService } from './services/ai-task-record.service.js';
import { AiUserMemoryService } from './services/ai-user-memory.service.js';
import { AiToolController } from './controllers/ai-tool.controller.js';
import { AI_TOOL_CLASSES, type BaseTool } from './tools/index.js';
import { ToolRegistryService } from './tools/tool-registry.service.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { FlightDelayModule } from '../flight-delay/flight-delay.module.js';
import { UsersModule } from '../users/users.module.js';

/** Auto-registers every tool provider once the module is up. */
export const TOOL_BOOTSTRAP: FactoryProvider = {
  provide: 'TOOL_BOOTSTRAP',
  useFactory: (registry: ToolRegistryService, ...tools: BaseTool<never, unknown>[]) => {
    registry.registerAll(tools);
    return true;
  },
  inject: [ToolRegistryService, ...AI_TOOL_CLASSES],
};

/**
 * AI module owns:
 *   - a dedicated TypeORM connection (`ai`) so AI entities never touch business tables,
 *   - a dedicated Redis connection, reachable only through `AiCacheService`,
 *   - JWT-guarded CRUD for ai_chat_session / ai_user_memory / ai_task_record /
 *     ai_operation_audit.
 */
@Module({
  imports: [
    AiRedisModule,
    DashboardModule,
    FlightDelayModule,
    UsersModule,
    TypeOrmModule.forRootAsync({
      name: AI_DATA_SOURCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [...AI_ENTITIES],
        namingStrategy: new AiSnakeNamingStrategy(),
        // Only the 5 AI entities are registered, so business tables are never altered.
        synchronize: config.get<string>('AI_DB_SYNCHRONIZE') !== 'false',
        logging: false,
      }),
    }),
    TypeOrmModule.forFeature([...AI_ENTITIES], AI_DATA_SOURCE),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '1h') as never },
      }),
    }),
  ],
  controllers: [
    AiAgentController,
    AiChatSessionController,
    AiUserMemoryController,
    AiTaskRecordController,
    AiOperationAuditController,
    AiCacheController,
    AiToolController,
  ],
  providers: [
    AiAgentService,
    AiCacheService,
    AiChatSessionService,
    AiUserMemoryService,
    AiTaskRecordService,
    AiOperationAuditService,
    ...AI_TOOL_CLASSES,
    ToolRegistryService,
    TOOL_BOOTSTRAP,
  ],
  exports: [AiCacheService, AiChatSessionService, AiUserMemoryService, ToolRegistryService],
})
export class AiAgentModule {}
