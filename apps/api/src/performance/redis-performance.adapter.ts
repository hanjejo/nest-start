import { createClient, RedisClientType } from 'redis';
import {
  FixedWindowCounter,
  PerformanceHealth,
  PerformanceStorePort,
} from './performance.types';

type RedisClient = RedisClientType;

export type RedisPerformanceAdapterOptions = Readonly<{
  url: string;
  connectTimeoutMs: number;
  operationTimeoutMs: number;
}>;

export class RedisPerformanceAdapter implements PerformanceStorePort {
  private client: RedisClient;
  private connecting: Promise<void> | undefined;
  private closed = false;

  constructor(private readonly options: RedisPerformanceAdapterOptions) {
    if (!options.url.trim()) {
      throw new TypeError('Redis URL is required');
    }
    this.client = this.createClient();
  }

  async get(key: string): Promise<string | null> {
    const value = await this.run((client) => client.get(this.redisKey(key)));
    return value === null ? null : String(value);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.assertPositiveSeconds(ttlSeconds);
    await this.run((client) =>
      client.set(this.redisKey(key), value, { EX: ttlSeconds }),
    );
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (ttlSeconds !== undefined) {
      this.assertPositiveSeconds(ttlSeconds);
    }
    const result = await this.run((client) =>
      client.set(this.redisKey(key), value, {
        ...(ttlSeconds === undefined ? {} : { EX: ttlSeconds }),
        NX: true,
      }),
    );
    return result === 'OK';
  }

  async delete(key: string): Promise<void> {
    await this.run((client) =>
      client.del(this.redisKey(key)).then(() => undefined),
    );
  }

  async increment(key: string): Promise<number> {
    const value = Number(
      await this.run((client) => client.incr(this.redisKey(key))),
    );
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Redis returned an invalid counter');
    }
    return value;
  }

  async incrementFixedWindow(
    key: string,
    windowSeconds: number,
  ): Promise<FixedWindowCounter> {
    this.assertPositiveSeconds(windowSeconds);
    const windowMilliseconds = windowSeconds * 1_000;
    const windowStart =
      Math.floor(Date.now() / windowMilliseconds) * windowMilliseconds;
    const bucketKey = `${this.redisKey(key)}:${windowStart}`;
    const replies = await this.run((client) =>
      client.multi().incr(bucketKey).expire(bucketKey, windowSeconds).exec(),
    );
    const count = Number(replies?.[0]);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error('Redis returned an invalid rate-limit counter');
    }
    return {
      count,
      resetAt: windowStart + windowMilliseconds,
    };
  }

  async health(): Promise<PerformanceHealth> {
    try {
      await this.run((client) => client.ping());
      return { status: 'up', mode: 'redis' };
    } catch {
      return { status: 'unavailable', mode: 'redis' };
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.client.destroy();
    this.connecting = undefined;
  }

  private createClient(): RedisClient {
    const client = createClient({
      url: this.options.url,
      socket: {
        connectTimeout: this.options.connectTimeoutMs,
        reconnectStrategy: false,
      },
    });
    client.on('error', () => {
      // The resilient wrapper records the degraded state and uses memory.
    });
    return client;
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) {
      throw new Error('Redis adapter is closed');
    }
    if (this.client.isReady) {
      return;
    }
    if (!this.connecting) {
      const client = this.client;
      this.connecting = this.withTimeout(
        client.connect(),
        this.options.connectTimeoutMs,
      )
        .then(() => undefined)
        .finally(() => {
          this.connecting = undefined;
        });
    }
    await this.connecting;
    if (!this.client.isReady) {
      throw new Error('Redis client is not ready');
    }
  }

  private async run<T>(operation: (client: RedisClient) => Promise<T>) {
    try {
      await this.ensureConnected();
      return await this.withTimeout(
        operation(this.client),
        this.options.operationTimeoutMs,
      );
    } catch (error) {
      this.resetClient();
      throw error;
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMilliseconds: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Redis operation timed out'));
      }, timeoutMilliseconds);
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private resetClient(): void {
    if (this.closed) {
      return;
    }
    this.client.destroy();
    this.client = this.createClient();
    this.connecting = undefined;
  }

  private redisKey(key: string): string {
    return `coffee-order:v1:${key}`;
  }

  private assertPositiveSeconds(value: number): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error('Duration must be a positive integer');
    }
  }
}
