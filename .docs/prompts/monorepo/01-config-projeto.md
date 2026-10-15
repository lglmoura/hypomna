# Especificação: Configuração End-to-End do Projeto Hypomna

Criar uma spec (via OpenSpec) para configurar o projeto **de ponta a ponta**, executando os passos abaixo **na ordem apresentada**. É a parte de infraestrutura da **Fase 0 — Fundação do monorepo** (PRD §12). Base: `.docs/PRD.md` rev 1.1 (§1.4, §3.2, §6, §7, §7.1) e as skills `config-project`, `config-prisma`, `config-redis` e `config-auth` em `.claude/skills/`. A configuração das skills fica em `.claude/skills/.env/skills.config.json` (namespace `@hypomna`, backend `apps/api`, três clientes web).

## Topologia alvo (PRD §1.4/§6.1)

| App                  | Tecnologia                     | Papel                         | Autenticação (PRD §4.1, §6.2) |
| -------------------- | ------------------------------ | ----------------------------- | ----------------------------- |
| `apps/api`           | NestJS                         | backend único                 | —                             |
| `apps/web`           | Next.js (App Router)           | Trader                        | cookie                        |
| `apps/web-admin`     | Next.js (App Router)           | Admin e Suporte da Plataforma | cookie + TOTP                 |
| `apps/web-marketing` | Next.js (App Router, estático) | Visitante (landing e preços)  | nenhuma                       |

Pacotes (PRD §6.1): `packages/domain`, `packages/contracts`, `packages/api-client`, `packages/i18n`, `packages/ui`, `packages/test-utils`, `packages/eslint-config` e `packages/tsconfig`. Nenhum app mobile existe na v1 (PRD §1.6) e nenhum app atende mais de um papel (princípio 7).

Infra local (PRD §6.1): `docker compose` com PostgreSQL 16+, Redis 7+, MinIO (S3) e Mailpit.

## Passo 0 — Pré-condições (antes de qualquer skill)

- `git status` limpo. Se houver trabalho não versionado, pedir ao usuário que o commite antes de continuar. O `config-project` não tem `--dry-run` e já causou perda de apps ao ser reexecutado (incidente do kynesa em 2026-09-04); **nunca rodá-lo mais de uma vez** neste repositório.
- Node.js `>=24` (PRD §6.1), `pnpm` e Docker instalados.
- Confirmar que as skills `config-project`, `config-prisma`, `config-redis`, `config-auth`, `setup-pre-commit` e `utils` existem em `.claude/skills/`, já adaptadas do kynesa para a topologia do Hypomna (sem Expo/mobile, `apps/web` e `packages/ui` preservados, seis pacotes internos, Redis em instância única, auth só por cookie). O `SKILL.md` de cada uma descreve o que gera e o que fica de fora.
- Confirmar que `.claude/skills/.env/skills.config.json` tem `namespace: "@hypomna"`, `backendAppPath: "apps/api"`, `backendPort: 4000` e a lista `apps`:

  | `kind` | `path`               | `port` | `apiUrlEnvVar`        | `auth`   |
  | ------ | -------------------- | ------ | --------------------- | -------- |
  | `next` | `apps/web`           | 3000   | `NEXT_PUBLIC_API_URL` | `cookie` |
  | `next` | `apps/web-admin`     | 3001   | `NEXT_PUBLIC_API_URL` | `cookie` |
  | `next` | `apps/web-marketing` | 3002   | `NEXT_PUBLIC_API_URL` | `none`   |

- Confirmar `openspec/specs/shared/como-executar.md`, `openspec/specs/shared/regras-de-nomenclatura.md` e o `context` de `openspec/config.yaml`.

## Passos

