Execução conforme [Como executar](../../specs/shared/como-executar.md) e nomes conforme [Regras de nomenclatura](../../specs/shared/regras-de-nomenclatura.md). Objetivo e contexto técnico: `proposal.md` e `design.md` desta change.

- Cada grupo 1–6 roda num subagente distinto, com contexto limpo, **em sequência** (cada grupo depende do anterior).
- Ao concluir uma task: marcar o checkbox e registrar a evidência logo abaixo, citando o comando executado, os arquivos criados/alterados relevantes e as linhas `[RISK]`/`[FAIL]` do `.log/skills.log` (não versionado):

  ```md
  - [x] descrição da task
    > ✅ YYYY-MM-DD HH:MM — o que foi feito, decisões tomadas, desvios do plano
  ```

- Checkbox sem evidência não conta. Nunca remover task. Task não executável continua aberta com o motivo na evidência, até ser resolvida ou o desvio aceito pelo usuário.
- Nunca `pnpm run dev`, nunca `prisma migrate reset`/`db push --force-reset`, nunca commit sem permissão explícita do usuário (Conventional Commits, nunca `--no-verify`). Documentação de bibliotecas via Context7; busca/edição de código por símbolo via Serena.
- Nenhum comportamento de RF com cenário `CA-*` entra nesta change; tasks de RF ficam como pendência com spec própria, teste escrito e visto falhar antes do código.

## 0. Pré-condições

- [ ] 0.1 Confirmar `git status` limpo (inclusive com os artefatos desta change já commitados pelo usuário); se houver trabalho não versionado, pedir ao usuário que o commite e só então seguir. Verificação: saída vazia de `git status --porcelain`
- [ ] 0.2 Confirmar Node.js `>=24`, `pnpm` e Docker instalados. Verificação: `node -v`, `pnpm -v`, `docker version` e `docker compose version`
- [ ] 0.3 Confirmar que `config-project`, `config-prisma`, `config-redis`, `config-auth`, `setup-pre-commit` e `utils` existem em `.claude/skills/` e que os `SKILL.md` estão adaptados à topologia do Hypomna (sem Expo/mobile, `apps/web` e `packages/ui` preservados, seis pacotes internos, Redis em instância única, auth só por cookie). Verificação: listagem e leitura dos `SKILL.md`, registrando trechos herdados do kynesa (ex.: "dois Redis" e `prisma migrate reset` no `SKILL.md` da `config-prisma`)
- [ ] 0.4 Confirmar em `.claude/skills/.env/skills.config.json`: `namespace` `@hypomna`, `backendAppPath` `apps/api`, `backendPort` 4000 e `apps` com `web` (3000, `NEXT_PUBLIC_API_URL`, `cookie`), `web-admin` (3001, `NEXT_PUBLIC_API_URL`, `cookie`) e `web-marketing` (3002, `NEXT_PUBLIC_API_URL`, `none`). Verificação: leitura do arquivo
- [ ] 0.5 Confirmar `openspec/specs/shared/como-executar.md`, `openspec/specs/shared/regras-de-nomenclatura.md` e o `context` de `openspec/config.yaml`. Verificação: leitura dos três

## 1. Projeto base (skill `config-project`)

