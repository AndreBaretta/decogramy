import { Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, CurrentUser } from '../auth/current-user.decorator';
import { LikesService } from './likes.service';

@Controller('posts/:id/like')
@UseGuards(JwtAuthGuard)
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Post()
  like(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.likes.like(user, id);
  }

  @Delete()
  unlike(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.likes.unlike(user, id);
  }
}
