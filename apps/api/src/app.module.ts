import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { PostsModule } from './posts/posts.module';
import { LikesModule } from './likes/likes.module';
import { UsersModule } from './users/users.module';
import { FeedModule } from './feed/feed.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global infrastructure
    PrismaModule,
    RedisModule,
    NotificationsModule,
    // Feature modules
    AuthModule,
    PostsModule,
    LikesModule,
    UsersModule,
    FeedModule,
  ],
})
export class AppModule {}
