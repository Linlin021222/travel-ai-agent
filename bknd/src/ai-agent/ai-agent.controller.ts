import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AiAgentService, type ChatReply } from './ai-agent.service.js';
import { AppendMessageDto, SendChatMessageDto } from './dto/chat.dto.js';
import { LLM_PROVIDERS } from './llm/llm.config.js';

/** IP + UA are threaded down so tool executions can be audited properly. */
function requestContext(req: Request): { ipAddress: string | null; userAgent: string | null } {
  const forwarded = req.headers?.['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : undefined;
  return {
    ipAddress: (rawIp ?? req.ip ?? null) as string | null,
    userAgent: (req.headers?.['user-agent'] ?? null) as string | null,
  };
}

@ApiTags('ai-agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent')
export class AiAgentController {
  constructor(private readonly aiAgentService: AiAgentService) {}

  @Get('providers')
  @ApiOperation({ summary: '列出可用的大模型提供商及当前默认' })
  listProviders() {
    return {
      default: (process.env.LLM_PROVIDER ?? 'deepseek').toLowerCase(),
      defaultModel: process.env.LLM_MODEL ?? '',
      providers: Object.values(LLM_PROVIDERS).map((p) => ({
        id: p.id,
        label: p.label,
        defaultModel: p.defaultModel,
        configured: !p.apiKeyEnv || Boolean(process.env[p.apiKeyEnv]),
      })),
    };
  }

  @Post('chat')
  @ApiOperation({ summary: '发送一条消息并获取模型回复（多轮对话，带 Redis 缓存）' })
  @ApiOkResponse({ description: '模型回复以及所属会话 ID' })
  chat(
    @Body() dto: SendChatMessageDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ChatReply> {
    return this.aiAgentService.chat(dto, user, requestContext(req));
  }

  @Post('sessions/:id/messages')
  @ApiOperation({ summary: '向会话追加一条结构化消息（表格/图表/报表/确认）' })
  appendMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AppendMessageDto,
  ) {
    return this.aiAgentService.appendMessage(user, id, dto);
  }
}
