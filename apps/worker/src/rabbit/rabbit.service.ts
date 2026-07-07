import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import {
  BINDINGS,
  DEAD_QUEUE,
  DLX,
  EXCHANGE,
  QUEUES,
  RETRY_TIERS,
} from './topology';

const RETRY_HEADER = 'x-attempt';

export type ConsumeHandler = (payload: any, raw: amqp.ConsumeMessage) => Promise<void>;

interface Registration {
  queue: string;
  handler: ConsumeHandler;
}

/**
 * Owns the RabbitMQ connection for the worker. Tolerates the broker being down
 * (for the failure demo): publishes reject fast so the outbox keeps rows
 * pending, and consumers are re-established automatically on reconnect.
 */
@Injectable()
export class RabbitService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitService.name);
  private readonly url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';

  private connection: amqp.ChannelModel | null = null;
  private pubChannel: amqp.ConfirmChannel | null = null;
  private connecting: Promise<void> | null = null;
  private readonly registrations: Registration[] = [];
  private closed = false;

  async onModuleDestroy() {
    this.closed = true;
    try {
      await this.connection?.close();
    } catch {
      /* ignore */
    }
  }

  isReady(): boolean {
    return this.pubChannel !== null;
  }

  /** Idempotently (re)establish the connection, topology, and consumers. */
  async ensureConnection(): Promise<void> {
    if (this.pubChannel) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const connection = await amqp.connect(this.url);
      connection.on('error', (e: Error) => this.logger.warn(`amqp connection error: ${e.message}`));
      connection.on('close', () => {
        if (this.closed) return;
        this.logger.warn('amqp connection closed — will reconnect on next use');
        this.connection = null;
        this.pubChannel = null;
      });

      const channel = await connection.createConfirmChannel();
      await this.assertTopology(channel);
      // prefetch so a slow handler doesn't hog the whole queue
      await channel.prefetch(10);

      this.connection = connection;
      this.pubChannel = channel;
      this.logger.log('connected to RabbitMQ and topology asserted');

      // (re)attach any registered consumers
      for (const reg of this.registrations) {
        await this.attachConsumer(channel, reg);
      }
    })().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private async assertTopology(ch: amqp.ConfirmChannel) {
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    await ch.assertExchange(DLX, 'fanout', { durable: true });
    await ch.assertQueue(DEAD_QUEUE, { durable: true });
    await ch.bindQueue(DEAD_QUEUE, DLX, '');

    // Retry tiers: fanout exchange -> TTL queue -> dead-letters back to main exchange.
    for (const tier of RETRY_TIERS) {
      await ch.assertExchange(tier.exchange, 'fanout', { durable: true });
      await ch.assertQueue(tier.queue, {
        durable: true,
        arguments: {
          'x-message-ttl': tier.ttlMs,
          'x-dead-letter-exchange': EXCHANGE, // original routing key is preserved
        },
      });
      await ch.bindQueue(tier.queue, tier.exchange, '');
    }

    // Consumer queues (dead-letter to DLX as a safety net for rejects).
    for (const [queue, keys] of Object.entries(BINDINGS)) {
      await ch.assertQueue(queue, {
        durable: true,
        arguments: { 'x-dead-letter-exchange': DLX },
      });
      for (const key of keys) {
        await ch.bindQueue(queue, EXCHANGE, key);
      }
    }
  }

  /**
   * Publish to the main exchange and await a publisher confirm. Rejects if the
   * broker is unreachable or nacks — the outbox publisher treats that as a
   * retryable failure and leaves the row pending.
   */
  async publish(routingKey: string, payload: unknown, headers: Record<string, unknown> = {}): Promise<void> {
    await this.ensureConnection();
    const channel = this.pubChannel;
    if (!channel) throw new Error('no channel');
    const content = Buffer.from(JSON.stringify(payload));
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGE,
        routingKey,
        content,
        { persistent: true, contentType: 'application/json', headers },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /** Register a consumer. Attached now if connected, else on next connect. */
  registerConsumer(queue: string, handler: ConsumeHandler) {
    this.registrations.push({ queue, handler });
    if (this.pubChannel) {
      void this.attachConsumer(this.pubChannel, { queue, handler });
    }
  }

  private async attachConsumer(channel: amqp.Channel, reg: Registration) {
    await channel.consume(reg.queue, (msg) => {
      if (!msg) return;
      void this.dispatch(channel, reg, msg);
    });
    this.logger.log(`consuming ${reg.queue}`);
  }

  private async dispatch(channel: amqp.Channel, reg: Registration, msg: amqp.ConsumeMessage) {
    let payload: any;
    try {
      payload = JSON.parse(msg.content.toString());
    } catch {
      this.logger.warn(`unparseable message on ${reg.queue} — sending to DLQ`);
      channel.reject(msg, false); // -> DLX
      return;
    }

    try {
      await reg.handler(payload, msg);
      channel.ack(msg);
    } catch (err: any) {
      const attempt = Number(msg.properties.headers?.[RETRY_HEADER] ?? 0);
      this.logger.warn(
        `handler failed on ${reg.queue} (attempt ${attempt}) for ${payload?.eventId}: ${err.message}`,
      );
      await this.scheduleRetryOrDead(channel, reg.queue, msg, attempt);
      channel.ack(msg); // original is settled; the copy lives on in retry/DLQ
    }
  }

  private async scheduleRetryOrDead(
    channel: amqp.Channel,
    queue: string,
    msg: amqp.ConsumeMessage,
    attempt: number,
  ) {
    const tier = RETRY_TIERS[attempt];
    if (!tier) {
      // Exhausted the schedule — send to the dead-letter exchange.
      this.logger.warn(`retries exhausted for ${queue} — routing to DLQ`);
      channel.publish(DLX, msg.fields.routingKey, msg.content, {
        persistent: true,
        headers: msg.properties.headers,
      });
      return;
    }
    // Re-publish to the delay tier, preserving the original routing key so it
    // returns to this same consumer queue after the TTL.
    channel.publish(tier.exchange, msg.fields.routingKey, msg.content, {
      persistent: true,
      contentType: 'application/json',
      headers: { ...msg.properties.headers, [RETRY_HEADER]: attempt + 1 },
    });
  }
}
