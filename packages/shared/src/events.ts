export const DOMAIN_EVENTS_EXCHANGE = 'domain-events';

export const EventType = {
  PostCreated: 'post.created',
  PostDeleted: 'post.deleted',
  PostLiked: 'post.liked',
  PostUnliked: 'post.unliked',
  UserFollowed: 'user.followed',
  UserUnfollowed: 'user.unfollowed',
  ThumbnailRequested: 'image.thumbnail.requested',
  ThumbnailCompleted: 'image.thumbnail.completed',
  ThumbnailFailed: 'image.thumbnail.failed',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export interface BaseEventPayload {
  eventId: string;
  type: EventTypeValue;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  actorId?: string;
  targetUserId?: string;
  notificationId?: string;
}

export interface PostCreatedPayload extends BaseEventPayload {
  type: 'post.created';
  postId: string;
}

export interface PostLikedPayload extends BaseEventPayload {
  type: 'post.liked' | 'post.unliked';
  postId: string;
  actorId: string;
  targetUserId: string;
  notificationId?: string;
}

export interface UserFollowedPayload extends BaseEventPayload {
  type: 'user.followed' | 'user.unfollowed';
  actorId: string;
  targetUserId: string;
  notificationId?: string;
}

export interface ThumbnailRequestedPayload extends BaseEventPayload {
  type: 'image.thumbnail.requested';
  postId: string;
  photoId: string;
  originalKey: string;
}

export interface ThumbnailCompletedPayload extends BaseEventPayload {
  type: 'image.thumbnail.completed' | 'image.thumbnail.failed';
  postId: string;
  photoId: string;
}

/**
 * Notification types the app persists + delivers live over SSE.
 */
export const NotificationType = {
  PostLiked: 'post.liked',
  UserFollowed: 'user.followed',
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

/**
 * Lightweight live-notification message published to Redis Pub/Sub by the
 * worker and forwarded to connected clients over SSE by the API. It only
 * carries the durable notification id + minimal display hints; PostgreSQL
 * remains authoritative, so message loss here is acceptable.
 */
export interface LiveNotification {
  notificationId: string;
  type: NotificationTypeValue;
  actorId: string;
  actorUsername?: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

/** All live notifications for a user are published to this channel. */
export const REDIS_NOTIFICATION_CHANNEL = (userId: string) => `notifications:${userId}`;

/** Wildcard the API subscribes to so one connection fans out to all users. */
export const REDIS_NOTIFICATION_PATTERN = 'notifications:*';
