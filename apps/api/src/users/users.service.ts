import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getProfile(username: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('user not found');

    const [postsCount, followersCount, followingCount, following] = await Promise.all([
      this.prisma.post.count({ where: { userId: user.id, status: 'published', deletedAt: null } }),
      this.prisma.follow.count({ where: { followingId: user.id } }),
      this.prisma.follow.count({ where: { followerId: user.id } }),
      viewerId && viewerId !== user.id
        ? this.prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: viewerId, followingId: user.id } },
          })
        : Promise.resolve(null),
    ]);

    return {
      ...user,
      postsCount,
      followersCount,
      followingCount,
      isSelf: viewerId === user.id,
      isFollowing: Boolean(following),
    };
  }

  /** Profile grid: the user's published posts, newest first, cursor-paginated. */
  async getGrid(username: string, rawCursor?: string, rawLimit?: string) {
    const user = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) throw new NotFoundException('user not found');

    const limit = clampLimit(rawLimit);
    const cursor = decodeCursor(rawCursor);
    const rows = await this.prisma.post.findMany({
      where: {
        userId: user.id,
        status: 'published',
        deletedAt: null,
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
      include: { photo: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
        : null;

    return {
      items: page.map((p) => ({
        id: p.id,
        caption: p.caption,
        likesCount: p.likesCount,
        createdAt: p.createdAt,
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

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, displayName: true, bio: true, email: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('user not found');
    return user;
  }
}
