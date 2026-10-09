import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';

export interface UserRecord {
  id: string;
  email: string;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

interface UserProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  title: string | null;
  role: string | null;
  status: string | null;
  created_at: Date | string;
}

export interface UserQueryOptions {
  /** Matches name, e-mail or title. */
  keyword?: string;
  roles?: string[];
  titles?: string[];
  statuses?: string[];
  page?: number;
  pageSize?: number;
  sortBy?: 'full_name' | 'email' | 'role' | 'status' | 'created_at';
  sortDir?: 'asc' | 'desc';
}

export interface UserListRow {
  id: string;
  fullName: string;
  email: string;
  title: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export interface PagedUsers {
  data: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class UsersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(
      'SELECT id, email, password_hash, created_at FROM users WHERE email = $1 LIMIT 1',
      [email],
    );
    return result.rows[0] ?? null;
  }

  async create(email: string, passwordHash: string): Promise<UserRecord> {
    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('该邮箱已注册');
    }

    const result = await this.pool.query<UserRow>(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, created_at`,
      [randomUUID(), email, passwordHash],
    );
    const user = result.rows[0];
    return {
      id: user.id,
      email: user.email,
      createdAt: user.created_at.toISOString(),
    };
  }

  /**
   * Paginated user directory used by the AI "user query" tool.
   *
   * Kept here (not inside the tool) so the tool layer never touches the table
   * directly and every future caller shares one implementation.
   */
  async query(options: UserQueryOptions = {}): Promise<PagedUsers> {
    const page = Math.max(1, Math.trunc(options.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 20) || 20));
    const offset = (page - 1) * pageSize;

    const clauses: string[] = [];
    const params: unknown[] = [];

    const keyword = options.keyword?.trim();
    if (keyword) {
      params.push(`%${keyword}%`);
      clauses.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR COALESCE(title,'') ILIKE $${params.length})`);
    }

    const roles = normalizeList(options.roles);
    if (roles.length) {
      params.push(roles);
      clauses.push(`role = ANY($${params.length}::text[])`);
    }

    const titles = normalizeList(options.titles);
    if (titles.length) {
      params.push(titles);
      clauses.push(`COALESCE(title,'') = ANY($${params.length}::text[])`);
    }

    const statuses = normalizeList(options.statuses);
    if (statuses.length) {
      params.push(statuses);
      clauses.push(`status = ANY($${params.length}::text[])`);
    }

    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM users${where}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const orderBy = `${USER_SORT_COLUMN[options.sortBy ?? 'created_at']} ${options.sortDir === 'asc' ? 'ASC' : 'DESC'}`;

    const rows = total
      ? await this.pool.query<UserProfileRow>(
          `SELECT id, full_name, email, title, role, status, created_at
             FROM users${where}
            ORDER BY ${orderBy}, id ASC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, pageSize, offset],
        )
      : { rows: [] as UserProfileRow[] };

    return {
      data: rows.rows.map((row) => ({
        id: row.id,
        fullName: row.full_name ?? '',
        email: row.email,
        title: row.title ?? null,
        role: row.role ?? 'user',
        status: row.status ?? 'active',
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      })),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /* -------------------------------------------------------------------------- */
  /* Write operations (added for the AI write tools)                            */
  /*                                                                            */
  /* Every mutation lives here, not inside a tool. The tools inject this        */
  /* service and call these methods, so validation, uniqueness and the          */
  /* "last admin" guard stay in one place and behave identically for the REST   */
  /* API and for the assistant.                                                 */
  /* -------------------------------------------------------------------------- */

  async findById(id: string): Promise<UserProfileRow | null> {
    const result = await this.pool.query<UserProfileRow>(
      'SELECT id, full_name, email, title, role, status, created_at FROM users WHERE id = $1 LIMIT 1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Creates a user with a profile.
   *
   * Business rules: e-mail must be unique (409) and every enum-valued column
   * must hold a legal value (400).
   */
  async createManaged(input: {
    email: string;
    password: string;
    fullName?: string | null;
    title?: string | null;
    role?: string;
    status?: string;
  }): Promise<UserListRow> {
    const email = input.email.trim().toLowerCase();
    this.assertEmail(email);
    const role = input.role ?? 'user';
    const status = input.status ?? 'active';
    this.assertRole(role);
    this.assertStatus(status);
    this.assertPassword(input.password);

    const existing = await this.findByEmail(email);
    if (existing) {
      throw new ConflictException('该邮箱已注册');
    }

    const result = await this.pool.query<UserProfileRow>(
      `INSERT INTO users (id, email, password_hash, full_name, title, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, email, title, role, status, created_at`,
      [
        randomUUID(),
        email,
        this.hashPassword(input.password),
        input.fullName?.trim() || null,
        input.title?.trim() || null,
        role,
        status,
      ],
    );

    return this.toListRow(result.rows[0]);
  }

  /** Partial update; only the supplied columns are touched. */
  async updateManaged(
    id: string,
    patch: {
      email?: string;
      fullName?: string | null;
      title?: string | null;
      role?: string;
      status?: string;
    },
    actorId?: string,
  ): Promise<UserListRow> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundException('用户不存在');
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      this.assertEmail(email);
      if (email !== current.email) {
        const clash = await this.findByEmail(email);
        if (clash) throw new ConflictException('该邮箱已注册');
      }
      params.push(email);
      sets.push(`email = $${params.length}`);
    }
    if (patch.fullName !== undefined) {
      params.push(patch.fullName?.trim() || null);
      sets.push(`full_name = $${params.length}`);
    }
    if (patch.title !== undefined) {
      params.push(patch.title?.trim() || null);
      sets.push(`title = $${params.length}`);
    }
    if (patch.role !== undefined) {
      this.assertRole(patch.role);
      // Demoting yourself would lock everyone (including you) out of admin.
      if (actorId && actorId === id && current.role === 'admin' && patch.role !== 'admin') {
        throw new BadRequestException('不能修改自己的管理员角色');
      }
      if (current.role === 'admin' && patch.role !== 'admin') {
        await this.assertNotLastAdmin(id);
      }
      params.push(patch.role);
      sets.push(`role = $${params.length}`);
    }
    if (patch.status !== undefined) {
      this.assertStatus(patch.status);
      if (actorId && actorId === id && patch.status !== 'active') {
        throw new BadRequestException('不能停用当前登录的账号');
      }
      if (current.role === 'admin' && patch.status !== 'active') {
        await this.assertNotLastAdmin(id);
      }
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }

    if (!sets.length) {
      throw new BadRequestException('没有需要更新的字段');
    }

    params.push(id);
    const result = await this.pool.query<UserProfileRow>(
      `UPDATE users SET ${sets.join(', ')}, updated_at = now()
         WHERE id = $${params.length}
       RETURNING id, full_name, email, title, role, status, created_at`,
      params,
    );

    return this.toListRow(result.rows[0]);
  }

  async removeManaged(id: string, actorId?: string): Promise<UserListRow> {
    const current = await this.findById(id);
    if (!current) {
      throw new NotFoundException('用户不存在');
    }
    if (actorId && actorId === id) {
      throw new BadRequestException('不能删除当前登录的账号');
    }
    if (current.role === 'admin') {
      await this.assertNotLastAdmin(id);
    }

    await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
    return this.toListRow(current);
  }

  /**
   * Batch delete. Partial success is refused: the whole batch is validated
   * first, so a failure never leaves half of it deleted.
   */
  async removeManyManaged(
    ids: string[],
    actorId?: string,
  ): Promise<{ deleted: UserListRow[]; skipped: Array<{ id: string; reason: string }> }> {
    const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
    if (!unique.length) throw new BadRequestException('请提供要删除的用户 ID');
    if (unique.length > MAX_BATCH_DELETE) {
      throw new BadRequestException(`单次最多删除 ${MAX_BATCH_DELETE} 个用户`);
    }

    const deleted: UserListRow[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const id of unique) {
      try {
        deleted.push(await this.removeManaged(id, actorId));
      } catch (error) {
        skipped.push({
          id,
          reason: error instanceof HttpException ? this.messageOf(error) : '删除失败',
        });
      }
    }

    if (!deleted.length) {
      throw new BadRequestException(
        skipped[0]?.reason ?? '没有可删除的用户',
      );
    }
    return { deleted, skipped };
  }

  /* --------------------------- business rule checks ------------------------- */

  /** True when the row is the only remaining administrator. */
  async isLastAdmin(id: string): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::bigint AS count FROM users WHERE role = 'admin' AND status = 'active'",
    );
    const total = Number(result.rows[0]?.count ?? 0);
    const target = await this.findById(id);
    if (!target) return false;
    if (target.role !== 'admin') return false;
    return total <= 1;
  }

  private async assertNotLastAdmin(id: string): Promise<void> {
    if (await this.isLastAdmin(id)) {
      throw new BadRequestException('系统必须保留至少一位启用状态的管理员');
    }
  }

  private assertEmail(email: string): void {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }
  }

  private assertPassword(password: string): void {
    if (!password || password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }
  }

  private assertRole(role: string): void {
    if (!(USER_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(`角色不合法，可选值：${USER_ROLES.join('、')}`);
    }
  }

  private assertStatus(status: string): void {
    if (!(USER_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`状态不合法，可选值：${USER_STATUSES.join('、')}`);
    }
  }

  private messageOf(error: HttpException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('；');
    }
    return error.message;
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  private toListRow(row: UserProfileRow): UserListRow {
    return {
      id: row.id,
      fullName: row.full_name ?? '',
      email: row.email,
      title: row.title ?? null,
      role: row.role ?? 'user',
      status: row.status ?? 'active',
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    };
  }
}

export const USER_ROLES = ['user', 'admin'] as const;
export const USER_STATUSES = ['active', 'inactive', 'suspended'] as const;
/** Upper bound for one batch delete — keeps a bad prompt from wiping the table. */
export const MAX_BATCH_DELETE = 50;

const USER_SORT_COLUMN: Record<string, string> = {
  full_name: 'full_name',
  email: 'email',
  role: 'role',
  status: 'status',
  created_at: 'created_at',
};

function normalizeList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value).trim()).filter(Boolean);
}
