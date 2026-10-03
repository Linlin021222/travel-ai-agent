import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CreateAuditBodyDto, QueryAuditDto } from '../dto/ai-operation-audit.dto.js';
import { AiOperationAuditService } from '../services/ai-operation-audit.service.js';

@ApiTags('ai-agent · audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent/audits')
export class AiOperationAuditController {
  constructor(private readonly audits: AiOperationAuditService) {}

  @Get()
  @ApiOperation({
    summary: '分页查询操作审计；管理员可用 scope=all 查看全量',
  })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryAuditDto) {
    return this.audits.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: '写入一条审计记录' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAuditBodyDto, @Req() req: Request) {
    return this.audits.create(user, dto, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'] ?? undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '按 ID 查询审计记录（管理员可跨用户）' })
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.audits.findOne(user, id);
  }
}
