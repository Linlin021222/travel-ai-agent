import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthUser, JwtPayloadShape } from './auth-user.js';

/**
 * Verifies the `Authorization: Bearer <jwt>` header and attaches an
 * {@link AuthUser} to `request.user`.
 *
 * Admin rights come from the `AI_ADMIN_EMAILS` env list because the business
 * `users` table has no role column and must not be altered.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers?.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少登录凭证，请先登录');
    }

    let payload: JwtPayloadShape;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayloadShape>(header.slice(7));
    } catch {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }

    const userId = payload?.sub;
    if (!userId) throw new UnauthorizedException('登录凭证不完整，请重新登录');

    const email = payload.email ?? '';
    request.user = {
      userId,
      email,
      tenantId: payload.tenant_id ?? payload.tenantId ?? userId,
      isAdmin: this.adminEmails().has(email.trim().toLowerCase()),
    };
    return true;
  }

  private adminEmails(): Set<string> {
    const raw = this.config.get<string>('AI_ADMIN_EMAILS') ?? '';
    return new Set(
      raw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
  }
}
