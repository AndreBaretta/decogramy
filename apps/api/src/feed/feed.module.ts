import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [FeedController],
  providers: [FeedService, StorageService],
})
export class FeedModule {}
