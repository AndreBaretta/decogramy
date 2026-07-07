import { Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import { FollowsService } from './follows.service';

@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly follows: FollowsService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.userId);
  }

  @Get('users/:username')
  @UseGuards(OptionalJwtAuthGuard)
  profile(@Param('username') username: string, @Req() req: any) {
    return this.users.getProfile(username, req.user?.userId);
  }

  @Get('users/:username/posts')
  @UseGuards(OptionalJwtAuthGuard)
  grid(
    @Param('username') username: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.users.getGrid(username, cursor, limit);
  }

  @Post('users/:username/follow')
  @UseGuards(JwtAuthGuard)
  follow(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    return this.follows.follow(user, username);
  }

  @Delete('users/:username/follow')
  @UseGuards(JwtAuthGuard)
  unfollow(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    return this.follows.unfollow(user, username);
  }
}
