import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pastatop/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Idempotent consumption via the processed_events table (PK = event_id +
 * handler_name). RabbitMQ is at-least-once, so every handler must check whether
 * it already ran for an event and skip the side effects on a duplicate.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async alreadyProcessed(eventId: string, handlerName: string): Promise<boolean> {
    const row = await this.prisma.processedEvent.findUnique({
      where: { eventId_handlerName: { eventId, handlerName } },
    });
    return row !== null;
  }

  /** Record within an existing transaction (preferred — commits with the effect). */
  markProcessedInTx(tx: Prisma.TransactionClient, eventId: string, handlerName: string) {
    return tx.processedEvent.create({ data: { eventId, handlerName } });
  }

  /** Record standalone, for handlers whose only effect is external (no DB tx). */
  async markProcessed(eventId: string, handlerName: string) {
    await this.prisma.processedEvent.create({ data: { eventId, handlerName } }).catch(() => {
      /* duplicate insert races are fine — the PK guarantees exactly-once record */
    });
  }
}
