import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventType } from '@pastatop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OutboxService } from '../common/outbox.service';
import { CreatePostDto } from './dto/create-post.dto';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
  ) {}

  async createUpload(userId: string, dto: CreatePostDto) {
    const ext = EXT_BY_MIME[dto.mimeType];
    if (!ext) {
      throw new BadRequestException('unsupported mimeType');
    }

    const post = await this.prisma.post.create({
      data: { userId, caption: dto.caption ?? '', status: 'upload_pending' },
    });

    const originalKey = `posts/${post.id}/original.${ext}`;
    const thumbnailKey = `posts/${post.id}/thumbnail.webp`;

    await this.prisma.photo.create({
      data: {
        postId: post.id,
        originalKey,
        thumbnailKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        thumbnailStatus: 'pending',
      },
    });

    const uploadUrl = await this.storage.createPresignedPutUrl(originalKey, dto.mimeType);

    return { postId: post.id, uploadUrl, key: originalKey };
  }

  async finalize(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId }, include: { photo: true } });
    if (!post || !post.photo) {
      throw new NotFoundException('post not found');
    }
    if (post.userId !== userId) {
      throw new ForbiddenException('not your post');
    }
    if (post.status !== 'upload_pending') {
      return this.toPostView(post);
    }

    const exists = await this.storage.objectExists(post.photo.originalKey);
    if (!exists) {
      throw new BadRequestException('uploaded object not found in storage yet');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const published = await tx.post.update({ where: { id: postId }, data: { status: 'published' } });
      await this.outbox.write(tx, [
        {
          eventType: EventType.PostCreated,
          aggregateType: 'post',
          aggregateId: postId,
          payload: { postId, userId },
        },
        {
          eventType: EventType.ThumbnailRequested,
          aggregateType: 'photo',
          aggregateId: post.photo!.id,
          payload: { postId, photoId: post.photo!.id, originalKey: post.photo!.originalKey },
        },
      ]);
      return published;
    });

    return this.toPostView({ ...updated, photo: post.photo });
  }

  async getPost(postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, status: 'published', deletedAt: null },
      include: { photo: true, user: { select: { id: true, username: true, displayName: true } } },
    });
    if (!post) {
      throw new NotFoundException('post not found');
    }
    return this.toPostView(post);
  }

  /**
   * Soft-delete: hide immediately by flipping status, and emit post.deleted so
   * the worker can asynchronously purge the original + thumbnail objects from
   * object storage. Likes/comments rows stay but are hidden via the status.
   */
  async remove(userId: string, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { photo: true },
    });
    if (!post) throw new NotFoundException('post not found');
    if (post.userId !== userId) throw new ForbiddenException('not your post');
    if (post.status === 'deleted') return { deleted: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.post.update({
        where: { id: postId },
        data: { status: 'deleted', deletedAt: new Date() },
      });
      await this.outbox.write(tx, [
        {
          eventType: EventType.PostDeleted,
          aggregateType: 'post',
          aggregateId: postId,
          payload: {
            postId,
            actorId: userId,
            originalKey: post.photo?.originalKey,
            thumbnailKey: post.photo?.thumbnailKey,
          },
        },
      ]);
    });

    return { deleted: true };
  }

  toPostView(post: any) {
    return {
      id: post.id,
      userId: post.userId,
      caption: post.caption,
      status: post.status,
      likesCount: post.likesCount,
      createdAt: post.createdAt,
      user: post.user,
      photo: post.photo
        ? {
            thumbnailUrl: this.storage.publicUrl(post.photo.thumbnailKey),
            originalUrl: this.storage.publicUrl(post.photo.originalKey),
            thumbnailStatus: post.photo.thumbnailStatus,
          }
        : null,
    };
  }
}
