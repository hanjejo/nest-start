import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'fs';
import { join } from 'path';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema';

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

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private migrationsApplied = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await migrate(this.db, { migrationsFolder: resolveMigrationsFolder() });
      this.migrationsApplied = true;
    } catch {
      this.logger.error('PostgreSQL migration failed during startup');
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.migrationsApplied) {
      return false;
    }

    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
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
      useFactory: (pool: Pool): DrizzleDB => drizzle(pool, { schema }),
      inject: [DATABASE_POOL],
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DRIZZLE, DatabaseService],
})
export class DrizzleModule {}
