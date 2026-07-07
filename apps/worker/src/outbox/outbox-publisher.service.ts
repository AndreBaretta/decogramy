import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitService } from '../rabbit/rabbit.service';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 20;
const STALE_LOCK_MS = 30_000;
const MAX_BACKOFF_SEC = 60;

interface ClaimedRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date;
}

/**
 * Transactional-outbox publisher.
 *
 * Each tick it (1) recovers locks abandoned by crashed workers, then (2)
 * atomically claims a batch of due `pending` rows using
 * `FOR UPDATE SKIP LOCKED` — so multiple worker replicas can poll the same
 * table concurrently without stepping on each other — and publishes each event
 * to RabbitMQ, waiting for a publisher confirm before marking it `published`.
 * A publish failure (e.g. broker down) leaves the row retryable with
 * exponential backoff; it is never terminally `failed` just because RabbitMQ
 * is unavailable.
 */
@Injectable()
export class OutboxPublisher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private brokerDownLogged = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.logger.log(`outbox publisher started (id=${this.workerId})`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Only proceed if we can reach the broker; otherwise leave rows pending.
      try {
        await this.rabbit.ensureConnection();
        this.brokerDownLogged = false;
      } catch {
        if (!this.brokerDownLogged) {
          this.logger.warn('RabbitMQ unreachable — outbox rows will stay pending until it returns');
          this.brokerDownLogged = true;
        }
        return;
      }

      await this.recoverStaleLocks();
      const rows = await this.claimBatch();
      for (const row of rows) {
        await this.publishRow(row);
      }
    } catch (e: any) {
      this.logger.error(`outbox tick error: ${e.message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Return rows stuck in `processing` (crashed mid-publish) to `pending`. */
  private async recoverStaleLocks() {
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET status = 'pending'::"OutboxStatus", "lockedAt" = NULL, "lockedBy" = NULL
      WHERE status = 'processing'::"OutboxStatus"
        AND "lockedAt" < now() - ${`${STALE_LOCK_MS} milliseconds`}::interval
    `;
  }

  private async claimBatch(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events
      SET status = 'processing'::"OutboxStatus", "lockedAt" = now(), "lockedBy" = ${this.workerId}
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status = 'pending'::"OutboxStatus" AND "nextAttemptAt" <= now()
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
      )
      RETURNING id,
                "eventType" AS event_type,
                "aggregateType" AS aggregate_type,
                "aggregateId" AS aggregate_id,
                payload,
                attempts,
                "createdAt" AS created_at
    `;
  }

  private async publishRow(row: ClaimedRow) {
    const envelope = {
      eventId: row.id,
      type: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      occurredAt: row.created_at.toISOString(),
      ...row.payload,
    };

    try {
      await this.rabbit.publish(row.event_type, envelope, { 'x-event-id': row.id });
      await this.prisma.$executeRaw`
        UPDATE outbox_events
        SET status = 'published'::"OutboxStatus", "publishedAt" = now(), "lockedAt" = NULL, "lockedBy" = NULL
        WHERE id = ${row.id}
      `;
      this.logger.log(`published ${row.event_type} (${row.id})`);
    } catch (e: any) {
      const attempts = row.attempts + 1;
      const backoffSec = Math.min(2 ** attempts, MAX_BACKOFF_SEC);
      await this.prisma.$executeRaw`
        UPDATE outbox_events
        SET status = 'pending'::"OutboxStatus",
            attempts = ${attempts},
            "lastError" = ${String(e.message).slice(0, 500)},
            "nextAttemptAt" = now() + ${`${backoffSec} seconds`}::interval,
            "lockedAt" = NULL,
            "lockedBy" = NULL
        WHERE id = ${row.id}
      `;
      this.logger.warn(`publish failed for ${row.id}, retry in ${backoffSec}s: ${e.message}`);
    }
  }
}
