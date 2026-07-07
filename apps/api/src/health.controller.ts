import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async health() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = 'up';
    } catch {
      checks.postgres = 'down';
    }
    try {
      await this.redis.client.ping();
      checks.redis = 'up';
    } catch {
      checks.redis = 'down';
    }
    return { status: 'ok', checks };
  }
}
