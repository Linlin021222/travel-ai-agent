import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { USER_ROLES, USER_STATUSES } from '../users.service.js';

/**
 * Business DTOs for user mutations.
 *
 * They live in the *business* module, not in the AI module: the AI write tools
 * reuse them verbatim through `class-validator`, so an assistant request and a
 * REST request are validated by exactly the same rules and return the same
 * messages.
 */

export class CreateUserDto {
  @ApiProperty({ example: 'alice@flightagent.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @ApiProperty({ example: 'Staff1234!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  password!: string;

  @ApiPropertyOptional({ example: '张三' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: '数据分析师' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: 'user', enum: [...USER_ROLES] })
  @IsOptional()
  @IsIn([...USER_ROLES], { message: `角色不合法，可选值：${USER_ROLES.join('、')}` })
  role?: string;

  @ApiPropertyOptional({ example: 'active', enum: [...USER_STATUSES] })
  @IsOptional()
  @IsIn([...USER_STATUSES], { message: `状态不合法，可选值：${USER_STATUSES.join('、')}` })
  status?: string;
}

export class UpdateUserDto {
  @ApiProperty({ description: '要修改的用户 ID' })
  @IsString()
  @IsNotEmpty({ message: '用户 ID 不能为空' })
  id!: string;

  @ApiPropertyOptional({ example: 'alice@flightagent.com' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @ApiPropertyOptional({ example: '张三' })
  @IsOptional()
  @IsString()
  fullName?: string | null;

  @ApiPropertyOptional({ example: '数据分析师' })
  @IsOptional()
  @IsString()
  title?: string | null;

  @ApiPropertyOptional({ example: 'admin', enum: [...USER_ROLES] })
  @IsOptional()
  @IsIn([...USER_ROLES], { message: `角色不合法，可选值：${USER_ROLES.join('、')}` })
  role?: string;

  @ApiPropertyOptional({ example: 'inactive', enum: [...USER_STATUSES] })
  @IsOptional()
  @IsIn([...USER_STATUSES], { message: `状态不合法，可选值：${USER_STATUSES.join('、')}` })
  status?: string;
}

export class DeleteUserDto {
  @ApiProperty({ description: '要删除的用户 ID' })
  @IsString()
  @IsNotEmpty({ message: '用户 ID 不能为空' })
  id!: string;
}

export class BatchDeleteUsersDto {
  @ApiProperty({ description: '要删除的用户 ID 列表', example: ['id-1', 'id-2'], maxItems: 50 })
  @IsNotEmpty({ message: '请提供要删除的用户 ID' })
  ids!: string[];
}
