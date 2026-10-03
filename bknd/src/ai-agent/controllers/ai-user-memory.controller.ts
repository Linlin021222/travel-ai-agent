import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  CreateMemoryBodyDto,
  QueryMemoryDto,
  UpdateMemoryBodyDto,
} from '../dto/ai-user-memory.dto.js';
import { AiUserMemoryService } from '../services/ai-user-memory.service.js';

@ApiTags('ai-agent · memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent/memories')
export class AiUserMemoryController {
  constructor(private readonly memories: AiUserMemoryService) {}

  @Get()
  @ApiOperation({ summary: '分页查询当前用户的长期记忆' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryMemoryDto) {
    return this.memories.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: '写入记忆（同一 key + scope 覆盖更新）' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMemoryBodyDto) {
    return this.memories.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '按 ID 查询记忆（仅本人）' })
  async getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return (await this.memories.findOne(user, id)).toJSON();
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新记忆' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMemoryBodyDto,
  ) {
    return this.memories.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除记忆' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.memories.remove(user, id);
  }
}
