---
name: config-auth
description: 'Escaffoldar a fundação de autenticação do monorepo HYPOMNA com o Better-Auth, na topologia do PRD §1.4/§4.1/§6.2 — backend `apps/api` (`backendAppPath`) e os clientes de `apps[]` do `skills.config.json`: `web` (Trader) e `web-admin` (Admin e Suporte), ambos com sessão por cookie, e `web-marketing` (`auth: "none"`, não autentica ninguém). Gera o schema Prisma de identidade do PRD §5 (`prisma/models/auth.model.prisma`, com `platformRole`), `src/lib/auth.ts` (e-mail e senha como único método de login — RF-03 —, `platformRole` com `input: false` — CA-RF07-1), `AuthController` em `/api/auth/*`, `SessionGuard` (`401 UNAUTHORIZED`, CA-RF04-1) e `@CurrentSession()` no NestJS, cache-aside com o `SessionCacheService` da `config-redis`, CORS com credenciais para os clientes web e o auth-client de cada app com cookie — nunca middleware, seguindo `.claude/rules/auth-client.md`. Não implementa cadastro com tenant (RF-01), verificação de e-mail (RF-02), recuperação e troca de senha (RF-05, RF-06), TOTP do Admin (RF-07), rate limit de login (RF-81), `TenantGuard` nem `AdminGuard` — isso é das specs de identidade, com as skills genéricas do Better-Auth por cima. Usar quando o pedido envolver o bootstrap inicial de autenticação neste monorepo, não uma dúvida genérica sobre a API do Better-Auth.'
---

# Config Auth

## Overview

Esta skill é **fina de propósito**: só escaffolda o que é específico deste monorepo — as convenções de `config-prisma`/`config-redis` (schema modular, arquivos de infra sempre re-renderizados, injeção cirúrgica em `app.module.ts`), a regra de "nunca middleware, sempre verificação na própria página" (`.claude/rules/auth-client.md`) e a integração de cache-aside com o `SessionCacheService` que a `config-redis` criou.

**Quem autentica como (PRD §4.1, §6.2)** — definido por `apps[].auth` em `skills.config.json`:

| App             | `auth`   | Mecanismo                                                                              |
| --------------- | -------- | -------------------------------------------------------------------------------------- |
| `web`           | `cookie` | Sessão por cookie do Better-Auth. Só o Trader (dono de um tenant).                     |
| `web-admin`     | `cookie` | Sessão por cookie do Better-Auth, domínio próprio. Só `platformRole` `ADMIN`/`SUPPORT`, com TOTP (RF-07, fora deste bootstrap). |
| `web-marketing` | `none`   | Não autentica ninguém — nenhum client de auth é gerado.                                |

**O que esta skill NÃO faz** (specs de identidade da Fase 1, com as skills genéricas `emailAndPassword`, `twoFactor`, `security`, `best-practices`):

- Cadastro com criação atômica de `Tenant`, `TenantMembership` (`OWNER`) e `TraderProfile` e o teste gratuito (RF-01, RF-68); `locale` e `timeZone` do `User` (PRD §5).
- Verificação de e-mail antes do primeiro login (RF-02), recuperação e troca de senha (RF-05, RF-06). O envio de e-mail vai pelo Mailpit em desenvolvimento e precisa de e-mails traduzidos (RF-65).
- TOTP obrigatório no login do Admin (RF-07, CA-RF07-2).
- Bloqueio progressivo e rate limit de login (RF-81); o storage do rate limit já vem da `config-redis`.
- `TenantGuard`/`TenantContext` (RF-04, PRD §3.2) e `AdminGuard` (PRD §3.3), que dependem dos modelos de domínio.
- **Isolamento de sessão entre `web` e `web-admin` (CA-RF03-2).** Com uma instância do Better-Auth e o cookie gravado no domínio da API, os dois apps, chamando a mesma API com `credentials: 'include'`, compartilhariam o mesmo cookie no navegador — o oposto do que o PRD exige. A decisão fica para um ADR antes da spec de identidade. Caminhos possíveis: cada app expõe `/api/auth/*` na própria origem por rewrite do Next (cookie host-only em cada domínio) com `cookiePrefix` distinto, ou duas instâncias do Better-Auth (Trader e Admin) com cookies e rotas separados. Até lá, CA-RF03-2 **não** está atendido.

