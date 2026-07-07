import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const SCAN_INTERVAL_MS = 60_000;
const EXPIRY_MINUTES = 30;

/**
 * Scheduled scanner: posts left in `upload_pending` past the expiry window
 * (upload started but never finalized) are transitioned to `upload_expired`
 * and any partially-uploaded original object is cleaned up. Runs periodically
 * on the worker; the conditional update makes it safe against a late finalize.
 */
@Injectable()
export class ExpiryScanner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryScanner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    this.logger.log('upload-expiry scanner started');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async scan() {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60_000);
      const stale = await this.prisma.post.findMany({
        where: { status: 'upload_pending', createdAt: { lt: cutoff } },
        include: { photo: true },
        take: 100,
      });

      for (const post of stale) {
        const res = await this.prisma.post.updateMany({
          where: { id: post.id, status: 'upload_pending' }, // guard against a late finalize
          data: { status: 'upload_expired' },
        });
        if (res.count === 0) continue;
        if (post.photo?.originalKey) {
          await this.storage.deleteObject(post.photo.originalKey);
        }
        this.logger.log(`expired abandoned upload ${post.id}`);
      }
    } catch (e: any) {
      this.logger.error(`expiry scan error: ${e.message}`);
    } finally {
      this.running = false;
    }
  }
}
