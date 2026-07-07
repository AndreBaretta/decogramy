import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { RabbitService } from '../rabbit/rabbit.service';
import { StorageService } from '../storage/storage.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { QUEUES } from '../rabbit/topology';

const HANDLER = 'cleanup';

/**
 * Consumes `post.deleted` and asynchronously purges the original + thumbnail
 * objects from storage. Deletes are idempotent (removing a missing object is a
 * no-op), so at-least-once redelivery is harmless.
 */
@Injectable()
export class CleanupConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(CleanupConsumer.name);

  constructor(
    private readonly rabbit: RabbitService,
    private readonly storage: StorageService,
    private readonly idempotency: IdempotencyService,
  ) {}

  onApplicationBootstrap() {
    this.rabbit.registerConsumer(QUEUES.cleanup, (payload) => this.handle(payload));
  }

  private async handle(event: any) {
    const eventId: string = event.eventId;
    if (await this.idempotency.alreadyProcessed(eventId, HANDLER)) {
      return;
    }

    const keys = [event.originalKey, event.thumbnailKey].filter(Boolean) as string[];
    for (const key of keys) {
      await this.storage.deleteObject(key);
    }

    await this.idempotency.markProcessed(eventId, HANDLER);
    this.logger.log(`cleaned up ${keys.length} object(s) for post ${event.postId}`);
  }
}
