import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.js';

/**
 * `@CurrentUser()` injects the whole {@link AuthUser};
 * `@CurrentUser('userId')` injects a single field.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = request.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
