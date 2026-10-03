/**
 * Identity attached to every authenticated AI request.
 *
 * `tenantId` defaults to the user id: the current `users` table has no tenant
 * column, so a user is their own tenant. When a token later carries
 * `tenant_id` (or `tenantId`) the AI layer automatically scopes data to that
 * tenant instead — no AI code changes required.
 */
export interface AuthUser {
  userId: string;
  email: string;
  tenantId: string;
  isAdmin: boolean;
}

export interface JwtPayloadShape {
  sub?: string;
  email?: string;
  tenant_id?: string;
  tenantId?: string;
}
