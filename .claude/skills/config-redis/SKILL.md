---
name: config-redis
description: 'Inicializar e padronizar a infraestrutura Redis no backend NestJS (workspace resolvido via `backendAppPath` do `skills.config.json`, padrão `apps/api`) com a topologia do PRD do HYPOMNA (§6.2, §7): UMA instância Redis 7+ em `REDIS_URL`, `noeviction` (exigido pelo BullMQ), compartilhada por fila, rate limit e cache de sessão. Gera o cache de sessão cache-aside na frente do Postgres/Better-Auth, o storage Redis do `@nestjs/throttler` para o rate limit do RF-81 (throttlers `default` e `sensitive`, este para `/api/auth/*` e, depois, upload e importação) e a fila assíncrona com `@nestjs/bullmq`/BullMQ (importação, recálculo de status de mesa, exportação, e-mails e webhooks; enfileiramento nunca fail-open). Injeta o serviço `redis` no `docker-compose.yml` do backend (nunca sobrescrito por inteiro — funciona em qualquer ordem com a `config-prisma`) e escreve `REDIS_URL` no `.env`/`.env.example`. Usar quando o pedido envolver setup inicial de Redis, onboarding de novas filas BullMQ ou rebootstrap da infraestrutura de cache/rate-limit/fila no backend.'
---

# Config Redis

## Overview

Setup determinístico da infraestrutura Redis no backend do monorepo (`backendAppPath` em `skills.config.json`, padrão `apps/api`). Redis nunca é fonte de verdade neste produto — Postgres permanece autoritativo; Redis acelera (cache de sessão), protege (rate limit) ou desacopla (fila), nunca substitui.

**Ordem de execução:** `config-redis` e `config-prisma` rodam em qualquer ordem. Nenhuma das duas sobrescreve `docker-compose.yml` por inteiro — cada uma só injeta o seu serviço (`redis` aqui, `postgres` na `config-prisma`). MinIO e Mailpit são acrescentados à mão depois (prompt `01-config-projeto`, passo 4).

**Decisões que esta skill implementa:**

- **Topologia: uma instância** (PRD §6.2 e §7, que listam só `REDIS_URL`). Como `maxmemory-policy` vale para a instância inteira e o BullMQ não pode perder jobs por pressão de memória, a instância é `noeviction` + `appendonly yes`. Consequência: **toda chave de cache precisa de TTL próprio** (o cache de sessão e os contadores do rate limit já nascem com expiração). Os papéis se separam por prefixo de chave (`session:`, `throttle:`, `bull:`).
- **Isolamento de tenant** (PRD §3.2): toda chave de cache com dado de domínio é prefixada pelo `tenantId`; todo job carrega o `tenantId` no payload assinado pelo produtor e restabelece o `TenantContext` antes de acessar dado. A skill não cria chave de domínio nem job — a regra fica nos comentários dos arquivos gerados e vale para as specs que os usarem.
- **Degradação:**
  - Cache de sessão: sempre cai para o Postgres — nunca nega acesso por cache frio ou Redis fora.
  - Rate limit (RF-81): **fail-open** nas rotas comuns e **fail-closed** (`503`) nas sensíveis, para o login nunca ficar sem o bloqueio progressivo contra força bruta. **O PRD não define essa política:** confirmar na spec do RF-81 e levar ao PRD. A distinção é feita por dois throttlers nomeados (`default` e `sensitive`), cada um com `skipIf` por rota.
  - Fila: **nunca fail-open.** `enqueueJob()` converte falha de enfileiramento em `503`, para o webhook do Stripe responder erro e ser reenviado e para uma importação falhar visível em vez de sumir.

## Workflow

1. Confirmar que o backend (`backendAppPath`) contém `package.json`.
2. (Opcional) Rodar `config-prisma` antes ou depois — a ordem não importa.
3. Executar:
   - `node .claude/skills/config-redis/scripts/init-redis-backend.js --dry-run`
   - `node .claude/skills/config-redis/scripts/init-redis-backend.js --apply --install`
4. **Não** criar filas de negócio no bootstrap. Cada fila nasce com a spec que a usa:
   - `node .claude/skills/config-redis/scripts/init-redis-backend.js --apply --queue <nome>` (ex.: `trade-import` na Fase 4, `prop-status-recalculation` na Fase 6, `stripe-webhook` na Fase 7, `data-export` na Fase 8, `transactional-email` na Fase 1).
5. Subir o Redis: `pnpm --filter <workspace-backend> run redis:start`.
6. Na spec do RF-81: aplicar `@UseGuards(ThrottlerGuard)` nos controllers cobertos, acrescentar os prefixos de upload e importação em `SENSITIVE_ROUTE_PREFIXES` e mapear o `429` para o contrato de erro (`code: "RATE_LIMITED"`, `Retry-After`, `message` traduzida).
7. Implementar cada processor gerado em `src/queue/<fila>/<fila>.processor.ts` (placeholder `TODO`, nunca sobrescrito depois de criado).

## O que o script garante

