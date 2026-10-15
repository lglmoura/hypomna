---
name: config-prisma
description: 'Inicializar e padronizar a infraestrutura do Prisma no backend NestJS (workspace resolvido via `backendAppPath` do `skills.config.json`, padrão `apps/api`) com schema modular por domínio (`prisma/models/*.model.prisma`), entrypoint de seed técnico em `prisma/seed/main.ts` (sem seeds de módulos), configuração de `prisma.config.ts`, Docker Compose do backend compatível com `DATABASE_URL` do `.env`, e criação/ajuste de `DbModule` + `PrismaService` compatível com `TransactionManager`/`runInTransaction`. Usar quando o pedido envolver setup inicial de Prisma, onboarding de módulos com arquivo Prisma próprio ou rebootstrap da infraestrutura de banco no backend.'
---

# Config Prisma

## Overview

Executar setup determinístico da infraestrutura Prisma no workspace de backend do monorepo (`backendAppPath` em `skills.config.json`, padrão `apps/api` — ver `.claude/skills/.env/skills.config.json` deste repositório), com seed entrypoint neutro (sem tasks de módulo), módulo de banco no Nest e inicialização do Postgres via Docker Compose alinhada ao `.env`.
O contrato gerado de banco deve ficar compatível com a versão atual do projeto: `PrismaService` implementando `TransactionManager` e expondo `runInTransaction` para casos de uso transacionais (ex.: auth).
Todo comando de Prisma/tsx roda via `pnpm exec` (nunca `npx`), mantendo o pnpm como gerenciador único do monorepo.
O `docker-compose.yml` do backend é criado uma única vez; se já existir, a skill nunca o sobrescreve — este projeto espera os dois Redis (`redis-queue` e `redis-cache`, PRD §6) no mesmo arquivo, ao lado do Postgres, então regenerar o arquivo inteiro a cada execução apagaria esse serviço.

## Workflow

1. Confirmar que o workspace de backend (`backendAppPath`, padrão `apps/api`) contém `package.json`. Se o backend estiver em outro caminho, defina `backendAppPath` em `skills.config.json`.
2. Executar o script da skill:
   - `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --dry-run`
   - `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --apply --install`
   - `pnpm --filter <nome-do-workspace-backend> run prisma:generate` (obrigatório antes de qualquer `pnpm run build`)
3. Incluir arquivos Prisma por módulo (repetível):
   - `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --apply --module accounts --module trades`
   - **Não** use `--module auth`: o `auth.model.prisma` (identidade Better-Auth, PRD §5.1) pertence à skill `config-auth`.
4. Subir banco com Docker Compose do backend:
   - `pnpm --filter <nome-do-workspace-backend> run db:start`
5. Validar Prisma:
   - `pnpm --filter <nome-do-workspace-backend> run prisma:generate`
6. Rodar ciclo completo de banco (desenvolvimento local, a partir do diretório do backend):
   - `pnpm exec prisma migrate reset`
   - `pnpm exec prisma migrate dev`
   - `pnpm exec prisma generate`
   - `pnpm exec prisma db seed`

## O que o script garante

`<backendAppPath>` abaixo é resolvido de `skills.config.json` (`backendAppPath`, padrão `apps/api`) — o script encontra o backend por esse valor, não por um caminho fixo.

