import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { EntityDictionaryService } from '../tools/entity-dictionary.service.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import type { ToolContext } from '../tools/tool.types.js';

/**
 * Tool catalogue + direct execution endpoint.
 *
 * Useful for debugging and for the front end to render tool output without
 * going through the chat API. Every call still requires a JWT and is audited.
 */
@ApiTags('ai-agent · tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent/tools')
export class AiToolController {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly entities: EntityDictionaryService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出所有已注册工具（名称/意图/权限/启用状态）' })
  list() {
    return { items: this.registry.list(), total: this.registry.list().length };
  }

  @Post('match')
  @ApiOperation({ summary: '按问题文本匹配最合适的工具' })
  async match(@Body() body: { query?: string; intent?: string }) {
    await this.entities.ensureLoaded();
    const match = this.registry.match(body?.query ?? '', (body?.intent ?? undefined) as never);
    return { match };
  }

  @Post('reload-entities')
  @ApiOperation({ summary: '重新加载航司/机场字典（数据重新入库后调用，仅管理员）' })
  async reloadEntities(@CurrentUser() user: AuthUser) {
    if (!user.isAdmin) {
      throw new ForbiddenException('仅管理员可以重载实体字典');
    }
    return { entities: await this.entities.refresh() };
  }

  @Post(':name/execute')
  @ApiOperation({
    summary: '直接执行指定工具（自动鉴权 + 审计埋点）',
    description:
      '只读工具直接返回结果；写入工具不会在此执行，只会返回变更预览与一次性确认令牌。',
  })
  execute(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() body: { params?: Record<string, unknown> },
    @Req() req: Request,
  ) {
    return this.registry.run(name, body?.params ?? {}, this.context(user, req));
  }

  @Post(':name/preview')
  @ApiOperation({
    summary: '生成写入工具的变更预览（写入类专用）',
    description: '依次执行参数合法性、权限、业务规则三类校验，通过后签发一次性确认令牌。',
  })
  preview(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() body: { params?: Record<string, unknown> },
    @Req() req: Request,
  ) {
    return this.registry.preview(name, body?.params ?? {}, this.context(user, req));
  }

  @Post(':name/confirm')
  @ApiOperation({
    summary: '凭确认令牌执行写入工具（写入类专用）',
    description:
      '令牌由 preview 签发，绑定工具、调用者与参数指纹，一次性有效、5 分钟过期。',
  })
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() body: { params?: Record<string, unknown>; token?: string },
    @Req() req: Request,
  ) {
    return this.registry.executeConfirmed(
      name,
      body?.params ?? {},
      this.context(user, req),
      body?.token ?? '',
    );
  }

  @Patch(':name/enabled')
  @ApiOperation({ summary: '启用/停用工具（仅管理员）' })
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() body: { enabled: boolean },
  ) {
    if (!user.isAdmin) {
      throw new ForbiddenException('仅管理员可以启停工具');
    }
    const updated = this.registry.setEnabled(name, Boolean(body?.enabled));
    if (!updated) throw new ForbiddenException(`工具「${name}」不存在`);
    return { name, enabled: this.registry.isEnabled(name) };
  }

  private context(user: AuthUser, req: Request): ToolContext {
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip = Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === 'string' ? forwarded.split(',')[0] : undefined;
    return {
      user,
      ipAddress: (ip ?? req.ip ?? null) as string | null,
      userAgent: (req.headers?.['user-agent'] ?? null) as string | null,
    };
  }
}