## Pré-requisitos

- `config-project` executada: `apps/api` e os clientes de `apps[]` com cookie existem. Cliente ausente é pulado com aviso.
- `config-prisma` executada (schema modular, `PrismaService`, client gerado em `src/generated/prisma`).
- `config-redis` executada (`SessionCacheService` em `src/lib/session-cache/`, `createCacheRedisClient` em `src/lib/redis.ts`) — o `SessionGuard` e o hook de invalidação de `auth.ts` dependem desses arquivos.

## Workflow

1. Confirmar os três pré-requisitos.
2. Executar:
   - `node .claude/skills/config-auth/scripts/init-auth.js --dry-run`
   - `node .claude/skills/config-auth/scripts/init-auth.js --apply --install`
3. O `BETTER_AUTH_SECRET` real (gerado pelo usuário, nunca commitado) continua manual.
4. **Conferir `auth.model.prisma` contra a versão instalada** antes da primeira migration: `pnpm exec @better-auth/cli generate` e ajuste manual se divergir. A skill nunca regenera esse arquivo depois de criado.
5. Migration das tabelas do Better-Auth (no backend): `pnpm exec prisma migrate dev --name auth-init`.
6. Aplicar `@UseGuards(SessionGuard)` e `@CurrentSession()` nos controllers de negócio conforme forem criados — o guard não é global, e as rotas abertas do RF-04 (`/health`, `/docs`, `/openapi.json`, `/public/*`, `/api/auth/*`, `/webhooks/*`) ficam de fora.

## O que o script garante

**Backend (`apps/api`):**

