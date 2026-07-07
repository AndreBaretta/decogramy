import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { RabbitService } from './rabbit/rabbit.service';
import { RedisPublisher } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { OutboxPublisher } from './outbox/outbox-publisher.service';
import { ThumbnailConsumer } from './consumers/thumbnail.consumer';
import { NotificationConsumer } from './consumers/notification.consumer';
import { CleanupConsumer } from './consumers/cleanup.consumer';
import { ExpiryScanner } from './expiry/expiry.scanner';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  providers: [
    PrismaService,
    RabbitService,
    RedisPublisher,
    StorageService,
    IdempotencyService,
    // outbox relay: PostgreSQL -> RabbitMQ
    OutboxPublisher,
    // event consumers
    ThumbnailConsumer,
    NotificationConsumer,
    CleanupConsumer,
    // scheduled maintenance
    ExpiryScanner,
  ],
})
export class WorkerModule {}