1. **Criar o projeto base**
   - Usar a skill `config-project`: `node .claude/skills/config-project/scripts/project-init.mjs --skip-global-nest` (cria o backend via `npx @nestjs/cli`; sem a flag, a instalação global do Nest CLI falha quando o bin global do pnpm não está no PATH). Rodar em foreground e **sem** `CI=1`, que força `frozen-lockfile` e quebra o passo do Husky.
   - Namespace: `@hypomna`.
   - **Versões:** usar as versões atuais (`create-next-app@latest`, `nest new`), sem pinar. O PRD só fixa Node.js 24.x, PostgreSQL 16+ e Redis 7+.
   - Esse passo já inclui os git hooks (Husky: pre-commit com lint-staged + ESLint + Prettier; pre-push com `check-types` e testes unitários, PRD §7.1), o ferramental de testes da PRD §7.1 (Vitest + `@amiceli/vitest-cucumber`) e o `pnpm test:trace` (RF-86) — **não rodar a skill `setup-pre-commit` separadamente depois**: o `SKILL.md` do `config-project` documenta que ela só deve ser usada isolada em repositórios fora do padrão Turborepo, e rodar as duas em sequência é redundante (na pior hipótese, gera `eslint.config`/`.lintstagedrc` concorrentes).
   - `packages/eslint-config` com a base de lint do PRD §7 (`simple-import-sort`, `no-else-return`, `eslint-plugin-boundaries`); as regras finas de Object Calisthenics e o lint contra `number` monetário entram como pendência da spec de arquitetura (Fase 0), não aqui.
   - O template do Turbo nomeia o pacote de tsconfig como `packages/typescript-config`; o PRD §6.1 o chama de `packages/tsconfig`. A skill mantém o nome do template (os pacotes internos o referenciam): registrar o desvio como pendência de atualização do PRD.
   - **Conferir logo após a skill e antes do passo 2:** o `DATABASE_URL` em `apps/api/.env` e `.env.example` deve ser `postgresql://hypomna:hypomna@localhost:5432/hypomna?schema=public` (a skill deriva do namespace). `BETTER_AUTH_SECRET` fica como placeholder; o valor real é gerado pelo usuário localmente e nunca é commitado. Reexecuções da skill não sobrescrevem nenhum dos dois.
   - O schema Zod de env de `apps/api` declara as variáveis do PRD §7 ("Variáveis de ambiente (iniciais)") que este bootstrap usa; as de Stripe e OpenTelemetry entram opcionais até as fases que as consomem, e a ausência de uma obrigatória falha o boot.
   - Aceite: os quatro apps existem; `packages/domain`, `contracts`, `i18n`, `test-utils`, `api-client` e `ui` existem como esqueleto, ao lado de `eslint-config` e `typescript-config`; `pnpm run check-types` na raiz passa (ou a falha fica registrada como aviso, conforme a skill); `engines.node` e `engine-strict=true` presentes; nenhum `apps/docs` ou app Expo restante.

2. **Configurar o Prisma na API**
   - Usar a skill `config-prisma`, nesta sequência (a partir da raiz):
     - `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --dry-run`
     - `node .claude/skills/config-prisma/scripts/init-prisma-backend.js --apply --install`
     - `pnpm --filter @hypomna/api run prisma:generate` (obrigatório antes de qualquer build; confirmar o nome real do workspace em `apps/api/package.json`).
   - **Não usar `--module auth`**: `auth.model.prisma` pertence à `config-auth` (passo 5). Sem `--module`, a skill cria o `bootstrap.model.prisma` temporário, o que é esperado.
   - **Não executar migration neste passo:** só existe o `bootstrap.model.prisma` temporário, sem modelo real a migrar. A primeira migration acontece no passo 5, quando o `auth.model.prisma` passa a existir (ver "Migrations" nas Observações Gerais).
   - O `docker-compose.yml` é criado uma única vez a partir do `DATABASE_URL` conferido no passo 1. Aceite: imagem PostgreSQL 16 ou superior; `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` valem `hypomna`; `container_name` é `hypomna-db-postgres` (derivado do namespace, automático).
   - A skill também cria `packages/shared` (interface `TransactionManager`, consumida só pelo backend), que **não está no PRD §6.1**: registrar o desvio e decidir na spec de arquitetura se fica como pacote ou vai para `apps/api/src/shared` (PRD §6.2).
   - **Fora do escopo:** RLS, a role de aplicação sem `BYPASSRLS` e que não é dona das tabelas, a extensão do Prisma que injeta `tenantId` e o `SET LOCAL app.tenant_id` por transação (PRD §3.2, DT-01, DT-08). Isso é a spec `RF-00-schema` da Fase 0, com testes de integração próprios; registrar como pendência. Consequência prevista: o `DATABASE_URL` de migrations e o da aplicação vão divergir quando essa spec entrar.
   - Não é necessário subir o Postgres neste passo.