- Dependências no `<backendAppPath>/package.json` (`ioredis`, `@nestjs/throttler`, `@nestjs/bullmq`, `bullmq`), preservando a versão já existente.
- Scripts `redis:start`, `redis:stop` e `redis:logs` via `docker compose`, para o serviço `redis`.
- `REDIS_URL` em `<backendAppPath>/.env` e `.env.example` (não sobrescreve valor existente), junto de `SESSION_CACHE_TTL_SECONDS`, `QUEUE_MAX_ATTEMPTS` e `QUEUE_BACKOFF_DELAY_MS` (extensões operacionais desta skill, fora da lista do PRD §7). `REDIS_QUEUE_URL`/`REDIS_CACHE_URL` de outro projeto são só sinalizadas com `[RISK]`.
- Serviço `redis` (imagem `redis:7-alpine`, `container_name` `<projeto>-redis`, `noeviction` + `appendonly yes`) e volume `redis_data` injetados em `<backendAppPath>/docker-compose.yml`, **sem reescrever o arquivo**: se não existir, cria só com o Redis (com `[RISK]` para rodar a `config-prisma`); se existir sem o serviço, injeta preservando o resto; se já tiver, não altera. Serviços `redis-queue`/`redis-cache` são sinalizados com `[RISK]` e não são tocados.
- `<backendAppPath>/src/lib/redis.ts`: `createCacheRedisClient(keyPrefix)` (sessão e rate limit, `maxRetriesPerRequest: 1` para não prender a requisição) e `createQueueConnectionOptions()` (BullMQ exige `maxRetriesPerRequest: null`/`enableReadyCheck: false`), ambos sobre `REDIS_URL`.
- `<backendAppPath>/src/lib/session-cache/`: `SessionCacheService` (`get`/`set`/`invalidate`, TTL por `SESSION_CACHE_TTL_SECONDS`, nunca lança) e `SessionCacheModule`. `invalidate` é chamado no logout, na troca e redefinição de senha (RF-05, RF-06) e na suspensão do tenant (RF-74).
- `<backendAppPath>/src/lib/rate-limit/`: `RedisThrottlerStorage` (implementa `ThrottlerStorage`; tipo de retorno derivado de `increment()`, porque `ThrottlerStorageRecord` não é reexportado pelo pacote) e `RateLimitModule` (`ThrottlerModule.forRootAsync` com os throttlers `default` — 60/min — e `sensitive` — 10/min —, valores iniciais a calibrar na spec do RF-81).
- `<backendAppPath>/src/queue/queue.module.ts`: `BullModule.forRootAsync` com retry e backoff exponencial — criado **uma única vez**; reexecuções só injetam imports de novas filas.
- `<backendAppPath>/src/queue/enqueue-job.ts`: `enqueueJob(queue, name, data, opts?)`, que converte falha de enfileiramento em `503` (`code: "QUEUE_UNAVAILABLE"`). Tipa o parâmetro como `Queue<T, unknown, string, T, unknown, string>` porque o `NameType` efetivo do `bullmq` é o sexto genérico.
- Por `--queue <nome>`: `src/queue/<nome>/<nome>.module.ts` e `<nome>.processor.ts` (`<Nome>Processor extends WorkerHost`), criados uma única vez, com falha permanente logada como erro (observabilidade, RF-84).
- `SessionCacheModule`, `RateLimitModule` e `QueueModule` injetados em `<backendAppPath>/src/app.module.ts` quando ausentes.

## Notes

- Idempotente. Os arquivos de infraestrutura (`redis.ts`, `session-cache.*`, `rate-limit.*`, `enqueue-job.ts`) são sempre re-renderizados do template: customização de domínio mora em quem os consome. Edição à mão é sobrescrita na próxima execução, com `[RISK]`. **Exceção prevista:** `SENSITIVE_ROUTE_PREFIXES` em `rate-limit.module.ts` vai crescer com as specs de upload e importação — ao reexecutar a skill depois disso, reincorporar os prefixos ou mover a lista para configuração.
- O `skipIf` casa `/api/auth` no início da URL; se a API usar prefixo global (`app.setGlobalPrefix`), ajustar `isSensitiveRoute`.
- Fora do escopo: provedor Redis de produção (PRD, questão 10.7) e as filas de negócio.
- Consultar `references/redis-init-checklist.md`.

## Risk Logging Guardrails

- Registrar fatos de execução em `.log/skills.log` com marcador no início da linha.
- Marcadores mínimos: `[CMD]`, `[FILE_CREATE]`, `[FILE_UPDATE]`, `[FILE_DELETE]`, `[DIR_CREATE]`, `[RISK]`, `[FAIL]`, `[AI]`.
- Sempre registrar `[RISK]` em sobrescrita, exclusão, rename/move ou fallback forçado.
- Toda falha inesperada gera `[FAIL]` com descrição factual curta.
- Operações de terminal e de arquivo passam pelos utilitários de `../utils`.

## Premissa de módulo (ESM)

O código gerado assume a baseline da `config-project` no backend: `"type": "module"` e `module`/`moduleResolution` `nodenext`. Por isso os imports relativos gerados (e os injetados em `app.module.ts`) carregam `.js`.
