import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  CreateSessionBodyDto,
  QuerySessionDto,
  UpdateSessionBodyDto,
} from '../dto/ai-chat-session.dto.js';
import { AiChatSessionService } from '../services/ai-chat-session.service.js';

@ApiTags('ai-agent · sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent/sessions')
export class AiChatSessionController {
  constructor(private readonly sessions: AiChatSessionService) {}

  @Get()
  @ApiOperation({ summary: '分页查询当前用户的会话' })
  list(@CurrentUser() user: AuthUser, @Query() query: QuerySessionDto) {
    return this.sessions.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: '创建新会话' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionBodyDto) {
    return this.sessions.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '按 ID 查询会话及消息历史（仅本人）' })
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.findOneWithMessages(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新会话（标题 / 状态）' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSessionBodyDto,
  ) {
    return this.sessions.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除会话及其消息，并清理会话缓存' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.remove(user, id);
  }
}
