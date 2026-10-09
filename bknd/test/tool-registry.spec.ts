import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/auth/auth-user.js';
import { BaseTool, type ToolDefinition } from '../src/ai-agent/tools/base-tool.js';
import { ToolRegistryService } from '../src/ai-agent/tools/tool-registry.service.js';
import {
  maskSensitive,
  TOOL_ERR_DISABLED,
  TOOL_ERR_FORBIDDEN,
  TOOL_ERR_INTERNAL,
  TOOL_ERR_NOT_FOUND,
  TOOL_ERR_VALIDATION,
  toolSuccess,
  type ToolContext,
} from '../src/ai-agent/tools/tool.types.js';

/**
 * Guards the identity rules of the tool layer.
 *
 * "Every tool call carries an authenticated identity" is only meaningful if it
 * is enforced, so these tests pin the four ways a call can be rejected:
 * anonymous, not an administrator, disabled tool, unknown tool — plus the
 * user-facing error text and audit masking.
 */

const ADMIN: AuthUser = {
  userId: 'admin-1',
  email: 'admin@flightagent.com',
  tenantId: 'tenant-1',
  isAdmin: true,
} as AuthUser;

const STAFF: AuthUser = {
  userId: 'user-1',
  email: 'staff@flightagent.com',
  tenantId: 'tenant-1',
  isAdmin: false,
} as AuthUser;

class StubTool extends BaseTool<{ fail?: boolean }, { ok: boolean }> {
  readonly definition: ToolDefinition;

  constructor(overrides: Partial<ToolDefinition> = {}) {
    super();
    this.definition = {
      name: overrides.name ?? 'stub.tool',
      description: 'test tool',
      intent: 'QUERY_DATA',
      resultType: 'table',
      keywords: ['测试'],
      permission: 'public',
      ...overrides,
    } as ToolDefinition;
  }

  validate(params: { fail?: boolean }): string | null {
    return params?.fail === 'validation' as never ? '参数不合法' : null;
  }

  async execute(params: { fail?: boolean }): Promise<ReturnType<typeof toolSuccess<{ ok: boolean }>>> {
    if (params?.fail) throw new Error('数据库连接失败');
    return toolSuccess(this.definition.name, 'table', { ok: true }, { message: 'ok' });
  }
}

/**
 * In-memory stand-in for `WriteGuardService`.
 *
 * The real one issues tokens through Redis; this keeps the registry tests
 * hermetic while preserving the same single-use semantics.
 */
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

function registryWith(tool: StubTool): ToolRegistryService {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const registry = new ToolRegistryService(audit as never, guardStub() as never);
  registry.register(tool as never);
  return registry;
}

const CONTEXT = (user: AuthUser): ToolContext => ({
  user,
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
});

describe('ToolRegistryService identity gates', () => {
  let tool: StubTool;
  let registry: ToolRegistryService;

  beforeEach(() => {
    tool = new StubTool();
    registry = registryWith(tool);
  });

  it('refuses anonymous execution', async () => {
    const result = await registry.run('stub.tool', {}, null);
    expect(result.code).toBe(TOOL_ERR_FORBIDDEN);
    expect(result.message).toContain('缺少用户身份');
  });

  it('refuses a context without a user id', async () => {
    const result = await registry.run('stub.tool', {}, { user: {} as never });
    expect(result.code).toBe(TOOL_ERR_FORBIDDEN);
  });

  it('allows an authenticated caller', async () => {
    const result = await registry.run('stub.tool', {}, CONTEXT(STAFF));
    expect(result.code).toBe(0);
    expect(result.data).toEqual({ ok: true });
  });

  it('blocks administrative tools for non-admins', async () => {
    const adminTool = new StubTool({ name: 'admin.tool', adminOnly: true, permission: 'user:manage' });
    const registry = registryWith(adminTool);

    const denied = await registry.run('admin.tool', {}, CONTEXT(STAFF));
    expect(denied.code).toBe(TOOL_ERR_FORBIDDEN);
    expect(denied.message).toContain('仅管理员可用');

    const allowed = await registry.run('admin.tool', {}, CONTEXT(ADMIN));
    expect(allowed.code).toBe(0);
  });

  it('rejects unknown and disabled tools', async () => {
    expect((await registry.run('nope.tool', {}, CONTEXT(ADMIN))).code).toBe(TOOL_ERR_NOT_FOUND);

    registry.setEnabled('stub.tool', false);
    const disabled = await registry.run('stub.tool', {}, CONTEXT(ADMIN));
    expect(disabled.code).toBe(TOOL_ERR_DISABLED);
    expect(registry.isEnabled('stub.tool')).toBe(false);
  });

  it('surfaces validation errors and hides internal stack traces', async () => {
    const invalid = await registry.run('stub.tool', { fail: 'validation' as never }, CONTEXT(ADMIN));
    expect(invalid.code).toBe(TOOL_ERR_VALIDATION);
    expect(invalid.message).toBe('参数不合法');

    const broken = await registry.run('stub.tool', { fail: true }, CONTEXT(ADMIN));
    expect(broken.code).toBe(TOOL_ERR_INTERNAL);
    expect(broken.message).toBe('工具执行失败，请稍后重试');
    expect(broken.message).not.toContain('数据库连接失败');
    expect(broken.meta?.reason).toContain('数据库连接失败');
  });

  it('never exposes a tool without a parameter schema to the model', () => {
    const specTool = new StubTool({
      name: 'spec.tool',
      parameters: { type: 'object', properties: { a: { type: 'string' } } },
    });
    const registry = registryWith(specTool);
    const specs = registry.toolSpecs();
    expect(specs).toHaveLength(1);
    expect(specs[0].function.name).toBe('spec.tool');

    registry.setEnabled('spec.tool', false);
    expect(registry.toolSpecs()).toHaveLength(0);
  });
});

describe('maskSensitive', () => {
  it('masks credentials, e-mails and identifiers before auditing', () => {
    const masked = maskSensitive({
      email: 'staff@flightagent.com',
      password: 'not-a-real-password',
      token: 'jwt-value',
      nested: { contactEmail: 'a@b.com' },
      note: 'ok',
    }) as unknown as Record<string, unknown>;

    expect(masked.password).toBe('***');
    expect(masked.token).toBe('***');
    expect(String(masked.email)).toBe('st***@flightagent.com');
    expect(String((masked.nested as Record<string, string>).contactEmail)).toContain('***@b.com');
    expect(masked.note).toBe('ok');
  });
});
