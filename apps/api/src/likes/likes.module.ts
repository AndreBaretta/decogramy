import { Module } from '@nestjs/common';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { OutboxService } from '../common/outbox.service';

@Module({
  controllers: [LikesController],
  providers: [LikesService, OutboxService],
})
export class LikesModule {}
