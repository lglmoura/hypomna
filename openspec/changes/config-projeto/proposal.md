## Why

O repositório do HYPOMNA hoje só tem PRD, regras e skills: não existe nenhum app, pacote ou infraestrutura local, e nenhuma spec de RF pode começar sem essa base. Esta change entrega a parte de infraestrutura da **Fase 0 — Fundação do monorepo** (PRD §12), na topologia do PRD §1.4/§6.1, usando as skills `config-project`, `config-prisma`, `config-redis` e `config-auth` já adaptadas ao projeto (origem: prompt `.docs/prompts/monorepo/01-config-projeto.md`).

## What Changes

- **Monorepo base** (`config-project`): pnpm + Turborepo com namespace `@hypomna`; `apps/api` (NestJS), `apps/web` (Trader), `apps/web-admin` (Admin e Suporte), `apps/web-marketing` (Visitante, estático); esqueletos de `packages/domain`, `contracts`, `api-client`, `i18n`, `ui`, `test-utils`, ao lado de `eslint-config` e `typescript-config`; Husky (pre-commit com lint-staged + ESLint + Prettier; pre-push com `check-types` e testes unitários); Vitest + `@amiceli/vitest-cucumber`; `pnpm test:trace` (RF-86); `engines.node >=24` e `engine-strict=true`.
- **Variáveis de ambiente**: schema Zod de env em `apps/api` com as variáveis do PRD §7 usadas pelo bootstrap (obrigatórias falham o boot; Stripe e OpenTelemetry opcionais até as fases que as consomem) e schema de env nos apps Next.
- **Prisma** (`config-prisma`): schema modular `prisma/models/*.model.prisma`, `prisma.config.ts`, `DbModule` + `PrismaService` com `TransactionManager`/`runInTransaction`, seed técnico neutro e serviço `postgres` (16+) no `docker-compose.yml`.
- **Redis** (`config-redis`): uma instância Redis 7+ em `REDIS_URL` com `noeviction`, `SessionCacheService`, storage do throttler (`default` e `sensitive`) e infraestrutura BullMQ sem filas de negócio.
- **MinIO e Mailpit** (à mão, sem skill): serviços no mesmo `docker-compose.yml`, bucket criado por serviço de init e variáveis `S3_*`, `SMTP_URL`, `EMAIL_FROM`.
- **Fundação de autenticação** (`config-auth`): Better-Auth em `/api/auth/*`, login só por e-mail e senha, `SessionGuard` (`401 UNAUTHORIZED`) e `@CurrentSession()`, cache-aside de sessão, `platformRole` com `input: false`, auth-client por cookie em `apps/web` e `apps/web-admin` (nada em `apps/web-marketing`), e a primeira migration (`auth-init`).
- **Pendências registradas como tasks**: desvio de nome `packages/tsconfig` × `typescript-config`; `packages/shared` fora do PRD §6.1; `RF-00-schema` (RLS e role de aplicação); política de degradação do rate limit; `FileStorage`; RF-01, `TenantGuard`, `AdminGuard`, RF-02/RF-05/RF-06, TOTP do RF-07, RF-81; ADR de isolamento de sessão (CA-RF03-2); `BETTER_AUTH_SECRET` real e validação manual do login nos dois apps.

Nenhum comportamento de RF com cenário `CA-*` é implementado aqui: tudo isso fica para as specs de feature aprovadas. Não há mudança **BREAKING** (não existe código anterior).

## Capabilities

### New Capabilities

- `platform/monorepo-foundation`: estrutura do monorepo (apps, pacotes, runtime Node, hooks de git, ferramental de testes, `test:trace`, `check-types`).
- `platform/environment-config`: validação das variáveis de ambiente por schema Zod no boot de cada app, com segredo nunca versionado.
- `platform/local-infrastructure`: `docker compose` local com PostgreSQL, Redis, MinIO e Mailpit, nomes derivados do namespace e bucket criado por init.
- `platform/backend-infrastructure`: infraestrutura de banco (Prisma) e de Redis (cache de sessão, rate limit e fila) dentro de `apps/api`, sem regra de negócio.
- `identity/auth-foundation`: fundação do Better-Auth na API e nos clientes web por cookie, sem os RFs de identidade da Fase 1.

### Modified Capabilities

(nenhuma — `openspec/specs/` ainda não tem capability de comportamento)

## Impact

- **Código novo**: `apps/*`, `packages/*`, `package.json`/`pnpm-workspace.yaml`/`turbo.json` da raiz, `.husky/`, `.npmrc`, `apps/api/prisma/**`, `apps/api/src/lib/**`, `apps/api/docker-compose.yml`, `.env.example` dos apps.
- **Dependências**: NestJS, Next.js, Prisma (+ `@prisma/adapter-pg`), `ioredis`/BullMQ/`@nestjs/throttler`, Better-Auth, Zod v4 + `nestjs-zod`, Vitest, `@amiceli/vitest-cucumber`, Husky, lint-staged, ESLint (`simple-import-sort`, `eslint-plugin-boundaries`), Prettier — sempre na versão atual.
- **Sistemas**: Docker local (Postgres, Redis, MinIO, Mailpit); primeiro banco e primeira migration local.
- **Documentação**: §11 do PRD e índice de `.docs/prompts/monorepo/README.md`; pendência de atualização do PRD §6.1 (nome do pacote de tsconfig e `packages/shared`).
