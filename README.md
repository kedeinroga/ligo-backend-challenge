# Ligo Backend Challenge: Wallet Cash-In

Top up a wallet balance through an external payment provider, without ever charging or crediting twice: across client retries, several pods, provider timeouts and duplicated or out of order webhooks.

NestJS service built with **DDD** and **CQRS** (`@nestjs/cqrs`) on **MongoDB**.

## Problem and assumptions

> TODO(reto): statement summary and every assumption made (from docs/plans/PLAN.md).

## Proposed architecture

> TODO(reto): components, aggregates, operation state machine, request flow.

## Idempotency strategy

> TODO(reto)

## Concurrency handling

> TODO(reto)

## Retry strategy

> TODO(reto)

## Webhook handling

> TODO(reto)

## Scenarios covered

> TODO(reto): one row per scenario of the statement (double click, app retry, concurrent pods, provider timeout, duplicated webhook, out of order webhook, webhook before the API response, temporary DB failure, restart mid operation, balance race condition) and the test that proves it.

## Use of AI (what I asked the agent and what I corrected)

> TODO(reto): specs and prompts given to the agent, and what had to be corrected or redesigned. Detailed log in [docs/ai-log.md](docs/ai-log.md).

## How to run

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker Desktop | running | `docker compose` v2.23+ |
| Node.js | 24 | `nvm use` reads `.nvmrc` |
| npm | 11 | ships with Node 24; npm 10 has a resolver bug with this dependency tree |
| jq | any | only for the pretty log view |

First time:

```bash
nvm use
npm install
```

No `.env` is needed: defaults point to the local containers. Copy `.env.example` to `.env` only to override something.

### Option A: everything in Docker (closest to production)

```bash
docker compose up --build            # foreground: logs of every service in this terminal, Ctrl+C stops all
# or
docker compose up -d --build --wait  # background, returns when every service is healthy
npm run logs                         # follow the API logs, human friendly (Ctrl+C stops following only)
```

### Option B: local development with hot reload

```bash
npm run infra:up                     # Mongo in Docker, waits until healthy
npm run start:dev:pretty             # API on the host, restarts on save, readable logs
# npm run start:dev                  # same, raw JSON logs
```

If the API container from option A is still running, port 3000 is taken: `docker compose stop api` first.

### URLs

| What | URL |
|---|---|
| API | http://localhost:3000 |
| Try requests in the browser (Scalar) | http://localhost:3000/reference |
| Swagger UI | http://localhost:3000/docs |
| OpenAPI document (Postman, Insomnia, Bruno) | http://localhost:3000/docs-json |
| Health | http://localhost:3000/health/ready |
| MongoDB (Compass) | `mongodb://localhost:27017/?replicaSet=rs0&directConnection=true` |

### Logs

The API writes one JSON object per line (the format a log collector expects). Locally, `scripts/pretty-logs.sh` renders them in a readable form.

| Want to see | Command |
|---|---|
| API logs, readable (Docker) | `npm run logs` |
| API logs, raw JSON (Docker) | `docker compose logs -f api` |
| One request end to end | send `x-trace-id: my-id` and search `trace=my-id` |
| Everything | `docker compose logs -f` |
| MongoDB (logs to a file) | `docker compose exec mongo tail -f /var/log/mongodb/mongod.log` |

Infrastructure is quiet on stdout on purpose (warnings and errors only); health probes are not logged.

### Tests

```bash
npm test            # unit tests. No infrastructure needed
npm run test:e2e    # e2e against real Mongo (npm run infra:up first)
npm run check       # lint (layer rules) + typecheck + unit tests + build: same gate as CI
.github/scripts/security-gate.sh   # secrets, dependency CVEs, SAST (needs gitleaks, osv-scanner, semgrep)
```

### Stop and reset

```bash
docker compose down        # stop everything, keep data
docker compose down -v     # stop and delete data
```

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop is not running: open it and retry |
| `ECONNREFUSED 127.0.0.1:27017` on `start:dev` | Infrastructure not up: `npm run infra:up` (the API fails fast after 5 s) |
| `EADDRINUSE :3000` | The API container is running: `docker compose stop api` |
| `Cannot read properties of null (reading 'edgesOut')` on install | npm 10: `nvm use` (Node 24 ships npm 11) |

## API examples

> TODO(reto): curl for each endpoint and scenario.

## Code organization

Organized by bounded context, with Clean Architecture dependency rules enforced by the linter. The engineering rules given to the AI agent are in [CLAUDE.md](CLAUDE.md).

