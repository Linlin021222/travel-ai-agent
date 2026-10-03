import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
}

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
