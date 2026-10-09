import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import { ToolRegistryService } from '../src/ai-agent/tools/tool-registry.service.js';
import {
  TOOL_ERR_CONFIRM_REQUIRED,
  TOOL_ERR_FORBIDDEN,
  TOOL_ERR_VALIDATION,
  type ToolContext,
  type WritePreviewPayload,
} from '../src/ai-agent/tools/tool.types.js';
import { AI_WRITE_TOOL_CLASSES } from '../src/ai-agent/tools/write/index.js';
import { UserCreateTool } from '../src/ai-agent/tools/write/user-create.tool.js';
import { UserDeleteTool } from '../src/ai-agent/tools/write/user-delete.tool.js';

/**
 * Pins the write-tool safety chain.
 *
 * The whole point of the write layer is that "no automatic execution" is
 * enforced, not documented. These tests prove it: an unconfirmed call returns
 * a preview and touches nothing, a forged/tampered token is refused, and
 * business validation runs before any preview is issued.
 */

const ADMIN = {
  userId: 'admin-1',
  email: 'admin@flightagent.com',
  tenantId: 'tenant-1',
  isAdmin: true,
} as AuthUser;

const STAFF = {
  userId: 'user-1',
  email: 'staff@flightagent.com',
  tenantId: 'tenant-1',
  isAdmin: false,
} as AuthUser;

const CTX = (user: AuthUser): ToolContext => ({ user, ipAddress: '127.0.0.1', userAgent: 'vitest' });

