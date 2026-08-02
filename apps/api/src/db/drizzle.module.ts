import {
  Global,
  Inject,
  Injectable,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'fs';
import { PinoLogger } from 'nestjs-pino';
import { join } from 'path';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema';
import { MetricsService } from '../observability/metrics.service';
import { safeFailureReason } from '../messaging/failure';

export const DATABASE_POOL = Symbol('DATABASE_POOL');
export const DRIZZLE = Symbol('DRIZZLE');
export type DrizzleDB = NodePgDatabase<typeof schema>;

const defaultConnectionTimeoutMillis = 5_000;
const defaultIdleTimeoutMillis = 30_000;
const defaultPoolSize = 10;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createPool(): Pool {
  const config: PoolConfig = {
    connectionTimeoutMillis: positiveInteger(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      defaultConnectionTimeoutMillis,
    ),
    idleTimeoutMillis: positiveInteger(
      process.env.DATABASE_IDLE_TIMEOUT_MS,
      defaultIdleTimeoutMillis,
    ),
    max: positiveInteger(process.env.DATABASE_POOL_MAX, defaultPoolSize),
  };

  if (process.env.DATABASE_URL) {
    config.connectionString = process.env.DATABASE_URL;
  }

  return new Pool(config);
}

export function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, 'drizzle'),
    join(__dirname, '..', 'drizzle'),
    join(process.cwd(), 'apps/api/drizzle'),
    join(process.cwd(), 'drizzle'),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? candidates[2];
}

function instrumentDatabase(
  database: DrizzleDB,
  metrics: MetricsService,
): DrizzleDB {
  return new Proxy(database, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== 'transaction' || typeof value !== 'function') {
        return value;
      }

      return (...args: unknown[]) =>
        Promise.resolve(Reflect.apply(value, target, args)).catch((error) => {
          metrics.recordPostgresqlTransactionFailure();
          throw error;
        });
    },
  });
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private migrationsApplied = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly logger: PinoLogger,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.metrics?.setPostgresqlMigration('pending');
    try {
      await migrate(this.db, { migrationsFolder: resolveMigrationsFolder() });
      this.migrationsApplied = true;
      this.metrics?.setPostgresqlMigration('applied');
    } catch (error) {
      this.logger.error(
        {
          reason: safeFailureReason(error),
        },
        'PostgreSQL migration failed during startup',
      );
      this.metrics?.setPostgresqlMigration('failed');
      this.metrics?.setPostgresqlHealth('down');
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.migrationsApplied) {
      this.metrics?.setPostgresqlHealth('down');
      return false;
    }

    try {
      await this.pool.query('SELECT 1');
      this.metrics?.setPostgresqlHealth('up');
      this.metrics?.setPostgresqlPool(this.pool);
      return true;
    } catch {
      this.metrics?.setPostgresqlHealth('down');
      this.metrics?.setPostgresqlPool(this.pool);
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: (): Pool => {
        return createPool();
      },
    },
    {
      provide: DRIZZLE,
      useFactory: (pool: Pool, metrics: MetricsService): DrizzleDB =>
        instrumentDatabase(drizzle(pool, { schema }), metrics),
      inject: [DATABASE_POOL, MetricsService],
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DRIZZLE, DatabaseService],
})
export class DrizzleModule {}
