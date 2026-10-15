# Redis Init Checklist (Backend)

## Objetivo

Padronizar o bootstrap do Redis no backend NestJS do HYPOMNA (PRD §6.2, §7), com uma instância em `REDIS_URL`:

- cache de sessão cache-aside na frente do Postgres/Better-Auth, em `<backendAppPath>/src/lib/session-cache/`
- storage distribuído do rate limit (RF-81), em `<backendAppPath>/src/lib/rate-limit/`
- fila assíncrona BullMQ (importação, recálculo de status de mesa, exportação, e-mails, webhooks), em `<backendAppPath>/src/queue/`
- serviço `redis` no `docker-compose.yml` do backend ao lado do `postgres`, sem nunca sobrescrever o arquivo

`<backendAppPath>` vem de `skills.config.json` (padrão `apps/api`).

## Pré-requisitos

- `<backendAppPath>/package.json` existente (o script falha com mensagem clara se não encontrar)
- Nenhuma dependência de ordem com `config-prisma`
- Node.js/pnpm e Docker/Docker Compose instalados

## Passo a passo

```bash
node .claude/skills/config-redis/scripts/init-redis-backend.js --dry-run
node .claude/skills/config-redis/scripts/init-redis-backend.js --apply --install
pnpm --filter <nome-do-workspace-backend> run redis:start
```

## Filas BullMQ (com a spec que as usa, nunca no bootstrap)

```bash
node .claude/skills/config-redis/scripts/init-redis-backend.js --apply --queue <nome>
```

Cada `--queue <nome>` gera:

- `<backendAppPath>/src/queue/<nome>/<nome>.module.ts` — `BullModule.registerQueue({ name: '<nome>' })`
- `<backendAppPath>/src/queue/<nome>/<nome>.processor.ts` — `<Nome>Processor extends WorkerHost` com `TODO`
- injeção de `<Nome>QueueModule` no `imports` de `<backendAppPath>/src/queue/queue.module.ts`

Todo processor restabelece o `TenantContext` a partir do `tenantId` do payload antes de acessar dado (PRD §3.2), e a spec da fila tem teste de isolamento próprio (`.claude/rules/testing.md`).

## Arquivos críticos

- `<backendAppPath>/package.json`, `.env`, `.env.example`, `docker-compose.yml`
- `<backendAppPath>/src/lib/redis.ts`
- `<backendAppPath>/src/lib/session-cache/session-cache.service.ts` e `session-cache.module.ts`
- `<backendAppPath>/src/lib/rate-limit/redis-throttler.storage.ts` e `rate-limit.module.ts`
- `<backendAppPath>/src/queue/queue.module.ts` e `enqueue-job.ts`
- `<backendAppPath>/src/app.module.ts`

## Decisões de arquitetura

- **Uma instância** (`REDIS_URL`, `noeviction`, `appendonly yes`), porque o BullMQ divide a instância com cache e rate limit. Toda chave de cache tem TTL; os papéis se separam por prefixo (`session:`, `throttle:`, `bull:`); dado de domínio no cache é prefixado por `tenantId`.
- **Degradação:**
  - cache de sessão cai para o Postgres;
  - rate limit é fail-open nas rotas comuns e fail-closed (`503`) nas sensíveis — **a confirmar na spec do RF-81**, porque o PRD não define;
  - enfileiramento nunca é fail-open: `enqueueJob()` lança `503`.

## Regra de escopo

- Não aplica `@UseGuards(ThrottlerGuard)`/`@Throttle(...)` em nenhum controller nem mapeia o `429` para `RATE_LIMITED` — isso é da spec do RF-81.
- Não escreve lógica de negócio nos processors (`TODO` apenas).
- Não escolhe o provedor Redis de produção (PRD, questão 10.7).
- Não sobrescreve `docker-compose.yml` — só injeta `redis` (e `redis_data`) se ausentes.
- `queue.module.ts` e `src/queue/<nome>/*` são criados uma única vez.

## Flags

- `--apply`: aplica as alterações
- `--dry-run`: simula (padrão sem `--apply`)
- `--install`: `pnpm --filter <workspace-backend> install` (nunca `pnpm install --workspace <nome>`, que adicionaria o backend como dependência da raiz)
- `--start-redis`: `docker compose up -d redis` no `<backendAppPath>`
- `--queue <nome>`: módulo + processor de uma fila (repetível)

## Pós-bootstrap

- Spec do RF-81: guards, prefixos sensíveis de upload e importação, contrato `429 RATE_LIMITED` com `Retry-After`, limites calibrados e a política de degradação confirmada.
- `SessionCacheService` no guard de sessão do Better-Auth (cache-aside), com `invalidate` no logout, na troca e redefinição de senha e na suspensão do tenant.
- `enqueueJob()` nos produtores (webhook do Stripe, importação, exportação, e-mails), em vez de `queue.add()` direto.
- Em produção: apontar `REDIS_URL` para o Redis gerenciado escolhido, com `noeviction`.
