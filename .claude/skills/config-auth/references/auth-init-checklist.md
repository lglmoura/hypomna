# Auth Init Checklist (Backend + Clientes)

## Objetivo

Escaffoldar a fundação de autenticação do HYPOMNA com o Better-Auth (PRD §1.4, §4.1, §6.2), cobrindo:

- schema Prisma de identidade do PRD §5 em `<backendAppPath>/prisma/models/auth.model.prisma`
- `<backendAppPath>/src/lib/auth.ts` (e-mail e senha, `platformRole` com `input: false`, invalidação do cache de sessão no logout)
- `<backendAppPath>/src/auth/*` (controller, guard, decorator, module)
- CORS com credenciais para os clientes web
- auth-clients de `web` e `web-admin` (cookie), sem middleware (`.claude/rules/auth-client.md`)

Esta skill **não** cobre o comportamento dos RFs de identidade — RF-01, RF-02, RF-05, RF-06, RF-07 e RF-81 entram pelas specs de `.docs/specs/identity/`, com as skills genéricas (`emailAndPassword`, `twoFactor`, `security`, `best-practices`).

## Pré-requisitos

- `config-project` executada
- `config-prisma` executada (schema modular, `PrismaService`, client em `src/generated/prisma`)
- `config-redis` executada (`SessionCacheService`, `createCacheRedisClient`)
- Node.js/pnpm instalados

## Passo a passo

```bash
node .claude/skills/config-auth/scripts/init-auth.js --dry-run
node .claude/skills/config-auth/scripts/init-auth.js --apply --install
```

Depois:

1. Gerar o `BETTER_AUTH_SECRET` real no `.env` do backend (manual, nunca commitar).
2. Conferir `auth.model.prisma` contra a versão instalada (`pnpm exec @better-auth/cli generate`).
3. Remover o `bootstrap.model.prisma` da `config-prisma`, subir o Postgres e gerar a migration: `pnpm exec prisma migrate dev --name auth-init`, seguida de `prisma:generate`.
4. Aplicar `@UseGuards(SessionGuard)` + `@CurrentSession()` nos controllers de negócio conforme forem criados.

## Arquivos críticos

- `<backendAppPath>/prisma/models/auth.model.prisma`
- `<backendAppPath>/src/lib/auth.ts`
- `<backendAppPath>/src/lib/redis.ts` e `src/lib/session-cache/session-cache.service.ts` (dependências, da `config-redis`)
- `<backendAppPath>/src/auth/auth.controller.ts`, `session.guard.ts`, `current-session.decorator.ts`, `auth.module.ts`
- `<backendAppPath>/src/app.module.ts`, `src/main.ts`, `.env`, `.env.example`
- `apps/web/src/lib/auth-client.ts` e `get-server-session.ts`
- `apps/web-admin/src/lib/auth-client.ts` e `get-server-session.ts`

## Decisões de escopo

- **Autenticação por cliente (PRD §4.1):** `web` e `web-admin` por cookie, em domínios distintos; `web-marketing` não autentica (`auth: "none"`).
- **Sessões não compartilhadas (CA-RF03-2) ainda não garantidas.** Com o cookie no domínio da API, os dois apps dividiriam a sessão no navegador. Decidir em ADR antes da spec de identidade (rewrite same-origin por app com `cookiePrefix` distinto, ou duas instâncias do Better-Auth).
- **`SessionGuard` lê só o cookie** e só autentica (`401 UNAUTHORIZED`, CA-RF04-1). Não resolve tenant (`TenantGuard`, RF-04) nem papel (`AdminGuard`, PRD §3.3).
- **`platformRole` com `input: false`:** nenhum fluxo público grava papel (CA-RF07-1).
- **Só e-mail e senha** (RF-03), sem verificação obrigatória ainda (RF-02, spec de identidade).
- **Guard não é global:** as rotas abertas do RF-04 ficam de fora; aplicar por controller.
- **Nenhum plugin do Better-Auth registrado por padrão.** `twoFactor` (RF-07) e `emailAndPassword` (RF-02, RF-05, RF-06) entram pelas specs.
- **`auth.model.prisma` é criado uma única vez**; **`auth.ts` é sempre re-renderizado** — plugin ou config adicionados nele se perdem numa nova execução sem reincorporar ao template (o script só registra `[RISK]`).
- **Nunca `secondaryStorage`**: a sessão fica no Postgres; o cache-aside já existe.
- **Nunca o plugin `organization`**: o tenant é o `Tenant` do domínio (PRD §3.1).
- **`create-auth` não conhece NestJS**: só consulta pontual, nunca o wizard.

## Flags

- `--apply`: aplica as alterações
- `--dry-run`: simula (padrão sem `--apply`)
- `--install`: `pnpm --filter <workspace> ... install` (um `--filter` por workspace existente — api e clientes com cookie — numa única chamada); nunca `pnpm install --workspace <nome>`

## Pós-bootstrap

- `BETTER_AUTH_SECRET` real e migration `auth-init`
- ADR do isolamento de sessão entre `web` e `web-admin` (CA-RF03-2)
- Specs de identidade (Fase 1): RF-01 (cadastro com tenant), RF-02, RF-05, RF-06, RF-07 (TOTP), RF-81, `TenantGuard`/`TenantContext` e `AdminGuard`, todas com os `CA-*` automatizados antes do código
- Validar o login por e-mail e senha em `apps/web` e em `apps/web-admin`
