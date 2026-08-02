# NestStart

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/nest?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Run tasks

To run the dev server for your app, use:

```sh
pnpm nx serve api
```

To create a production bundle:

```sh
pnpm nx build api
```

The API uses PostgreSQL as its transactional database. Set `DATABASE_URL` to a
local or managed PostgreSQL connection string before starting the API; committed
migrations run automatically during startup. The health endpoint is available
at `/api/health` and returns a non-200 response when PostgreSQL is unavailable.

## Integration events

Ordering writes `OrderPlaced` and `OrderCancelled` Integration Events to the
PostgreSQL Outbox in the same transaction as the Order change. The Outbox is
the canonical record; a dispatcher publishes immutable, versioned envelopes to
RabbitMQ and consumers use PostgreSQL Inbox records for idempotency.

Set `RABBITMQ_URL` to enable the RabbitMQ adapter. When it is unset, the API
uses an in-memory transport so local API tests and development do not require a
broker. RabbitMQ declares the durable `integration.events` topic exchange,
context queues, TTL retry queues, and context Dead Letter Queues when a
consumer starts.

## Redis performance layer

Set `REDIS_URL` to enable the optional Redis adapter. When it is unset, or when
Redis is unavailable, the API uses an explicit in-memory fallback and
PostgreSQL remains authoritative. Redis is used only for the Catalog browse
projection and short-lived fixed-window rate-limit counters; it never stores
orders, payments, authentication sessions, or Inbox state. Cache reads still
load the Store row from PostgreSQL, and entries are keyed by Store ID plus the
Store `updatedAt` catalog fingerprint. Catalog mutations advance that
fingerprint in the same PostgreSQL transaction, making older entries
unreachable.

The defaults are `CATALOG_CACHE_TTL_SECONDS=30`,
`RATE_LIMIT_WINDOW_SECONDS=60`, and `RATE_LIMIT_LIMIT=100`. Redis connection
and failure handling can be tuned with `REDIS_CONNECT_TIMEOUT_MS=250`,
`REDIS_OPERATION_TIMEOUT_MS=500`, and
`REDIS_RETRY_COOLDOWN_MS=5000`. Cache and rate-limit failures fail open:
Catalog reads query PostgreSQL and rate-limited requests continue when the
non-authoritative performance layer is unavailable. `/api/health` reports
`redis.status` as `up`, `unavailable`, or `disabled`; Redis degradation does
not make a healthy PostgreSQL database unhealthy.

## Store-scoped RBAC

The committed PostgreSQL migrations seed the v1 roles and permissions. Register
an account, then configure a one-shot `RBAC_BOOTSTRAP_TOKEN` and call
`POST /api/rbac/bootstrap` with that account's `userId` and the token in the
`x-rbac-bootstrap-token` header. The bootstrap endpoint refuses to run without
the configured token and refuses to run after a platform administrator exists.
In production, set `RBAC_BOOTSTRAP_ENABLED=true` explicitly for the initial
bootstrap and remove or rotate the bootstrap secret afterward.

RBAC catalog and assignment writes require platform-admin permissions. Store
operator and store-admin assignments require a `storeId`; the protected
`GET /api/stores/:storeId/workspace` capability verifies that scope on every
request. Access-token claims contain no roles or permissions.

To see all available targets to run for a project, run:

```sh
pnpm nx show project api
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

Use the plugin's generator to create new projects.

To generate a new application, use:

```sh
npx nx g @nx/nest:app demo
```

To generate a new library, use:

```sh
npx nx g @nx/node:lib mylib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/nest?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
