import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitService } from '../rabbit/rabbit.service';
import { StorageService } from '../storage/storage.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { QUEUES } from '../rabbit/topology';

const HANDLER = 'thumbnail';
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;
const THUMB_SIZE = 400;

/**
 * Consumes `image.thumbnail.requested`. Validates the *actual* uploaded object
 * (the signed-PUT content hints aren't trusted), generates a 400x400
 * center-cropped WebP with Sharp, and transitions photos.thumbnail_status. The
 * post is already `published`, so a failure here just leaves a fallback image —
 * it never blocks the feed.
 */
@Injectable()
export class ThumbnailConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(ThumbnailConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
    private readonly storage: StorageService,
    private readonly idempotency: IdempotencyService,
  ) {}

  onApplicationBootstrap() {
    this.rabbit.registerConsumer(QUEUES.thumbnail, (payload) => this.handle(payload));
  }

  private async handle(event: any) {
    const eventId: string = event.eventId;
    const photoId: string = event.photoId;

    if (await this.idempotency.alreadyProcessed(eventId, HANDLER)) {
      this.logger.log(`skip duplicate ${eventId}`);
      return;
    }

    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo) {
      this.logger.warn(`photo ${photoId} gone — marking event processed`);
      await this.idempotency.markProcessed(eventId, HANDLER);
      return;
    }
    if (photo.thumbnailStatus === 'ready') {
      await this.idempotency.markProcessed(eventId, HANDLER);
      return;
    }

    await this.prisma.photo.update({
      where: { id: photoId },
      data: { thumbnailStatus: 'processing' },
    });

    // Validate the real object before trusting it.
    const meta = await this.storage.head(photo.originalKey);
    const invalid =
      !meta ||
      (meta.contentType && !ALLOWED_MIME.has(meta.contentType)) ||
      (meta.contentLength ?? 0) > MAX_BYTES;

    if (invalid) {
      this.logger.warn(`invalid upload for photo ${photoId} — marking failed + cleaning up`);
      await this.failAndRecord(eventId, photoId);
      await this.storage.deleteObject(photo.originalKey);
      return;
    }

    let thumbnail: Buffer;
    try {
      const bytes = await this.storage.getBytes(photo.originalKey);
      thumbnail = await sharp(bytes)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (e: any) {
      // Unreadable/corrupt image content is a terminal failure for this photo.
      this.logger.warn(`sharp failed for photo ${photoId}: ${e.message}`);
      await this.failAndRecord(eventId, photoId);
      return;
    }

    // Idempotent external write: overwrites the same key on a duplicate.
    await this.storage.putBytes(photo.thumbnailKey, thumbnail, 'image/webp');

    // DB effect + idempotency marker commit together.
    await this.prisma.$transaction(async (tx) => {
      await tx.photo.update({ where: { id: photoId }, data: { thumbnailStatus: 'ready' } });
      await this.idempotency.markProcessedInTx(tx, eventId, HANDLER);
    });

    this.logger.log(`thumbnail ready for photo ${photoId}`);
  }

  private async failAndRecord(eventId: string, photoId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.photo.update({ where: { id: photoId }, data: { thumbnailStatus: 'failed' } });
      await this.idempotency.markProcessedInTx(tx, eventId, HANDLER);
    });
  }
}