- [ ] 1.1 Executar **uma única vez** `node .claude/skills/config-project/scripts/project-init.mjs` com namespace `@hypomna` e versões atuais, sem pinar (fora Node 24.x). Não rodar `setup-pre-commit` depois. Verificação: script termina sem `[FAIL]` no log
- [ ] 1.2 Conferir os quatro apps (`apps/api`, `apps/web`, `apps/web-admin`, `apps/web-marketing`) e a ausência de `apps/docs`, de app Expo e de exemplos do template. Verificação: `ls apps` e `name` de cada `package.json`
- [ ] 1.3 Conferir os esqueletos `packages/domain`, `contracts`, `i18n`, `test-utils`, `api-client` e `ui`, ao lado de `eslint-config` e `typescript-config`, sem símbolo de domínio. Verificação: `ls packages` e leitura de cada `src/index.ts`
- [ ] 1.4 Conferir `engines.node` (`>=24`) no `package.json` da raiz e `engine-strict=true` no `.npmrc`. Verificação: leitura dos dois arquivos
- [ ] 1.5 Conferir os hooks Husky: `pre-commit` com lint-staged + ESLint + Prettier e `pre-push` com `check-types` e testes unitários. Verificação: leitura de `.husky/pre-commit`, `.husky/pre-push` e da config do lint-staged
- [ ] 1.6 Conferir `packages/eslint-config` com `simple-import-sort`, `no-else-return` e `eslint-plugin-boundaries`. Verificação: leitura da config e lint de um arquivo de exemplo com import fora de ordem acusando erro
- [ ] 1.7 Conferir Vitest com coverage e `@amiceli/vitest-cucumber` em `apps/api` e nos apps Next, e o `pnpm test:trace` (RF-86) na raiz. Verificação: `pnpm --filter <app> test` em cada app e `pnpm test:trace` rodando
- [ ] 1.8 **Antes do grupo 2**, conferir em `apps/api/.env` e `.env.example`: `DATABASE_URL` = `postgresql://hypomna:hypomna@localhost:5432/hypomna?schema=public` e `BETTER_AUTH_SECRET` só como placeholder; confirmar que `.env` está ignorado pelo git. Verificação: leitura dos arquivos e `git check-ignore apps/api/.env`
- [ ] 1.9 Conferir o schema Zod de env de `apps/api` com as variáveis do PRD §7 usadas pelo bootstrap (opcionais: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OTEL_EXPORTER_OTLP_ENDPOINT`) e o schema de env de cada app Next; ajustar à mão o que faltar e registrar o desvio. Verificação: teste unitário do schema falhando sem `DATABASE_URL` e passando sem as opcionais
- [ ] 1.10 Rodar `pnpm run check-types` na raiz. Verificação: comando passa, ou a falha fica registrada como aviso na evidência com a task de correção aberta
- [ ] 1.11 Pendência: registrar o desvio `packages/typescript-config` × `packages/tsconfig` (PRD §6.1) para atualização do PRD. Verificação: nota de revisão do PRD criada ou issue aberta, citada na evidência

## 2. Prisma na API (skill `config-prisma`)

- [ ] 2.1 Executar `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --dry-run`, revisar o plano e confirmar que não há `--module auth`. Verificação: saída do dry-run na evidência
- [ ] 2.2 Executar `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --apply --install`. Verificação: `prisma/models/bootstrap.model.prisma`, `prisma.config.ts`, `prisma/seed/main.ts`, `DbModule` e `PrismaService` (com `runInTransaction`) presentes
- [ ] 2.3 Confirmar o nome do workspace em `apps/api/package.json` e rodar `pnpm --filter @hypomna/api run prisma:generate`. Verificação: client gerado em `src/generated/prisma` sem erro
- [ ] 2.4 Conferir o `docker-compose.yml` criado: PostgreSQL 16+, `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` = `hypomna`, `container_name` `hypomna-db-postgres`. Nenhuma migration neste grupo. Verificação: leitura do arquivo e `docker compose config`
- [ ] 2.5 Pendência: registrar `packages/shared` (interface `TransactionManager`) fora do PRD §6.1, para decisão na spec de arquitetura (pacote × `apps/api/src/shared`). Verificação: pendência citada na evidência e na spec de arquitetura
- [ ] 2.6 Pendência: spec `RF-00-schema` (RLS, role de aplicação sem `BYPASSRLS` e não dona das tabelas, extensão Prisma com `tenantId`, `SET LOCAL app.tenant_id`, DT-01/DT-08), com testes de integração próprios; registrar que o `DATABASE_URL` de migration e o da aplicação vão divergir. Verificação: pendência referenciada em `.docs/specs/platform/RF-00-schema.md` ou na §11 do PRD

## 3. Redis na API (skill `config-redis`)

- [ ] 3.1 Executar `node .claude/skills/config-redis/scripts/init-redis-backend.js --dry-run`, sem `--queue`. Verificação: saída do dry-run na evidência
- [ ] 3.2 Executar `node .claude/skills/config-redis/scripts/init-redis-backend.js --apply --install`. Verificação: `SessionCacheService` em `apps/api/src/lib/session-cache/`, throttlers `default` e `sensitive` e infraestrutura BullMQ sem fila de negócio
- [ ] 3.3 Conferir `docker-compose.yml` com `postgres` e `redis` juntos, Redis 7+, `noeviction`, persistência, `container_name` `hypomna-redis`, e `REDIS_URL` (porta 6379) em `.env` e `.env.example`, sem `REDIS_QUEUE_URL`/`REDIS_CACHE_URL`. Verificação: leitura dos arquivos e `docker compose config`
- [ ] 3.4 Pendência: política de degradação do rate limit (fail-open em `default`, fail-closed `503` em `sensitive`) a confirmar na spec do RF-81 e levar ao PRD. Verificação: pendência citada na spec do RF-81 ou na §11 do PRD

## 4. MinIO e Mailpit (à mão, sem skill)

- [ ] 4.1 Acrescentar ao `docker-compose.yml`, sem reescrever `postgres` e `redis`: `minio` (API S3 + console, volume) com `container_name` `hypomna-storage-minio` e `mailpit` (SMTP + UI) com `container_name` `hypomna-mail-mailpit`; registrar na evidência que não houve skill. Verificação: `git diff` do compose só com acréscimos
- [ ] 4.2 Acrescentar serviço de init que cria o bucket de `S3_BUCKET` com `mc mb --ignore-existing`. Verificação: bucket presente após `docker compose up -d`, e segunda subida sem erro
- [ ] 4.3 Acrescentar `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SMTP_URL` e `EMAIL_FROM` em `apps/api/.env` e `.env.example`, validadas pelo schema de env (credenciais só de desenvolvimento). Verificação: teste do schema de env passando com elas e falhando sem `S3_BUCKET`
- [ ] 4.4 Validar o compose e subir os quatro serviços. Verificação: `docker compose config` válido e `docker compose up -d` com `postgres`, `redis`, `minio` e `mailpit` saudáveis (`docker compose ps`)
- [ ] 4.5 Pendência: porta `FileStorage` e adaptador S3, prefixo `tenants/<tenantId>/…` e URLs assinadas (Fases 3 e 4) e envio de e-mail (Fase 1). Verificação: pendências citadas nas specs das fases correspondentes ou na §11 do PRD

## 5. Autenticação (skill `config-auth`)

- [ ] 5.1 Executar `node .claude/skills/config-auth/scripts/init-auth.js --dry-run`, conferindo que `web-marketing` não recebe client e que não há `secondaryStorage` nem plugin `organization`. Verificação: saída do dry-run na evidência
- [ ] 5.2 Executar `node .claude/skills/config-auth/scripts/init-auth.js --apply --install` (sem rodar o wizard da `create-auth`). Verificação: `prisma/models/auth.model.prisma` com `platformRole`, `src/lib/auth.ts` (só e-mail e senha, `platformRole` com `input: false`), `AuthController` em `/api/auth/*`, `SessionGuard`, `@CurrentSession()`, CORS com credenciais e auth-client por cookie em `apps/web` e `apps/web-admin`
- [ ] 5.3 Conferir o `auth.model.prisma` contra a versão instalada do Better-Auth (`pnpm exec @better-auth/cli generate` para arquivo temporário, sem sobrescrever) e ajustar à mão se divergir. Verificação: diff registrado na evidência
- [ ] 5.4 Remover `apps/api/prisma/models/bootstrap.model.prisma`. Verificação: arquivo inexistente e `prisma:generate` sem erro
- [ ] 5.5 Subir o Postgres (`pnpm --filter @hypomna/api run db:start`), rodar `pnpm --filter @hypomna/api exec prisma migrate dev --name auth-init` e depois `pnpm --filter @hypomna/api run prisma:generate`. Verificação: caminho da migration criada em `prisma/migrations/` citado na evidência
- [ ] 5.6 Conferir a ausência de middleware do Next.js e de verificação centralizada de sessão em `apps/web` e `apps/web-admin`, e de dependência de auth em `apps/web-marketing`. Verificação: busca por `middleware.ts` e leitura dos `package.json`
- [ ] 5.7 Rodar `pnpm run check-types` e os testes de `apps/api` (`test` e `test:e2e`), com a guarda de sessão respondendo `401 UNAUTHORIZED` sem cookie. Verificação: saídas na evidência
- [ ] 5.8 Pendência (Fase 1): cadastro com criação atômica de `Tenant`, `TenantMembership` (`OWNER`) e `TraderProfile` (RF-01) e teste gratuito (RF-68), partindo dos `CA-*`. Verificação: spec em `.docs/specs/identity/` referenciada
- [ ] 5.9 Pendência (Fase 1): `TenantGuard` e `TenantContext` nas três camadas (RF-04, §3.2). Verificação: spec em `.docs/specs/identity/` referenciada
- [ ] 5.10 Pendência (Fase 1): `AdminGuard`, distinto do `TenantGuard`, no módulo `admin` (§3.3). Verificação: spec referenciada
- [ ] 5.11 Pendência (Fase 1): verificação de e-mail (RF-02), recuperação e troca de senha (RF-05, RF-06), com a skill `emailAndPassword`. Verificação: specs referenciadas
- [ ] 5.12 Pendência (Fase 1): TOTP do Admin (RF-07, CA-RF07-1 e CA-RF07-2), com a skill `twoFactor`. Verificação: spec referenciada
- [ ] 5.13 Pendência (Fase 1): bloqueio progressivo e rate limit de autenticação (RF-81) e hardening, com a skill `security`. Verificação: spec referenciada
- [ ] 5.14 Pendência: ADR do isolamento de sessão entre `apps/web` e `apps/web-admin` (CA-RF03-2) — rewrite same-origin por app com `cookiePrefix` distinto ou duas instâncias do Better-Auth — antes da spec de identidade. Verificação: ADR criado e referenciado
- [ ] 5.15 Manual (usuário): gerar o `BETTER_AUTH_SECRET` real em `apps/api/.env`, sem commitar. Marcar só após confirmação do usuário. Verificação: confirmação do usuário registrada e `.env` fora do git
- [ ] 5.16 Manual (usuário): validar o login por e-mail e senha em `apps/web` e em `apps/web-admin`, confirmando que a sessão de um não vale no outro (depende de 5.14). Marcar só após confirmação do usuário. Verificação: confirmação do usuário registrada

## 6. Fechamento

- [ ] 6.1 Rodar `pnpm --filter <app> test` nos apps alterados, `test:e2e` na API, `pnpm run check-types` e `pnpm test:trace`, reportando o resultado como ele é (falha, cenário pendente ou verificação não executada). Verificação: saídas na evidência
- [ ] 6.2 Atualizar a §11 do PRD e o status do prompt 01 em `.docs/prompts/monorepo/README.md`, e registrar a correção dos trechos herdados do kynesa no `SKILL.md` da `config-prisma`. Verificação: diff dos documentos
- [ ] 6.3 Conferir que todas as tasks estão marcadas e com evidência; tasks abertas só com desvio aceito pelo usuário. Verificação: `openspec status --change config-projeto` e leitura deste arquivo
