# AGENTS.md

## Project overview

Nx monorepo (`@nest-start/source`) with:

- `apps/api` — NestJS v11 + Drizzle ORM + PostgreSQL (`pg`)
- `apps/web` — React (Vite) frontend
- `apps/web-e2e` — Playwright FE↔API integration tests

API demo resource: `User` CRUD under `/api/user`, plus `GET /api` hello-world.

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a multi-context layout with root `CONTEXT-MAP.md` and one `CONTEXT.md` per context. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

- **Install:** `pnpm install`
- **Package manager:** pnpm (`packageManager` pinned in `package.json`). Do not use npm/yarn.
- **Single service DB:** PostgreSQL via `DATABASE_URL`. Migrations auto-run on API boot from `apps/api/drizzle/`; the API health endpoint is `/api/health`.
- **Schema changes:** edit `apps/api/src/db/schema.ts`, then `pnpm nx run api:db-generate`. Commit `apps/api/drizzle/`.
- **Run API:** `pnpm nx serve api` → `http://localhost:3000/api`
- **Run web:** `pnpm nx serve web` → `http://localhost:4200` (Vite proxies `/api` to the API)
- **Unit tests:** `pnpm nx test api`, `pnpm nx test web`
- **API e2e:** `pnpm nx run api:test-e2e`
- **Integration (FE↔API):** `pnpm nx e2e web-e2e` (starts API + web, Playwright chromium)
- **supertest v7** uses default import: `import request from 'supertest'`
