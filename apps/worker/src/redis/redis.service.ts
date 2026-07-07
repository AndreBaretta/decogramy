import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { LiveNotification, REDIS_NOTIFICATION_CHANNEL } from '@pastatop/shared';

/**
 * Worker side of the SSE bridge: publishes lightweight live-notification
 * messages to a per-user Redis channel. Every API instance is subscribed, so
 * whichever one holds the user's SSE connection forwards it. Best-effort —
 * PostgreSQL notification rows remain authoritative, so a lost publish is fine.
 */
@Injectable()
export class RedisPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(RedisPublisher.name);
  private readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
  });

  constructor() {
    this.client.on('error', (e) => this.logger.warn(`redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }

  async publishNotification(userId: string, notification: LiveNotification): Promise<void> {
    try {
      await this.client.publish(REDIS_NOTIFICATION_CHANNEL(userId), JSON.stringify(notification));
    } catch (e: any) {
      this.logger.warn(`failed to publish live notification: ${e.message}`);
    }
  }
}