3. **Configurar o Redis na API**
   - Usar a skill `config-redis`:
     - `node .claude/skills/config-redis/scripts/init-redis-backend.js --dry-run`
     - `node .claude/skills/config-redis/scripts/init-redis-backend.js --apply --install`
   - Topologia do PRD §6.2 e §7: **uma instância** Redis 7+ com `REDIS_URL` (porta 6379), usada por BullMQ (importação, recálculo de status de mesa, exportação, e-mails, webhooks), rate limit (RF-81) e cache de sessão. Por causa do BullMQ, `maxmemory-policy noeviction`. Não existem `REDIS_QUEUE_URL` nem `REDIS_CACHE_URL`; se for preciso separar fila e cache, isso é questão nova para o PRD, não decisão deste passo.
   - Toda chave de dado de domínio no cache é prefixada por `tenantId` (PRD §3.2). O bootstrap só cria a infraestrutura; a regra vale para os módulos que a usarem.
   - Aceite: `docker-compose.yml` contém `postgres` e `redis` juntos (nenhuma skill sobrescreve o arquivo inteiro; a ordem entre os passos 2 e 3 é indiferente); `container_name` `hypomna-redis` (automático); `REDIS_URL` em `.env` e `.env.example`; `SessionCacheService` em `apps/api/src/lib/session-cache/`.
   - **Filas BullMQ de negócio ficam fora deste passo** (sem `--queue`): importação (Fase 4), recálculo de mesa (Fase 6), exportação (Fase 8), webhooks do Stripe (Fase 7) e e-mails (Fase 1) são criadas com as specs que as usam.
   - Fora do escopo: aplicar o rate limit em `/api/auth/*`, upload e importação (RF-81) — passo dos módulos de domínio. A skill já separa os throttlers `default` e `sensitive`, com fail-open e fail-closed quando o Redis cai; essa política não está no PRD e precisa ser confirmada na spec do RF-81.