- `prisma/models/auth.model.prisma`: `User`/`Session`/`Account`/`Verification` do Better-Auth, com `User.platformRole` (enum `PlatformRole`: `ADMIN`/`SUPPORT`, PRD §3.3). `User` não tem `tenantId` (a identidade é anterior ao tenant e o Admin não pertence a tenant). Criado **uma única vez**.
- `src/lib/auth.ts`: `betterAuth()` com Prisma adapter dedicado (o `auth.ts` é singleton fora do container de DI), `emailAndPassword.enabled` (único método, sem `socialProviders`), `user.additionalFields.platformRole` com `input: false`, `trustedOrigins` com as bases dos clientes com cookie (`WEB_BASE_URL`, `WEB_ADMIN_BASE_URL`) e `databaseHooks.session.delete.after` invalidando o cache de sessão no logout. Cookies com os padrões do Better-Auth (`HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS) — conferir contra o RF-03 na spec de identidade.
- `src/auth/auth.controller.ts`: handler do Better-Auth em `/api/auth/*` via `toNodeHandler` — rota aberta, nunca atrás de guard.
- `src/auth/session.guard.ts`: `SessionGuard` — lê o cookie de sessão sem tocar banco/Redis; cache-aside via `SessionCacheService` (chave é o token cru, sem assinatura e com URL-decoding), cache miss cai para `auth.api.getSession()` e repovoa. Erro `401 { error, code: "UNAUTHORIZED" }`; a `message` traduzida do contrato de erro entra com o `ExceptionFilter` global (RF-63). **Só autentica.**
- `src/auth/current-session.decorator.ts`: `@CurrentSession()`.
- `src/auth/auth.module.ts`: registra `AuthController`/`SessionGuard`, importa `SessionCacheModule`; injetado em `app.module.ts`.
- `main.ts`: o `app.enableCors()` da `config-project` vira `{ origin: [<bases dos três clientes web>], credentials: true }`. CORS customizado não é sobrescrito, só sinalizado com `[RISK]`.
- `.env`/`.env.example`: `API_BASE_URL` e uma `<APP>_BASE_URL` por app web (`WEB_BASE_URL`, `WEB_ADMIN_BASE_URL`, `WEB_MARKETING_BASE_URL` — nomes do PRD §7). Só adiciona chaves ausentes; `BETTER_AUTH_SECRET` nunca é tocado.
- Dependência `better-auth`.

**Clientes com cookie (`web`, `web-admin`):**

- `src/lib/auth-client.ts`: `createAuthClient({ baseURL: process.env.<apiUrlEnvVar> })`.
- `src/lib/get-server-session.ts`: `getServerSession()`, que encaminha `headers()` do Next para `authClient.getSession()` (app e API são origens diferentes).
- Dependência `better-auth`. `web-marketing` não recebe nada.

## Divisão de trabalho com as skills genéricas do Better-Auth

| Skill              | Quando usar                                                                                                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-auth`      | Só consulta pontual. **Nunca rodar o wizard de scaffolding neste repo**: ele não conhece NestJS e geraria arquivos no formato errado (ex.: `app/api/auth/[...all]/route.ts`) em vez de reconhecer `AuthController`/`SessionGuard`.                                       |
| `emailAndPassword` | Verificação de e-mail obrigatória (RF-02), recuperação e troca de senha (RF-05, RF-06), política de senha (mínimo de 8 caracteres, RF-01).                                                                                                                            |
| `twoFactor`        | TOTP obrigatório no login do Admin (RF-07, CA-RF07-2), só em `web-admin`.                                                                                                                                                                                             |
| `security`         | Hardening (RF-81, OWASP ASVS nível 2 do PRD §7): `trustedOrigins` restrito, rotação de segredo, CSRF nas rotas de cookie. **Nunca configurar `secondaryStorage`**: moveria a sessão para fora do Postgres, e o cache-aside já é feito por `SessionGuard`/`SessionCacheService`. |
| `organization`     | **Não usar.** O tenant é o `Tenant` do domínio com `TenantMembership` (PRD §3.1), via Prisma, não o plugin `organization`.                                                                                                                                             |
| `best-practices`   | Consulta geral de convenções do Better-Auth.                                                                                                                                                                                                                          |

> ⚠️ **Toda edição em `<backendAppPath>/src/lib/auth.ts` (novo plugin, hooks, cookies) é perdida na próxima execução de `config-auth --apply`** — `auth.ts` é sempre re-renderizado, diferente de `auth.model.prisma`. Depois de customizá-lo, não reexecute a skill sem reincorporar as mudanças ao template; o script só avisa com `[RISK]`.

## Notes

- Idempotente. Arquivos de infraestrutura (`auth.ts`, `auth.controller.ts`, `session.guard.ts`, `current-session.decorator.ts`, `auth.module.ts` e os `auth-client.ts`/`get-server-session.ts` dos apps) são sempre re-renderizados; `auth.model.prisma` é criado uma única vez.
- Falha com mensagem clara se `<backendAppPath>/package.json` não existir; pula clientes ausentes com aviso.
- Consultar `references/auth-init-checklist.md`.

## Risk Logging Guardrails

- Registrar fatos de execução em `.log/skills.log` com marcador no início da linha.
- Marcadores mínimos: `[CMD]`, `[FILE_CREATE]`, `[FILE_UPDATE]`, `[FILE_DELETE]`, `[DIR_CREATE]`, `[RISK]`, `[FAIL]`, `[AI]`.
- Sempre registrar `[RISK]` em sobrescrita, exclusão, rename/move ou fallback forçado.
- Toda falha inesperada gera `[FAIL]` com descrição factual curta.
- Operações de terminal e de arquivo passam pelos utilitários de `../utils`.

## Premissa de módulo (ESM)

O código gerado no backend assume a baseline da `config-project`: `"type": "module"` e `module`/`moduleResolution` `nodenext`, então os imports relativos gerados (e os injetados em `app.module.ts`) carregam `.js`.
