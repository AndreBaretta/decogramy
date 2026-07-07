import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { FollowsService } from './follows.service';
import { StorageService } from '../storage/storage.service';
import { OutboxService } from '../common/outbox.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, FollowsService, StorageService, OutboxService],
})
export class UsersModule {}
