import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pastatop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';

export interface CreateNotificationInput {
  userId: string; // recipient
  actorId: string;
  type: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a durable notification row on the caller's transaction, so it
   * commits atomically with the business change (like/follow). Live SSE
   * delivery happens later off the outbox; this row is the source of truth.
   */
  createInTx(tx: Prisma.TransactionClient, input: CreateNotificationInput) {
    return tx.notification.create({
      data: {
        userId: input.userId,
        actorId: input.actorId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: (input.payload ?? {}) as any,
      },
    });
  }

  async list(userId: string, rawCursor?: string, rawLimit?: string) {
    const limit = clampLimit(rawLimit);
    const cursor = decodeCursor(rawCursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { actor: { select: { id: true, username: true, displayName: true } } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null;

    return {
      items: page.map((n) => ({
        id: n.id,
        type: n.type,
        entityType: n.entityType,
        entityId: n.entityId,
        payload: n.payload,
        readAt: n.readAt,
        createdAt: n.createdAt,
        actor: n.actor,
      })),
      nextCursor,
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
