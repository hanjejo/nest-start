import { Global, Module } from '@nestjs/common';
import Database from 'better-sqlite3';
import { BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export type DrizzleDB = BetterSQLite3Database<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): DrizzleDB => {
        const sqlite = new Database(process.env.DATABASE_URL ?? 'sqlite.db');
        sqlite.pragma('journal_mode = WAL');
        const db = drizzle(sqlite, { schema });
        migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') });
        return db;
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
