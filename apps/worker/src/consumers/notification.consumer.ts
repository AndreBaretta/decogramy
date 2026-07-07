import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { LiveNotification, NotificationTypeValue } from '@pastatop/shared';
import { RabbitService } from '../rabbit/rabbit.service';
import { RedisPublisher } from '../redis/redis.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { QUEUES } from '../rabbit/topology';

const HANDLER = 'notification-fanout';

/**
 * Consumes notification-bearing domain events (`post.liked`, `user.followed`)
 * and publishes a lightweight live-notification to the recipient's Redis
 * channel. The durable notification row was already written by the API in the
 * originating transaction; this is purely the live-delivery hop, so it is
 * best-effort and carries only the notification_id + display hints.
 */
@Injectable()
export class NotificationConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly rabbit: RabbitService,
    private readonly redis: RedisPublisher,
    private readonly idempotency: IdempotencyService,
  ) {}

  onApplicationBootstrap() {
    this.rabbit.registerConsumer(QUEUES.notifications, (payload) => this.handle(payload));
  }

  private async handle(event: any) {
    const eventId: string = event.eventId;

    // No notification was created (e.g. liking your own post) — nothing to fan out.
    if (!event.notificationId || !event.targetUserId) {
      return;
    }
    if (await this.idempotency.alreadyProcessed(eventId, HANDLER)) {
      return;
    }

    const live: LiveNotification = {
      notificationId: event.notificationId,
      type: event.type as NotificationTypeValue,
      actorId: event.actorId,
      actorUsername: event.actorUsername,
      entityType: event.type === 'user.followed' ? 'user' : 'post',
      entityId: event.type === 'user.followed' ? event.actorId : event.postId,
      createdAt: event.occurredAt,
    };

    await this.redis.publishNotification(event.targetUserId, live);
    await this.idempotency.markProcessed(eventId, HANDLER);
    this.logger.log(`fanned out ${event.type} -> user ${event.targetUserId}`);
  }
}
