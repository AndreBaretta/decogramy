import { DOMAIN_EVENTS_EXCHANGE, EventType } from '@pastatop/shared';

/**
 * RabbitMQ topology for the worker.
 *
 *   producer ─▶ [domain-events] (topic)
 *                    │  routing key = event type
 *                    ├─▶ q.thumbnail       (image.thumbnail.requested)
 *                    ├─▶ q.notifications   (post.liked, user.followed)
 *                    └─▶ q.cleanup         (post.deleted)
 *
 * On handler failure the message is re-published (with an incremented
 * x-attempt header) to a delay tier:
 *
 *   [domain-events.retry.<d>] (fanout) ─▶ q.retry.<d> (TTL=d, DLX=domain-events)
 *
 * The retry queue holds the message for its TTL, then dead-letters it back to
 * the main exchange preserving the ORIGINAL routing key, so it lands on the
 * same consumer queue again. After the schedule is exhausted the message is
 * routed to the dead-letter exchange for inspection.
 *
 *   [domain-events.dlx] (fanout) ─▶ q.dead
 */
export const EXCHANGE = DOMAIN_EVENTS_EXCHANGE;
export const DLX = 'domain-events.dlx';
export const DEAD_QUEUE = 'q.dead';

export interface RetryTier {
  exchange: string;
  queue: string;
  ttlMs: number;
}

// 10s, 30s, 2m — matches the architecture's retry schedule.
export const RETRY_TIERS: RetryTier[] = [
  { exchange: 'domain-events.retry.10s', queue: 'q.retry.10s', ttlMs: 10_000 },
  { exchange: 'domain-events.retry.30s', queue: 'q.retry.30s', ttlMs: 30_000 },
  { exchange: 'domain-events.retry.2m', queue: 'q.retry.2m', ttlMs: 120_000 },
];

export const QUEUES = {
  thumbnail: 'q.thumbnail',
  notifications: 'q.notifications',
  cleanup: 'q.cleanup',
} as const;

/** queue -> routing keys bound to it on the main exchange */
export const BINDINGS: Record<string, string[]> = {
  [QUEUES.thumbnail]: [EventType.ThumbnailRequested],
  [QUEUES.notifications]: [EventType.PostLiked, EventType.UserFollowed],
  [QUEUES.cleanup]: [EventType.PostDeleted],
};
