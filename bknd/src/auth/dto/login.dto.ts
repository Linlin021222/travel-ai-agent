import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: '请输入有效的电子邮箱' })
  email!: string;

  @ApiProperty({ example: 'password123' })
  @IsString({ message: '密码必须是文本' })
  @MinLength(8, { message: '密码至少需要 8 个字符' })
  @MaxLength(72, { message: '密码不能超过 72 个字符' })
  password!: string;
}
