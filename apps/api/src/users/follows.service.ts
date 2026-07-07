import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventType, NotificationType } from '@pastatop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from '../common/outbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/current-user.decorator';

@Injectable()
export class FollowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
  ) {}

  async follow(actor: AuthUser, username: string) {
    const target = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!target) throw new NotFoundException('user not found');
    if (target.id === actor.userId) throw new BadRequestException('cannot follow yourself');

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.follow.findUnique({
        where: { followerId_followingId: { followerId: actor.userId, followingId: target.id } },
      });
      if (existing) return; // idempotent

      await tx.follow.create({ data: { followerId: actor.userId, followingId: target.id } });

      const notif = await this.notifications.createInTx(tx, {
        userId: target.id,
        actorId: actor.userId,
        type: NotificationType.UserFollowed,
        entityType: 'user',
        entityId: actor.userId,
        payload: { actorUsername: actor.username },
      });

      await this.outbox.write(tx, [
        {
          eventType: EventType.UserFollowed,
          aggregateType: 'user',
          aggregateId: target.id,
          payload: {
            actorId: actor.userId,
            actorUsername: actor.username,
            targetUserId: target.id,
            notificationId: notif.id,
          },
        },
      ]);
    });

    return { following: true };
  }

  async unfollow(actor: AuthUser, username: string) {
    const target = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!target) throw new NotFoundException('user not found');

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.follow.deleteMany({
        where: { followerId: actor.userId, followingId: target.id },
      });
      if (deleted.count === 0) return; // idempotent

      await this.outbox.write(tx, [
        {
          eventType: EventType.UserUnfollowed,
          aggregateType: 'user',
          aggregateId: target.id,
          payload: { actorId: actor.userId, targetUserId: target.id },
        },
      ]);
    });

    return { following: false };
  }
}
