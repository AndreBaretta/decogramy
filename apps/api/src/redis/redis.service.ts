import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { LiveNotification, REDIS_NOTIFICATION_PATTERN } from '@pastatop/shared';

/**
 * Wraps two Redis connections:
 *  - `client`     for commands (cache, rate limiting)
 *  - `subscriber` a dedicated connection that pattern-subscribes to
 *                 `notifications:*` and re-emits each message on a local
 *                 EventEmitter keyed by userId, so every SSE stream on this
 *                 API instance can pick up the live notifications addressed
 *                 to its user.
 *
 * Redis is treated as best-effort: every command is guarded so that a Redis
 * outage degrades gracefully (cache bypass, rate-limiter fails open, live
 * SSE delivery is lost) instead of taking down PostgreSQL-backed actions.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  readonly client = new Redis(this.url, { maxRetriesPerRequest: 1, lazyConnect: false });
  private readonly subscriber = new Redis(this.url, { lazyConnect: false });
  private readonly emitter = new EventEmitter();

  constructor() {
    this.client.on('error', (e) => this.logger.warn(`redis client error: ${e.message}`));
    this.subscriber.on('error', (e) => this.logger.warn(`redis subscriber error: ${e.message}`));
    this.emitter.setMaxListeners(0);
  }

  async onModuleInit() {
    try {
      await this.subscriber.psubscribe(REDIS_NOTIFICATION_PATTERN);
      this.subscriber.on('pmessage', (_pattern, channel, message) => {
        // channel is `notifications:<userId>`
        const userId = channel.slice(channel.indexOf(':') + 1);
        try {
          const payload = JSON.parse(message) as LiveNotification;
          this.emitter.emit(userId, payload);
        } catch (e) {
          this.logger.warn(`bad live-notification payload on ${channel}`);
        }
      });
      this.logger.log(`subscribed to ${REDIS_NOTIFICATION_PATTERN}`);
    } catch (e: any) {
      this.logger.warn(`could not psubscribe (live SSE degraded): ${e.message}`);
    }
  }

  async onModuleDestroy() {
    this.client.disconnect();
    this.subscriber.disconnect();
  }

  /** Register a listener for live notifications addressed to `userId`. */
  onUserNotification(userId: string, handler: (n: LiveNotification) => void): () => void {
    this.emitter.on(userId, handler);
    return () => this.emitter.off(userId, handler);
  }

  // --- cache (best-effort, DB stays authoritative) ---

  async cacheGetInt(key: string): Promise<number | null> {
    try {
      const v = await this.client.get(key);
      return v === null ? null : Number(v);
    } catch {
      return null; // bypass cache on failure
    }
  }

  async cacheSetInt(key: string, value: number, ttlSec = 300): Promise<void> {
    try {
      await this.client.set(key, String(value), 'EX', ttlSec);
    } catch {
      /* ignore cache write failures */
    }
  }

  async cacheDel(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      /* ignore */
    }
  }

  /**
   * Fixed-window rate limiter. Returns true if the action is allowed.
   * Fails open (returns true) if Redis is unavailable — an explicit
   * availability tradeoff for the MVP.
   */
  async rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
    try {
      const redisKey = `rl:${key}`;
      const count = await this.client.incr(redisKey);
      if (count === 1) {
        await this.client.expire(redisKey, windowSec);
      }
      return count <= limit;
    } catch {
      return true; // fail open
    }
  }
}