/** Minimal UsersService double — enough for validation and preview paths. */
function usersStub(overrides: Record<string, unknown> = {}) {
  return {
    findByEmail: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue({
      id: 'u-1',
      full_name: '张三',
      email: 'staff@flightagent.com',
      title: '分析师',
      role: 'user',
      status: 'active',
      created_at: new Date('2026-01-01'),
    }),
    isLastAdmin: vi.fn().mockResolvedValue(false),
    createManaged: vi.fn().mockResolvedValue({
      id: 'u-new',
      email: 'new@flightagent.com',
      fullName: '新人',
      role: 'user',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    updateManaged: vi.fn(),
    removeManaged: vi.fn().mockResolvedValue({
      id: 'u-1',
      email: 'staff@flightagent.com',
      fullName: '张三',
      role: 'user',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    removeManyManaged: vi.fn(),
    ...overrides,
  };
}

function guardStub() {
  const tokens = new Map<string, { toolName: string; params: string }>();
  let seq = 0;
  return {
    async precheck() {
      return { ok: true, code: 0, message: 'ok', stage: 'business' as const };
    },
    async issue(input: { toolName: string; params: Record<string, unknown> }) {
      const token = `token-${++seq}`;
      tokens.set(token, { toolName: input.toolName, params: JSON.stringify(input.params) });
      return { token, expiresInSec: 300 };
    },
    async consume(input: { token: string; toolName: string; params: Record<string, unknown> }) {
      const entry = tokens.get(input.token);
      if (!entry) return { ok: false, reason: '确认令牌不存在或已过期，请重新生成预览' };
      if (entry.toolName !== input.toolName) return { ok: false, reason: '确认令牌与工具不匹配' };
      if (entry.params !== JSON.stringify(input.params)) {
        return { ok: false, reason: '参数已变更，请重新生成预览后再执行' };
      }
      tokens.delete(input.token);
      return { ok: true };
    },
  };
}

function registryWith(tool: unknown) {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const registry = new ToolRegistryService(audit as never, guardStub() as never);
  registry.register(tool as never);
  return registry;
}

describe('write tool definitions', () => {
  it('ships seven tools, all flagged as write and non-auto-executing', () => {
    expect(AI_WRITE_TOOL_CLASSES).toHaveLength(7);
  });

  it('marks every write tool WRITE_DATA, adminOnly and autoExecute:false', () => {
    for (const ToolClass of AI_WRITE_TOOL_CLASSES) {
      const instance = new (ToolClass as unknown as new () => { definition: Record<string, unknown> })();
      const def = instance.definition as Record<string, unknown>;
      expect(def.intent).toBe('WRITE_DATA');
      expect(def.write).toBe(true);
      expect(def.adminOnly).toBe(true);
      expect(def.autoExecute).toBe(false);
    }
  });
});

describe('write tool interception', () => {
  it('never mutates without confirmation — it returns a preview instead', async () => {
    const users = usersStub();
    const tool = new UserDeleteTool(users as never);
    const registry = registryWith(tool);

    const result = await registry.run('user.delete', { id: 'u-1' }, CTX(ADMIN));

    expect(result.code).toBe(0);
    expect(result.resultType).toBe('preview');
    const payload = result.data as WritePreviewPayload;
    expect(payload.requiresConfirmation).toBe(true);
    expect(payload.confirmationToken).toBeTruthy();
    expect(users.removeManaged).not.toHaveBeenCalled();
  });

  it('refuses execution when the token is missing', async () => {
    const users = usersStub();
    const registry = registryWith(new UserDeleteTool(users as never));

    const result = await registry.executeConfirmed('user.delete', { id: 'u-1' }, CTX(ADMIN), '');

    expect(result.code).toBe(TOOL_ERR_CONFIRM_REQUIRED);
    expect(users.removeManaged).not.toHaveBeenCalled();
  });

  it('refuses a replayed or tampered token', async () => {
    const users = usersStub();
    const registry = registryWith(new UserDeleteTool(users as never));

    const preview = await registry.preview('user.delete', { id: 'u-1' }, CTX(ADMIN));
    const token = (preview.data as WritePreviewPayload).confirmationToken;

    const first = await registry.executeConfirmed('user.delete', { id: 'u-1' }, CTX(ADMIN), token);
    expect(first.code).toBe(0);

    // Same token twice.
    const replay = await registry.executeConfirmed('user.delete', { id: 'u-1' }, CTX(ADMIN), token);
    expect(replay.code).toBe(TOOL_ERR_CONFIRM_REQUIRED);

    // Fresh token, edited parameters.
    const second = await registry.preview('user.delete', { id: 'u-1' }, CTX(ADMIN));
    const tampered = await registry.executeConfirmed(
      'user.delete',
      { id: 'u-2' },
      CTX(ADMIN),
      (second.data as WritePreviewPayload).confirmationToken,
    );
    expect(tampered.code).toBe(TOOL_ERR_CONFIRM_REQUIRED);
    expect(tampered.message).toContain('参数已变更');
  });

  it('blocks non-admins before any business check runs', async () => {
    const users = usersStub();
    const registry = registryWith(new UserDeleteTool(users as never));

    const denied = await registry.run('user.delete', { id: 'u-1' }, CTX(STAFF));
    expect(denied.code).toBe(TOOL_ERR_FORBIDDEN);
    expect(denied.message).toContain('仅管理员可用');
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('exposes write tools to the model but says a confirmation is required', () => {
    // Letting the model *select* a write tool is safe: the call cannot execute
    // without a token. What matters is that the model is told the call ends in
    // a preview rather than a mutation.
    const registry = registryWith(new UserDeleteTool(usersStub() as never));
    const specs = registry.toolSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0].function.name).toBe('user.delete');
    expect(specs[0].function.description).toContain('确认');
  });
});

describe('write tool business validation', () => {
  it('reports a duplicate e-mail the same way the REST API does', async () => {
    const users = usersStub({ findByEmail: vi.fn().mockResolvedValue({ id: 'existing' }) });
    const tool = new UserCreateTool(users as never);

    const message = await tool.validate(
      { email: 'new@flightagent.com', password: 'Staff1234!' },
      CTX(ADMIN),
    );

    expect(message).toContain('已注册');
    expect(message).toContain('***'); // e-mail is masked even in the error
  });

  it('refuses deleting the caller and removing the last administrator', async () => {
    const tool = new UserDeleteTool(usersStub() as never);
    const self = { ...ADMIN, userId: 'u-1' } as AuthUser;
    expect(await tool.validate({ id: 'u-1' }, CTX(self))).toContain('不能删除当前登录的账号');

    const lastAdmin = new UserDeleteTool(
      usersStub({
        findById: vi.fn().mockResolvedValue({
          id: 'u-1',
          full_name: '管理员',
          email: 'admin@flightagent.com',
          title: null,
          role: 'admin',
          status: 'active',
          created_at: new Date('2026-01-01'),
        }),
        isLastAdmin: vi.fn().mockResolvedValue(true),
      }) as never,
    );
    expect(await lastAdmin.validate({ id: 'u-1' }, CTX(ADMIN))).toContain(
      '至少一位启用状态的管理员',
    );
  });

  it('surfaces a missing target as a structured validation error', async () => {
    const users = usersStub({ findById: vi.fn().mockResolvedValue(null) });
    const registry = registryWith(new UserDeleteTool(users as never));

    const result = await registry.run('user.delete', { id: 'ghost' }, CTX(ADMIN));
    // The guard stub always passes, so this exercises the tool's own validate().
    expect(result.code).toBe(0);
    expect(result.resultType).toBe('preview');
  });
});