4. **Configurar storage e e-mail locais (MinIO e Mailpit)**
   - Não há skill para este passo: implementar à mão e registrar isso na evidência.
   - Acrescentar ao `docker-compose.yml`, sem reescrever o que os passos 2 e 3 criaram: `minio` (API S3 e console, com volume) com `container_name` `hypomna-storage-minio`, e `mailpit` (SMTP e interface web) com `container_name` `hypomna-mail-mailpit`. Bucket inicial criado por um serviço de init (`mc mb --ignore-existing`), nunca à mão.
   - Variáveis em `apps/api/.env` e `.env.example`, validadas pelo schema de env do passo 1: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SMTP_URL`, `EMAIL_FROM`. Credenciais do MinIO no `.env` são só de desenvolvimento.
   - **Fora do escopo:** a porta `FileStorage` e o adaptador S3 (PRD §6.2), o prefixo `tenants/<tenantId>/…` e as URLs assinadas (PRD §3.2), e o envio de e-mail. Entram com as specs que os usam (capturas na Fase 3, importação na Fase 4, e-mails na Fase 1).
   - Aceite: `docker compose config` valida; os quatro serviços (`postgres`, `redis`, `minio`, `mailpit`) sobem com `docker compose up -d` e ficam saudáveis (exige Docker).

5. **Configurar autenticação (Better-Auth) na API e nos clientes**
   - Usar a skill `config-auth`, depois de 1 a 4 concluídos:
     - `node .claude/skills/config-auth/scripts/init-auth.js --dry-run`
     - `node .claude/skills/config-auth/scripts/init-auth.js --apply --install`
     - Conferir o `auth.model.prisma` gerado contra a versão instalada do Better-Auth (`pnpm exec @better-auth/cli generate`, comparando o resultado sem sobrescrever o arquivo) e ajustar à mão se divergir — a skill nunca o regenera depois de criado.
     - Remover `apps/api/prisma/models/bootstrap.model.prisma` (o modelo temporário da `config-prisma`, que a própria skill manda apagar quando existirem modelos reais).
     - Subir o Postgres (`pnpm --filter @hypomna/api run db:start`, exige Docker) e **rodar a migration** das tabelas de auth: `pnpm --filter @hypomna/api exec prisma migrate dev --name auth-init`, seguida de `pnpm --filter @hypomna/api run prisma:generate`. Citar na evidência o caminho da migration criada em `prisma/migrations/`.
   - Pré-requisitos reais: infra Prisma da `config-prisma` (schema modular, `PrismaService`, client em `src/generated/prisma`) e `SessionCacheService` da `config-redis`. O modelo `User` é criado por esta skill, em `prisma/models/auth.model.prisma`.
   - Cobre só a fundação (PRD §4.1, §6.2):
     - Better-Auth montado em `/api/auth/*`, login somente por e-mail e senha (sem provedor social);
     - `SessionGuard` (`401 { error, code: "UNAUTHORIZED" }`; a `message` traduzida do contrato de erro da §4 entra com o `ExceptionFilter` global, RF-63) e `@CurrentSession()`;
     - cache-aside de sessão via `SessionCacheService`, com invalidação no logout;
     - `platformRole` com `input: false` (nenhum fluxo público grava papel, CA-RF07-1);
     - sessão por **cookie** em `apps/web` e `apps/web-admin`; `apps/web-marketing` não recebe nada.
   - **Fora do escopo deste passo** (registrar como pendências na spec, todas da Fase 1 e com spec própria em `.docs/specs/identity/`):
     - cadastro com criação atômica de `Tenant`, `TenantMembership` (`OWNER`) e `TraderProfile` (RF-01) e o teste gratuito (RF-68);
     - `TenantGuard` e `TenantContext` nas três camadas (RF-04, §3.2);
     - `AdminGuard`, distinto do `TenantGuard`, no módulo `admin` (§3.3);
     - verificação de e-mail obrigatória (RF-02), recuperação e troca de senha (RF-05, RF-06), com a skill `emailAndPassword`;
     - TOTP do Admin (RF-07, CA-RF07-2), com a skill `twoFactor`;
     - bloqueio progressivo e rate limit de autenticação (RF-81) e hardening, com a skill `security`;
     - **isolamento de sessão entre `apps/web` e `apps/web-admin` (CA-RF03-2):** com uma instância do Better-Auth e o cookie no domínio da API, os dois apps compartilhariam a sessão no navegador. Decidir em ADR antes da spec de identidade (rewrite same-origin por app com `cookiePrefix` distinto, ou duas instâncias do Better-Auth);
     - **não usar o plugin `organization`**: o tenant é o `Tenant` do domínio (PRD §3.1), não uma organização do Better-Auth.
   - Passos manuais, a serem listados na spec e **executados pelo usuário**: gerar o `BETTER_AUTH_SECRET` real no `.env` do backend (nunca commitar); validar o login por e-mail e senha em `apps/web` e em `apps/web-admin`, confirmando que a sessão de um não vale no outro.
   - Regras: nunca usar middleware do Next.js nem verificação centralizada de sessão (`.claude/rules/auth-client.md`); não rodar o wizard da skill `create-auth` (não conhece NestJS); nunca configurar `secondaryStorage` (Redis não é fonte de verdade da sessão); `auth.ts` é regenerado a cada `--apply`, então não editá-lo à mão e não reexecutar a skill sem reincorporar mudanças.

## Observações Gerais

- **Sempre que possível, usar as skills** indicadas em cada passo.
- **Executar cada passo em um subagente distinto**, com contexto limpo, e **de forma sequencial**, respeitando a ordem (cada passo depende da conclusão do anterior).
- **A spec e os artefatos dela deverão ser escritos em Português/BR.** Código, nomes e testes em inglês (`.claude/rules/general.md`).
- **Escopo é infraestrutura, não RF.** Nenhum comportamento de RF entra por este bootstrap: tudo que tem cenário `CA-*` no PRD fica para a spec de feature aprovada correspondente, com o teste escrito antes do código (`.claude/rules/testing.md`). `packages/domain` (`Money`, `TickCalculator`), `packages/i18n` (catálogos nos três idiomas), o schema com RLS (`RF-00-schema`), o CI com os gates e os templates de spec e ADR são outras entregas da Fase 0.
- **Registrar as evidências a cada task**, dentro do próprio `tasks.md` da change, no formato definido em [Como executar](../../../openspec/specs/shared/como-executar.md) — o checkbox marcado seguido da evidência logo abaixo:

  ```md
  - [x] descrição da task
    > ✅ YYYY-MM-DD HH:MM — o que foi feito, decisões tomadas, desvios do plano
  ```

  Como o `.log/skills.log` das skills não é versionado, o texto da evidência deve citar o comando executado, os arquivos criados/alterados relevantes e as linhas `[RISK]`/`[FAIL]` que o log registrou. A spec deve referenciar `openspec/specs/shared/como-executar.md` e seguir `openspec/specs/shared/regras-de-nomenclatura.md` (nome da change e arquivos em `kebab-case`).

- **Migrations:** rodar somente quando houver modelo real a migrar. Neste bootstrap isso ocorre uma única vez, no passo 5 (tabelas de auth); os passos 1 a 4 não migram. Usar sempre `prisma migrate dev` (aplica só o que falta). **Nunca** `prisma migrate reset`, `db push --force-reset` ou qualquer comando que apague dados, e nunca contra um banco que não seja o local do `docker-compose.yml`. Migrations futuras de módulos de domínio seguem a mesma regra, sob demanda.
- **Nunca rodar `pnpm run dev`** para verificar as mudanças (`.claude/rules/general.md`); verificar com `check-types`, testes e `docker compose`.
- **Nenhum commit sem permissão explícita do usuário**; quando pedido, usar Conventional Commits e nunca `--no-verify`.
- Usar Context7 para documentação de bibliotecas e Serena para busca/edição de código por símbolo (`.claude/rules/mcps.md`).
- **Nomes "hypomna" no Docker/`.env`:** `container_name` do Postgres e do Redis é derivado do namespace pelas skills; o do MinIO e do Mailpit segue o mesmo padrão, à mão. Usuário, senha e nome do banco vêm do `DATABASE_URL`, que a `config-project` também deriva do namespace: conferir no passo 1, **antes** do passo 2 (o `docker-compose.yml` é criado uma única vez e nunca sobrescrito).

## Critério de conclusão

**A spec só termina quando todos os itens estiverem marcados (`- [x]`) e cada um tiver evidência registrada no formato acima.** Um checkbox marcado sem evidência não conta como concluído. Regras do [Como executar](../../../openspec/specs/shared/como-executar.md) que valem aqui:

- nunca remover uma task;
- se uma task não puder ser executada, registrar o motivo na evidência — ela continua na lista e a spec não é dada como concluída até ser resolvida ou o desvio ser aceito pelo usuário;
- quando a task indicar uma skill, usá-la como implementação principal; se ela não cobrir o caso inteiro, aplicá-la até onde fizer sentido e registrar o desvio na evidência;
- a spec inclui, além dos passos 0 a 5, as pendências e os passos manuais listados nos passos 1 a 5 (nome de `packages/tsconfig`, `packages/shared` da `config-prisma` fora do PRD §6.1, `RF-00-schema` com RLS e role de aplicação, política de degradação do rate limit, `FileStorage`, RF-01, `TenantGuard`, `AdminGuard`, RF-02/RF-05/RF-06, TOTP do RF-07, RF-81, ADR do isolamento de sessão (CA-RF03-2), `BETTER_AUTH_SECRET` real, login validado nos dois apps web). Os que dependem do usuário ficam como tasks e só são marcados depois que ele confirmar a execução.
