import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { FeedService } from './feed.service';

@Controller()
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('feed')
  @UseGuards(JwtAuthGuard)
  home(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.feed.home(user.userId, cursor, limit);
  }

  @Get('explore')
  @UseGuards(OptionalJwtAuthGuard)
  explore(@Req() req: any, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.feed.explore(req.user?.userId, cursor, limit);
  }
}
