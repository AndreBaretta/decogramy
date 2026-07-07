import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventType, NotificationType } from '@pastatop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from '../common/outbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';
import { AuthUser } from '../auth/current-user.decorator';

const likeCountKey = (postId: string) => `post:${postId}:likes`;

@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  async like(actor: AuthUser, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'published', deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!post) throw new NotFoundException('post not found');

    const result = await this.prisma.$transaction(async (tx) => {
      // Idempotent: unique (userId, postId). If it already exists, no-op.
      const existing = await tx.like.findUnique({
        where: { userId_postId: { userId: actor.userId, postId } },
      });
      if (existing) {
        const current = await tx.post.findUnique({ where: { id: postId }, select: { likesCount: true } });
        return { likesCount: current?.likesCount ?? 0, created: false };
      }

      await tx.like.create({ data: { userId: actor.userId, postId } });
      const updated = await tx.post.update({
        where: { id: postId },
        data: { likesCount: { increment: 1 } },
        select: { likesCount: true },
      });

      // Notify the post owner (unless liking your own post), then emit the
      // domain event in the SAME transaction as the notification row.
      let notificationId: string | undefined;
      if (post.userId !== actor.userId) {
        const notif = await this.notifications.createInTx(tx, {
          userId: post.userId,
          actorId: actor.userId,
          type: NotificationType.PostLiked,
          entityType: 'post',
          entityId: postId,
          payload: { postId, actorUsername: actor.username },
        });
        notificationId = notif.id;
      }

      await this.outbox.write(tx, [
        {
          eventType: EventType.PostLiked,
          aggregateType: 'post',
          aggregateId: postId,
          payload: {
            postId,
            actorId: actor.userId,
            actorUsername: actor.username,
            targetUserId: post.userId,
            notificationId,
          },
        },
      ]);

      return { likesCount: updated.likesCount, created: true };
    });

    if (result.created) {
      await this.redis.cacheSetInt(likeCountKey(postId), result.likesCount);
    }
    return { liked: true, likesCount: result.likesCount };
  }

  async unlike(actor: AuthUser, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'published', deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!post) throw new NotFoundException('post not found');

    const result = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.like.deleteMany({ where: { userId: actor.userId, postId } });
      if (deleted.count === 0) {
        const current = await tx.post.findUnique({ where: { id: postId }, select: { likesCount: true } });
        return { likesCount: current?.likesCount ?? 0, removed: false };
      }
      const updated = await tx.post.update({
        where: { id: postId },
        data: { likesCount: { decrement: 1 } },
        select: { likesCount: true },
      });
      await this.outbox.write(tx, [
        {
          eventType: EventType.PostUnliked,
          aggregateType: 'post',
          aggregateId: postId,
          payload: {
            postId,
            actorId: actor.userId,
            targetUserId: post.userId,
          },
        },
      ]);
      return { likesCount: updated.likesCount, removed: true };
    });

    if (result.removed) {
      await this.redis.cacheSetInt(likeCountKey(postId), result.likesCount);
    }
    return { liked: false, likesCount: result.likesCount };
  }
}
