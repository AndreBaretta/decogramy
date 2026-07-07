import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) {
    return this.posts.createUpload(user.userId, dto);
  }

  @Post(':id/finalize')
  finalize(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.finalize(user.userId, id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.posts.getPost(id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.posts.remove(user.userId, id);
  }
}
