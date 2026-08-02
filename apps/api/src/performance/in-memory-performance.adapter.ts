import {
  FixedWindowCounter,
  PerformanceHealth,
  PerformanceStorePort,
} from './performance.types';

type MemoryRecord = {
  value: string;
  expiresAt?: number;
};

export type InMemoryPerformanceAdapterOptions = Readonly<{
  now?: () => number;
  available?: boolean;
}>;

export class InMemoryPerformanceAdapter implements PerformanceStorePort {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly now: () => number;
  private available: boolean;

  constructor(options: InMemoryPerformanceAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.available = options.available ?? true;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  async get(key: string): Promise<string | null> {
    this.assertAvailable();
    const record = this.activeRecord(key);
    return record?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.assertAvailable();
    this.records.set(key, {
      value,
      expiresAt: this.now() + this.ttlMilliseconds(ttlSeconds),
    });
  }

  async setIfAbsent(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    this.assertAvailable();
    if (this.activeRecord(key)) {
      return false;
    }
    this.records.set(key, {
      value,
      ...(ttlSeconds === undefined
        ? {}
        : { expiresAt: this.now() + this.ttlMilliseconds(ttlSeconds) }),
    });
    return true;
  }

  async delete(key: string): Promise<void> {
    this.assertAvailable();
    this.records.delete(key);
  }

  async increment(key: string): Promise<number> {
    this.assertAvailable();
    const current = this.activeRecord(key);
    const value = current ? Number(current.value) : 0;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Counter value is not an integer for key ${key}`);
    }
    const next = value + 1;
    this.records.set(key, { value: String(next) });
    return next;
  }

  async incrementFixedWindow(
    key: string,
    windowSeconds: number,
  ): Promise<FixedWindowCounter> {
    this.assertAvailable();
    const windowMilliseconds = this.ttlMilliseconds(windowSeconds);
    const windowStart =
      Math.floor(this.now() / windowMilliseconds) * windowMilliseconds;
    const bucketKey = `${key}:${windowStart}`;
    const current = this.activeRecord(bucketKey);
    const count = current ? Number(current.value) + 1 : 1;
    const resetAt = windowStart + windowMilliseconds;
    this.records.set(bucketKey, {
      value: String(count),
      expiresAt: resetAt,
    });
    return { count, resetAt };
  }

  async health(): Promise<PerformanceHealth> {
    return {
      status: this.available ? 'up' : 'unavailable',
      mode: 'memory',
    };
  }

  async close(): Promise<void> {
    this.records.clear();
  }

  private activeRecord(key: string): MemoryRecord | undefined {
    const record = this.records.get(key);
    if (record?.expiresAt !== undefined && record.expiresAt <= this.now()) {
      this.records.delete(key);
      return undefined;
    }
    return record;
  }

  private ttlMilliseconds(ttlSeconds: number): number {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error('TTL must be a positive integer');
    }
    return ttlSeconds * 1_000;
  }

  private assertAvailable(): void {
    if (!this.available) {
      throw new Error('In-memory performance adapter is unavailable');
    }
  }
}
