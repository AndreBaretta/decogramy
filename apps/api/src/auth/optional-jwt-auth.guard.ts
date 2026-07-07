import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Like JwtAuthGuard, but never rejects: if a valid token is present the
 * request gets `req.user`, otherwise it proceeds anonymously. Used for public
 * endpoints (profiles/feed of a user) that show extra info (e.g. isFollowing)
 * when a viewer is authenticated.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    return user || undefined;
  }
}
