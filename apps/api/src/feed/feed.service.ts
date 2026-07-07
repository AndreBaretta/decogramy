import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pastatop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Home feed: fan-out-on-read over the viewer's followees plus their own posts. */
  async home(viewerId: string, rawCursor?: string, rawLimit?: string) {
    const following = await this.prisma.follow.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    const authorIds = [viewerId, ...following.map((f) => f.followingId)];
    return this.paginate({ userId: { in: authorIds } }, viewerId, rawCursor, rawLimit);
  }

  /** Explore: all published posts (helps discovery in a fresh demo). */
  async explore(viewerId: string | undefined, rawCursor?: string, rawLimit?: string) {
    return this.paginate({}, viewerId, rawCursor, rawLimit);
  }

  private async paginate(
    extraWhere: Prisma.PostWhereInput,
    viewerId: string | undefined,
    rawCursor?: string,
    rawLimit?: string,
  ) {
    const limit = clampLimit(rawLimit);
    const cursor = decodeCursor(rawCursor);

    const rows = await this.prisma.post.findMany({
      where: {
        status: 'published',
        deletedAt: null,
        ...extraWhere,
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
      include: {
        photo: true,
        user: { select: { id: true, username: true, displayName: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null;

    // Resolve the viewer's like-state for this page in a single query.
    let likedIds = new Set<string>();
    if (viewerId && page.length > 0) {
      const likes = await this.prisma.like.findMany({
        where: { userId: viewerId, postId: { in: page.map((p) => p.id) } },
        select: { postId: true },
      });
      likedIds = new Set(likes.map((l) => l.postId));
    }

    return {
      items: page.map((p) => ({
        id: p.id,
        caption: p.caption,
        likesCount: p.likesCount,
        likedByViewer: likedIds.has(p.id),
        createdAt: p.createdAt,
        user: p.user,
        photo: p.photo
          ? {
              thumbnailStatus: p.photo.thumbnailStatus,
              thumbnailUrl: this.storage.publicUrl(p.photo.thumbnailKey),
              originalUrl: this.storage.publicUrl(p.photo.originalKey),
            }
          : null,
      })),
      nextCursor,
    };
  }
}
