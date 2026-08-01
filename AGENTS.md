# AGENTS.md

## Project overview

NestJS v11 backend (single service). ORM is **Drizzle** on a local **SQLite** file
via `better-sqlite3`. There is one demo resource: `User` (`/user` CRUD) plus a
`GET /` hello-world route.

Standard scripts live in `package.json` (`start`, `start:dev`, `build`, `lint`,
`test`, `test:e2e`). Standard usage is documented in `README.md`.

## Cursor Cloud specific instructions

- **Single service, no external DB.** The database is a local SQLite file
  (`sqlite.db` by default, override with `DATABASE_URL`). Nothing else needs to be
  running. The file plus its `-wal`/`-shm` siblings are gitignored.
- **Migrations auto-run on boot.** `DrizzleModule` (`src/db/drizzle.module.ts`)
  runs the Drizzle migrator against the committed `drizzle/` folder inside its
  provider factory, so `npm run start:dev` / tests create the `users` table
  automatically. You do NOT need to run migrations manually before starting.
- **Changing the schema:** edit `src/db/schema.ts`, then run `npm run db:generate`
  to emit a new SQL migration under `drizzle/`. Commit that folder — boot-time
  migration relies on it. `npm run db:push` is available for quick throwaway sync.
- **npm needs `--legacy-peer-deps`.** Some Nest ecosystem peer ranges do not
  resolve cleanly on a plain `npm install`; always install with
  `npm install --legacy-peer-deps`.
- **Run the app:** `npm run start:dev` (watch mode) serves on
  `http://localhost:3000`. Quick smoke test:
  `curl -X POST localhost:3000/user -H 'Content-Type: application/json' -d '{"name":"a","email":"a@b.c"}'`
  then `curl localhost:3000/user`.
- **supertest v7** requires a default import (`import request from 'supertest'`),
  not `import * as request`.
