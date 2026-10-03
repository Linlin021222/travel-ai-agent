import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { UsersService } from '../users/users.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SignupDto } from './dto/signup.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.create(email, this.hashPassword(dto.password));
    return this.withToken(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.usersService.findByEmail(email);
    if (!user || !this.verifyPassword(dto.password, user.password_hash)) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    return this.withToken({
      id: user.id,
      email: user.email,
      createdAt: user.created_at.toISOString(),
    });
  }

  private withToken(user: { id: string; email: string; createdAt: string }) {
    return {
      message: '操作成功',
      accessToken: this.jwtService.sign({ sub: user.id, email: user.email }),
      user,
    };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  private verifyPassword(password: string, storedHash: string) {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const derivedKey = scryptSync(password, salt, 64);
    const storedKey = Buffer.from(key, 'hex');
    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
  }
}
