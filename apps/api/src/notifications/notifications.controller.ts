import {
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(user.userId, cursor, limit);
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  unread(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.userId);
  }

  @Post(':id/read')
  @UseGuards(JwtAuthGuard)
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }

  @Post('read-all')
  @UseGuards(JwtAuthGuard)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.userId);
  }

  /**
   * Live notification stream over SSE. Every API instance is subscribed to
   * Redis Pub/Sub, so a notification published by the worker reaches whichever
   * instance holds this user's connection. Best-effort only: on disconnect the
   * client re-syncs via GET /notifications.
   *
   * EventSource cannot send an Authorization header, so the access token is
   * passed as a query param and verified here.
   */
  @Sse('stream')
  stream(@Query('token') token?: string): Observable<MessageEvent> {
    let userId: string;
    try {
      const payload = this.jwt.verify(token ?? '');
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException('invalid or missing token');
    }

    return new Observable<MessageEvent>((subscriber) => {
      // initial comment/heartbeat so the client knows the stream is open
      subscriber.next({ type: 'ready', data: { userId } });

      const unsubscribe = this.redis.onUserNotification(userId, (n) => {
        subscriber.next({ type: 'notification', data: n });
      });

      // periodic heartbeat keeps proxies from closing an idle connection
      const heartbeat = setInterval(() => {
        subscriber.next({ type: 'ping', data: { t: Date.now() } });
      }, 25_000);

      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }
}
