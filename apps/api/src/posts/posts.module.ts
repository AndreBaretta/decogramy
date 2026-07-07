import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { StorageService } from '../storage/storage.service';
import { OutboxService } from '../common/outbox.service';

@Module({
  controllers: [PostsController],
  providers: [PostsService, StorageService, OutboxService],
  exports: [StorageService],
})
export class PostsModule {}
