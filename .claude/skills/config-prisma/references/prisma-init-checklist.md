# Prisma Init Checklist (Backend)

## Objetivo

Padronizar bootstrap do Prisma no backend NestJS com:

- schema modular em `<backendAppPath>/prisma/models/*.model.prisma`, com `schema.prisma` (generator `prisma-client`, `output = "../src/generated/prisma"`, PRD §5.1) como raiz
- entrypoint de seed técnico em `<backendAppPath>/prisma/seed/main.ts` (sem seeds de módulos)
- módulo Nest de banco em `<backendAppPath>/src/db/*` com `PrismaService` compatível com `TransactionManager`/`runInTransaction`, cuja interface vive no pacote `sharedModulePath` (`skills.config.json`, padrão `packages/shared`) — criado por esta skill quando ainda não existe, distinto de `packages/contracts` (schemas Zod compartilhados com os clientes, PRD §6.1)
- Docker Compose do backend compatível com `DATABASE_URL`, nunca reescrito por inteiro (este projeto espera os dois Redis — `redis-queue` e `redis-cache` — no mesmo arquivo, ao lado do Postgres, PRD §6) — se o arquivo já existir sem `postgres` (ex.: a skill `config-redis` rodou primeiro), o serviço é injetado preservando o resto, funcionando em qualquer ordem entre as duas skills

`<backendAppPath>` vem de `skills.config.json` (padrão `apps/api` neste repositório — ver `.claude/skills/.env/skills.config.json`).

## Pré-requisitos

- Workspace com `<backendAppPath>/package.json` (o script falha com uma mensagem clara, apontando para `backendAppPath` em `skills.config.json`, se não encontrar)
- `DATABASE_URL` definido em `<backendAppPath>/.env` (ou em `.env.example`)
- Node.js/pnpm instalados
- Docker/Docker Compose instalados

## Passo a passo

1. Rodar simulação.
2. Aplicar bootstrap.
3. Instalar dependências.
4. Subir Postgres com Docker Compose.
5. Gerar client Prisma.

```bash
node .claude/skills/config-prisma/scripts/init-prisma-backend.js --dry-run
node .claude/skills/config-prisma/scripts/init-prisma-backend.js --apply --install
pnpm --filter <nome-do-workspace-backend> run db:start
pnpm --filter <nome-do-workspace-backend> run prisma:generate
```

## Escaffold de módulos Prisma

Não escaffolde o módulo `auth` aqui: o `auth.model.prisma` (identidade Better-Auth, PRD §5.1) pertence à skill `config-auth`.

```bash
node .claude/skills/config-prisma/scripts/init-prisma-backend.js --apply --module accounts --module trades
```

## Arquivos críticos

- `<backendAppPath>/package.json`
- `<backendAppPath>/.env`
- `<backendAppPath>/.env.example`
- `<backendAppPath>/docker-compose.yml`
- `<backendAppPath>/prisma.config.ts`
- `<backendAppPath>/prisma/schema.prisma`
- `<backendAppPath>/prisma/seed/main.ts`
- `<backendAppPath>/src/db/db.module.ts`
- `<backendAppPath>/src/db/prisma.service.ts`
- `<backendAppPath>/src/app.module.ts`
- `<sharedModulePath>/package.json`, `<sharedModulePath>/tsconfig.json`, `<sharedModulePath>/src/index.ts` (padrão `packages/shared`)

## Regra de escopo desta skill

- Não incluir seeds de dados por módulo (`prisma/seed/tasks/*`) nesta etapa.
- O bootstrap de seed deve permanecer neutro até os módulos específicos serem aplicados.
- `prisma/models/bootstrap.model.prisma` deve existir apenas quando ainda não há arquivos `*.model.prisma` de domínio.
- Não sobrescrever `prisma/seed/main.ts` já moderno (com `@prisma/client`/`PrismaPg` e tasks de módulo); somente corrigir templates legados.
- Não sobrescrever `docker-compose.yml` por inteiro — apenas injeta o serviço `postgres` (e o volume `postgres_data`) se ainda não existirem; o arquivo pode acumular outros serviços (ex.: `redis-queue`/`redis-cache`, PRD §6) adicionados pela `config-redis`, em qualquer ordem de execução entre as duas skills.
- Todo comando de Prisma/tsx gerado usa `pnpm exec`, nunca `npx`.

## Flags

- `--apply`: aplica alterações em disco
- `--dry-run`: simula alterações
- `--install`: roda `pnpm --filter <workspace-backend> install` usando o nome em `<backendAppPath>/package.json` (fallback: o próprio `backendAppPath`) — nunca `pnpm install --workspace <nome>`, que não escopa nada (pnpm trata `install <nome>` como alias de `add <nome>`) e acabaria adicionando o backend como dependência do `package.json` da raiz
- `--start-db`: roda `docker compose up -d postgres` no `<backendAppPath>`
- `--module <nome>`: cria arquivo Prisma por módulo
- `--prisma-version <semver>`: força versão de Prisma; sem esta flag, a skill preserva versão Prisma já existente no backend (fallback `7.4.2`)

## Pós-bootstrap

- Adicionar modelos reais em `prisma/models/*.model.prisma`, lembrando do campo de isolamento de tenant em cada modelo de domínio (PRD §1.5/§3.2)
- Gerar o client (`prisma:generate`) e as migrações (`prisma migrate dev`); `src/generated/` não é versionado, então `prisma:generate` precisa rodar em CI antes de `check-types`/`build`
- Implementar seeds por módulo e registrá-las em `prisma/seed/main.ts`
- Atualizar adapters `*.prisma.ts` para mapear domínio/DTO
- Remover `prisma/models/bootstrap.model.prisma` após entrada dos modelos reais e gerar migration de substituição
- Em rebootstrap de projetos antigos, o script corrige automaticamente `prisma/seed/main.ts` legado quando detecta imports de `generated/client`, `generated/prisma` ou `cid`.
