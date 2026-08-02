import { Inject, Injectable } from '@nestjs/common';
import { PERFORMANCE_CONFIG, PERFORMANCE_STORE } from './performance.constants';
import { PerformanceConfig } from './performance.config';
import {
  CatalogBrowseProjection,
  CatalogCachePort,
  PerformanceStorePort,
} from './performance.types';

export function catalogCacheKey(
  storeId: string,
  catalogVersion: string,
  generation = 0,
): string {
  return [
    'catalog',
    'browse',
    encodeURIComponent(storeId),
    encodeURIComponent(catalogVersion),
    String(generation),
  ].join(':');
}

export function catalogVersion(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toISOString();
  }
  return String(value);
}

@Injectable()
export class CatalogCacheAdapter implements CatalogCachePort {
  private readonly generations = new Map<string, number>();
  private readonly activeKeys = new Map<string, string>();

  constructor(
    @Inject(PERFORMANCE_STORE)
    private readonly store: PerformanceStorePort,
    @Inject(PERFORMANCE_CONFIG)
    private readonly config: PerformanceConfig,
  ) {}

  async get(
    storeId: string,
    catalogVersionValue: string,
  ): Promise<CatalogBrowseProjection | null> {
    const key = this.key(storeId, catalogVersionValue);
    try {
      const serialized = await this.store.get(key);
      if (serialized === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(serialized);
      if (!this.isProjection(parsed, storeId)) {
        return null;
      }
      this.activeKeys.set(storeId, key);
      return parsed;
    } catch {
      return null;
    }
  }

  async set(
    storeId: string,
    catalogVersionValue: string,
    projection: CatalogBrowseProjection,
  ): Promise<void> {
    if (projection.storeId !== storeId) {
      return;
    }
    const key = this.key(storeId, catalogVersionValue);
    try {
      await this.store.set(
        key,
        JSON.stringify(projection),
        this.config.catalogCacheTtlSeconds,
      );
      this.activeKeys.set(storeId, key);
    } catch {
      // A cache write must never make an authoritative read fail.
    }
  }

  async invalidate(storeId: string): Promise<void> {
    const currentGeneration = this.generations.get(storeId) ?? 0;
    this.generations.set(storeId, currentGeneration + 1);
    const activeKey = this.activeKeys.get(storeId);
    this.activeKeys.delete(storeId);
    if (!activeKey) {
      return;
    }
    try {
      await this.store.delete(activeKey);
    } catch {
      // The catalog version/fingerprint still makes old entries unreachable.
    }
  }

  private key(storeId: string, catalogVersionValue: string): string {
    return catalogCacheKey(
      storeId,
      catalogVersionValue,
      this.generations.get(storeId) ?? 0,
    );
  }

  private isProjection(
    value: unknown,
    storeId: string,
  ): value is CatalogBrowseProjection {
    return (
      typeof value === 'object' &&
      value !== null &&
      'storeId' in value &&
      value.storeId === storeId &&
      'products' in value &&
      Array.isArray(value.products)
    );
  }
}