- Dependências Prisma no `<backendAppPath>/package.json` (`prisma`, `@prisma/client`, `@prisma/adapter-pg`, `tsx`) com preservação da versão já existente quando o backend já está configurado (sem upgrade forçado por padrão).
- Scripts pnpm de banco/Prisma, todos via `pnpm exec` (`db:start`, `db:stop`, `db:logs`, `prisma:generate`, `prisma:migrate:*`, `prisma:seed`, `prisma:studio`).
- Script de desenvolvimento na raiz preparado para subir o banco automaticamente antes do Turbo (`pnpm run dev` -> `db:start` + `turbo run dev`).
- Remoção de script legado `prisma:cid` quando presente.
- `<backendAppPath>/prisma.config.ts` com `seed: 'pnpm exec tsx prisma/seed/main.ts'`.
- `<backendAppPath>/prisma/schema.prisma` com o generator do PRD §5.1: `provider = "prisma-client"` e `output = "../src/generated/prisma"` (Prisma 7 — `output` é obrigatório; a extensão dos imports gerados é inferida do `tsconfig`, `.js` na baseline `nodenext`). O PRD propõe um único `schema.prisma`; esta skill mantém o mesmo conteúdo, dividido por domínio: generator/datasource aqui e os models em `prisma/models/*.model.prisma` (identidade Better-Auth em `auth.model.prisma`). O client gerado é ignorado via `/src/generated` no `.gitignore` do backend (regenerado por `prisma generate`).
- `<backendAppPath>/prisma/seed/main.ts` inicial (sem implementação de módulos) usando o `PrismaClient` gerado (`../../src/generated/prisma/client.js`) com `PrismaPg`. Um seed já evoluído que ainda importe de `@prisma/client` tem só o import trocado (com `[RISK]`), preservando as tasks registradas.
- Autocorreção apenas para templates legados de seed (`generated/client`, `../../generated/prisma/client`, `cid`) sem sobrescrever seeds modernos já estruturados com tasks de módulo.
- Não cria nem altera `prisma/seed/tasks/*` de módulos específicos.
- `<backendAppPath>/prisma/models/bootstrap.model.prisma` temporário apenas quando ainda não existe nenhum `*.model.prisma` de domínio.
- Arquivos de módulos Prisma no padrão `<module-name>.model.prisma`, com um comentário de cabeçalho lembrando que todo modelo de domínio precisa carregar (direta ou indiretamente) o campo que resolve o tenant, por causa do isolamento multi-tenant inegociável do PRD (§1.5/§3.2).
- `<backendAppPath>/docker-compose.yml`, alinhado ao `DATABASE_URL` carregado de `<backendAppPath>/.env` (fallback para `.env.example`) — a skill nunca reescreve o arquivo inteiro (o PRD espera os dois Redis no mesmo arquivo, ao lado do Postgres — ver §6): se o arquivo não existir, cria só com `postgres`; se já existir sem o serviço `postgres` (ex.: a skill `config-redis` rodou primeiro e criou o arquivo só com `redis-queue`/`redis-cache`), injeta o bloco `postgres` (e o volume `postgres_data`) preservando todo o resto do arquivo — funciona em qualquer ordem entre `config-prisma`/`config-redis`; se já tiver `postgres`, não altera nada.
- Criação do pacote `sharedModulePath` (`skills.config.json`, padrão `packages/shared`) quando ainda não existe: pacote interno sem build próprio (`package.json` + `tsconfig.json` estendendo `<namespace>/typescript-config/base.json` + `src/index.ts`) exportando `TransactionManager`/`TransactionContext` — distinto de `packages/contracts` (schemas Zod compartilhados com os clientes, PRD §6.1, esqueleto criado pela skill `config-project`): este pacote é consumido só por `<backendAppPath>`, nunca pelos clientes (`web`, `web-admin`, `web-marketing`). **Não consta na árvore de pacotes do PRD §6.1** — é um acréscimo desta skill para o contrato transacional; registrar o desvio e decidir na spec de arquitetura se fica como pacote ou migra para `apps/api/src/shared` (PRD §6.2). Adicionado como dependência do backend via `workspace:*`.
- Criação/ajuste de `<backendAppPath>/src/db/db.module.ts` e `<backendAppPath>/src/db/prisma.service.ts` (este importa `Prisma`/`PrismaClient` do client gerado em `../generated/prisma/client.js`, não de `@prisma/client`).
- `PrismaService` com contrato transacional atual:
  - implementa `TransactionManager<PrismaTransactionContext>`
  - expõe `runInTransaction`
  - define `PrismaTransactionContext` com `client: Prisma.TransactionClient`.
- Inclusão de `DbModule` em `<backendAppPath>/src/app.module.ts` quando ausente.

## Notes

- O script é idempotente: pode ser executado várias vezes sem duplicar estrutura.
- O script resolve o workspace de backend via `backendAppPath` (`skills.config.json`, padrão `apps/api`) e falha com uma mensagem clara se o `package.json` não existir nesse caminho, orientando a configurar `backendAppPath` quando o backend viver em outro lugar.
- O script instala usando o nome real do workspace lido de `<backendAppPath>/package.json` (fallback: o próprio `backendAppPath`).
- Após criar modelos reais, remover `prisma/models/bootstrap.model.prisma` (se existir) e gerar nova migration.
- Para ambientes locais de desenvolvimento, após ajustes no schema, executar o fluxo completo (a partir do diretório do backend):
  - `pnpm exec prisma migrate reset && pnpm exec prisma migrate dev && pnpm exec prisma generate && pnpm exec prisma db seed`
- Em backends já evoluídos, o script evita regressão de `seed/main.ts` para template neutro quando o arquivo já estiver no padrão moderno com tasks registradas.
- Consultar `references/prisma-init-checklist.md` para checklist operacional.

## Risk Logging Guardrails

- Registrar fatos de execucao em `.log/skills.log` com marcador no inicio da linha.
- Marcadores minimos esperados: `[CMD]`, `[FILE_CREATE]`, `[FILE_UPDATE]`, `[FILE_DELETE]`, `[DIR_CREATE]`, `[RISK]`, `[FAIL]`, `[AI]`.
- Sempre registrar `[RISK]` quando houver sobrescrita, exclusao, rename/move, ou fallback forcado em arquivos/pastas.
- Toda falha inesperada deve gerar `[FAIL]` com descricao factual curta do evento.
- Operacoes de terminal e alteracoes de arquivos devem passar pelos utilitarios compartilhados em `../utils` para manter rastreabilidade consistente.

## Premissa de módulo (ESM)

O código gerado assume a baseline que a `config-project` estabelece no backend:
`"type": "module"` com `module`/`moduleResolution` `nodenext`. Nesse modo o TypeScript exige
extensão explícita em import relativo, então `db.module.ts` e o import de `DbModule` injetado em
`app.module.ts` carregam `.js`. Um backend CommonJS não resolveria esses caminhos.

## Nome do projeto no Docker Compose

O `container_name` do serviço `postgres` deriva do `namespace` do `skills.config.json`
(`@hypomna` → `hypomna-db-postgres`), com fallback para o prefixo `app` quando não há namespace —
não é mais um literal genérico que precise de rename manual depois.