```
src/
  modules/<context>/
    domain/          aggregates, value objects, exceptions, repository ports (framework free)
    application/     commands/ (one handler each), ports
    infrastructure/  Mongo repositories, mappers, adapters, in-memory doubles
    api/             controllers (CommandBus only), request/response DTOs, mappers
  shared/            same layering: kernel (Money, exceptions), ports, adapters (Mongo, logging),
                     HTTP pieces (filter, middleware, decorators)
  config/            validated environment + typed AppConfigService
  modules/health/    readiness as a query over DependencyHealthCheck ports
test/                e2e tests (against docker compose)
k8s/                 Deployment, Service, ConfigMap, Secret example
```

| Layer | May import | Must never import (fails `npm run lint`) |
|---|---|---|
| `domain/` | `shared/domain` | `@nestjs/*`, drivers, validation libs, other layers |
| `application/` | `domain/`, ports, `@nestjs/cqrs` | other `@nestjs/*`, drivers, `express`, `infrastructure/`, `api/` |
| `api/` | `application/`, `shared/api` | drivers, `infrastructure/` |

Business rules live in aggregates; handlers only orchestrate. Ports are `abstract class`es: they survive compilation, so they double as the Nest DI token and consumers inject them by type.

### Money

`Money` stores integer minor units in a `bigint` with an explicit currency (`PEN`, `USD`). Floating point is never used for arithmetic. Operations between different currencies throw.

### Errors

Every error is a `DomainException` subclass with a stable kebab-case `staticCode`. Subclasses inherit the HTTP status of their closest base class, and a single `GenericExceptionFilter` renders every error (domain, validation, framework, unknown) with the same shape:

```json
{
  "statusCode": 400,
  "code": "data-input-exception",
  "errorMessage": "Bad Request",
  "errorMessageDescription": "...",
  "path": "/cash-in",
  "timestamp": "2026-10-06T03:50:55.871Z",
  "traceId": "c6d92a80-..."
}
```

| Base exception | HTTP |
|---|---|
| `DataInputException` (validation included) | 400 |
| `AuthenticationException` | 401 |
| `DataNotFoundException` | 404 |
| `DataConflictException`, `ConcurrencyException` | 409 |
| `BusinessRuleViolationException` | 422 |
| `ServiceException` | 503 |
| `DataSourceException`, `DefaultException`, unknown errors | 500 |

4xx responses expose the exception message (actionable for the client); 5xx responses only carry a generic description, with details in the logs. Each endpoint documents its possible errors in Swagger with `@ApiDomainErrors(...)`, generated from the same mapping.

### Security

- `class-validator` DTOs with `whitelist` and `forbidNonWhitelisted`: unknown fields are rejected.
- Environment validated at boot; the app refuses to start with an invalid config.
- Non root container, read only root filesystem and dropped capabilities in Kubernetes.
- CI security job: gitleaks over the whole history, osv-scanner on `package-lock.json` (blocks on CVSS >= 9) and Semgrep SAST (blocks on ERROR). Also runs weekly so new advisories surface without a commit.

### Observability

- Structured JSON logs through a `LogsService` port, with request start/finish and duration. Nest's internal logs are routed through the same port, so every line shares one schema. Probe endpoints are not logged.
- `x-trace-id` is accepted from the gateway or generated per request, returned in the response, and propagated to commands and every log line.
- Error logs include the full `cause` chain down to the driver error.
- Every response is `Cache-Control: no-store` with ETags disabled: balances and payment states are never served from a cache.
- Fail fast on outages: Mongo server selection times out at 5 s (instead of the driver's 30 s) and each readiness check has an 800 ms budget.
- `/health/live` (process) and `/health/ready` (Mongo; `503` with the failing dependency when down) for Kubernetes probes, not rate limited.
- API docs (Scalar at `/reference`, Swagger UI at `/docs`, OpenAPI at `/docs-json`) are disabled in production unless `SWAGGER_ENABLED=true`.

## Decisions and trade-offs

- **Rate limit counters in memory.** Per pod; with several replicas the limit multiplies. A shared storage (Redis) fixes it.
- TODO(reto): decisions specific to the statement (versioned documents instead of event sourcing, no Redis, no broker).

## What I would do with more time

> TODO(reto)

## Contributing

- Conventional Commits enforced by commitlint (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `ci`, `style`, `revert`; lowercase subject, no trailing period, 100 chars max).
- Git hooks (husky): `pre-commit` runs a gitleaks scan of staged changes and the linter; `pre-push` runs `npm run check`.
