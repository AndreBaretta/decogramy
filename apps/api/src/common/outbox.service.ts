import { Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import type { Prisma } from '@pastatop/shared';
import type { EventTypeValue } from '@pastatop/shared';

export interface OutboxEventInput {
  eventType: EventTypeValue;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  /**
   * Writes outbox rows using the same transaction client as the caller's
   * business-state change, so the event and the change commit atomically.
   */
  async write(tx: Prisma.TransactionClient, events: OutboxEventInput[]) {
    if (events.length === 0) return;
    await tx.outboxEvent.createMany({
      data: events.map((e) => ({
        id: uuid(),
        eventType: e.eventType,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: e.payload as any,
      })),
    });
  }
}
