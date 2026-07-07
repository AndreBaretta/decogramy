import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });
    if (existing) {
      throw new ConflictException('email or username already in use');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        passwordHash,
        displayName: dto.displayName,
      },
    });

    return this.issueToken(user.id, user.username);
  }

  async login(dto: LoginDto) {
    // Redis-backed brute-force limit (fails open if Redis is down).
    const allowed = await this.redis.rateLimit(`login:${dto.email}`, 10, 60);
    if (!allowed) {
      throw new HttpException('too many login attempts, slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('invalid credentials');
    }
    return this.issueToken(user.id, user.username);
  }

  private issueToken(userId: string, username: string) {
    const accessToken = this.jwt.sign({ sub: userId, username });
    return {
      accessToken,
      user: { id: userId, username },
    };
  }
}
