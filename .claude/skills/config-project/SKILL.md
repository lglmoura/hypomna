---
name: config-project
description: 'Inicializar ou continuar o monorepo Turborepo do HYPOMNA na topologia do PRD §1.4/§6.1: backend NestJS (`apps/api`, sem git interno) e três clientes Next.js, cada um atendendo exatamente um papel — `web` (Trader), `web-admin` (Admin e Suporte) e `web-marketing` (Visitante, sem login) — definidos pela lista `apps` do `skills.config.json` (ou `--app next:<path>:<port>[:<auth>]`). Usa `pnpm`, reconcilia a base via `npx create-turbo@latest` no diretório atual (sem copiar os projetos de exemplo `apps/*` e `packages/ui`) e aplica setup idempotente. Inclui git hooks (Husky: `pre-commit` com lint-staged + ESLint + Prettier; `pre-push` com check-types + test:cov, gates da PRD §7.1), confere o `tsconfig.json` de cada app contra um baseline fixo e valida com `pnpm run check-types`. Configura o Zod v4 (schema de env em todos os apps e `ZodValidationPipe` de `nestjs-zod` no backend), o ferramental de testes da PRD §7.1 (Vitest com coverage `v8` e `@amiceli/vitest-cucumber` em `apps/api` e nos apps Next) e o `pnpm test:trace` (RF-86). Cria os esqueletos dos pacotes internos do PRD §6.1 (`domain`, `contracts`, `i18n`, `test-utils`, `api-client`, `ui`) e fixa o runtime Node.js (`engines.node` + `engine-strict=true`). Usar quando o pedido envolver bootstrap do monorepo, setup inicial Next + Nest, reaplicação segura do setup, padronização de `test`/`build` no Turbo, `tsconfig.json` dos apps, Zod, Vitest, pacotes compartilhados, versão do Node ou hooks de commit.'
---

# Config Project

## Overview

Executar um script determinístico e idempotente para o bootstrap do monorepo HYPOMNA (PRD §6.1).
O sistema é **multi-tenant**: o tenant é o Trader (PRD §3.1) e o isolamento é inegociável (princípio 1, §1.5) — mas isso é regra de modelagem, de queries e de RLS do backend (spec `RF-00-schema`), não configuração de ambiente: o bootstrap não cria flag de "modo de tenancy".
O fluxo usa `npx create-turbo@latest` para gerar a base padrão do Turborepo (configs compartilhadas, `.gitignore`, `.npmrc`) e reconcilia apenas o que estiver faltando na pasta atual.
Se `.git` já existir no diretório atual, o scaffold é executado com `--no-git`.

**Topologia (PRD §1.4, §6.1; princípio 7 — "cada papel tem um app, e só um")** — `apps` em `skills.config.json`:

| App                  | `kind` | Papel                                         | Auth (PRD §4.1, §6.2) |
| -------------------- | ------ | --------------------------------------------- | --------------------- |
| `apps/api`           | Nest   | backend único, consumido por todos            | —                     |
| `apps/web`           | `next` | Trader                                        | `cookie`              |
| `apps/web-admin`     | `next` | Admin e Suporte da Plataforma                 | `cookie` (+ TOTP)     |
| `apps/web-marketing` | `next` | Visitante (landing e preços), sem login       | `none`                |

Não há app mobile na v1 (PRD §1.6): o único `kind` aceito é `next`.

Pacotes (PRD §6.1): `packages/eslint-config` e `packages/typescript-config` vêm do template do Turbo (o PRD chama o segundo de `tsconfig`; a skill mantém o nome do template porque os demais pacotes o referenciam). Os demais são criados como **esqueleto** (`package.json`, `tsconfig.json` e `src/index.ts` com `export {}`), sem build próprio:

| Pacote                | Consumido por        | tsconfig base        | Dependências do bootstrap |
| --------------------- | -------------------- | -------------------- | ------------------------- |
| `packages/domain`     | API e apps           | `base.json`          | —                         |
| `packages/contracts`  | API e apps           | `base.json`          | `zod@^4`                  |
| `packages/i18n`       | API e apps           | `base.json`          | —                         |
| `packages/test-utils` | testes               | `base.json`          | —                         |
| `packages/api-client` | apps Next            | `react-library.json` | peer `react`              |
| `packages/ui`         | apps Next            | `react-library.json` | peer `react`, `react-dom` |

O conteúdo desses pacotes (`Money`, `TickCalculator`, catálogos, schemas, client Orval, design system, builders de fixture) nasce das specs de feature aprovadas (SDD, PRD §6.3) e de outros prompts, nunca deste bootstrap.

Todo o fluxo usa `pnpm` como gerenciador (`create-turbo --package-manager pnpm`, `create-next-app --use-pnpm`, `nest new --package-manager pnpm`, `pnpm add`).
O bootstrap incorpora o comportamento da skill [`setup-pre-commit`](../setup-pre-commit/SKILL.md), adaptado ao monorepo: Husky + lint-staged + ESLint + Prettier na raiz (`eslint` como dependência da raiz para o lint-staged rodar `eslint --fix` nos arquivos staged de qualquer app — a config continua vindo de `packages/eslint-config`), `pre-commit` só com lint-staged e `pre-push` com `check-types` e `test:cov` via Turbo — os gates da PRD §7.1.
As configurações padrão são lidas de `skills.config.json` em `.claude/skills/.env/` (ou `.agents/skills/.env`, ou a raiz do repositório — ver `../utils/resolve-skill-config.mjs`).

## Workflow

1. Ler `namespace`, `backendAppPath` (padrão `apps/api`), `backendPort`, `backendPortEnvVar` e a lista `apps` (cada item: `kind`, `path`, `port`, `apiUrlEnvVar`, `auth`) do `skills.config.json`. `--app next:<path>:<port>[:<auth>]` (repetível) substitui a lista.
2. Detectar lacunas da estrutura Turbo; quando necessário, executar `npx create-turbo@latest --package-manager pnpm` num diretório temporário, **descartar** `apps/*` e `packages/ui` do template (no Hypomna `apps/web` e `packages/ui` são projetos reais com os mesmos nomes; copiar o exemplo e apagá-lo depois é o caminho que já destruiu um app real — incidente de 2026-09-04) e copiar só o que falta (`packages/eslint-config`, `packages/typescript-config`, `.gitignore`, `.npmrc`, configs base).
3. Remover projetos de exemplo do Turbo que já estejam no disco por execuções antigas: `apps/docs` e `packages/ui` quando forem o template. Um `apps/web` que já seja app Next válido nunca é removido, mesmo que seja o do template (o guard de segurança tem precedência sobre a heurística); nesse caso, conferir à mão.
4. Para cada app `next`, criar com `create-next-app --use-pnpm --src-dir` somente se o caminho ainda não existir como app Next.js.
5. Criar o backend com `nest new --skip-git --package-manager pnpm` somente se `backendAppPath` ainda não existir como app NestJS.
6. Garantir o namespace em todos os projetos do workspace (`apps/*`, `modules/*`, `packages/*`) — **antes** dos pacotes internos, porque eles rodam `pnpm add <scope>/typescript-config@workspace:*`.
7. Criar os seis pacotes internos da tabela acima quando ainda não existirem (pacote existente nunca é tocado).
8. Instalar apenas dependências faltantes com `pnpm add` (`turbo`, `ts-node`, `prettier`, `husky`, `lint-staged` e `eslint` na raiz; `dotenv` no backend).
9. Atualizar o `package.json` raiz (`packageManager: pnpm@latest`, `engines.node = ">=24"`, scripts `check-types`, `test`, `test:cov`, `test:trace`, `format`, `prepare`), garantir `.prettierrc` e atualizar `turbo.json` de forma incremental (tasks `check-types`, `test` e `test:cov`).
10. Garantir `engine-strict=true` no `.npmrc` raiz (upsert, preservando as demais linhas).
11. Ajustar `next.config.ts|js|mjs` de cada app para liberar `images.remotePatterns` em `http`/`https` (idempotente).
12. Garantir o script `check-types` (`tsc --noEmit`) em cada app e `tsc --noEmit -p tsconfig.json` no backend.
13. Reconciliar o `tsconfig.json` de cada app com o baseline (idempotente, preservando as demais chaves):

    ```json
    {
      "$schema": "https://json.schemastore.org/tsconfig",
      "compilerOptions": {
        "module": "nodenext",
        "moduleResolution": "nodenext",
        "target": "es2024",
        "skipLibCheck": true,
        "strict": true,
        "outDir": "./dist"
      },
      "include": ["src"]
    }
    ```

    - Backend (Node): baseline completo; se o `tsconfig.json` não existir, é criado com esse conteúdo.
    - Apps Next.js: só o subconjunto compatível (`target`, `skipLibCheck`, `strict`), porque `module`/`moduleResolution` são do bundler e o app não emite para `outDir`.
    - Flags da família `strict` declaradas como `false` são removidas para que `strict: true` valha de fato.
    - Os pacotes internos ficam fora: estendem `<namespace>/typescript-config/*.json` diretamente.

14. Configurar o [Zod](https://zod.dev/) (major 4, `pnpm add zod@^4`) em todos os apps:
    - apps Next: `src/lib/env.ts` com o schema das variáveis públicas (`<apiUrlEnvVar>` com `z.url()`), lendo cada chave explicitamente por causa da substituição de `NEXT_PUBLIC_*` em build;
    - backend: `nestjs-zod`, `src/config/env.ts` (`NODE_ENV`, `<backendPortEnvVar>`, `DATABASE_URL`, `BETTER_AUTH_SECRET`; as skills seguintes acrescentam as suas variáveis) e `src/common/pipes/zod-validation.pipe.ts`, que reexporta o `ZodValidationPipe` de `nestjs-zod`;
    - arquivos só são criados quando ausentes.
15. Configurar o ferramental de testes da **PRD §7.1**: Vitest em `apps/api` e nos apps Next (coverage `v8`; `vitest.config.ts` + `vitest.setup.ts` nos apps; `vitest.e2e.config.ts` com Supertest no backend para API e aceite — `test/**/*.e2e-spec.ts`), removendo o Jest do `nest new` (`jest`, `ts-jest`, `@types/jest`, `jest-mock` e o bloco `jest`). **BDD:** `@amiceli/vitest-cucumber` em todos, com a versão escolhida pela major do `vitest`; os `.feature` (pt-BR) ficam em `test/features/<módulo>/RF-<nn>.feature` com os passos em `RF-<nn>.steps.e2e-spec.ts` (API) ou `RF-<nn>.steps.test.ts(x)` (apps). Scripts `test`/`test:watch`/`test:cov` (e `test:e2e` no backend); arquivos só são criados quando ausentes.
16. Atualizar `.env` e `.env.example` de cada app e do backend por upsert (sem apagar chaves extras). Cada cliente recebe `<apiUrlEnvVar>` e `PORT`. O backend recebe a porta, `DATABASE_URL` **derivado do namespace** (`@hypomna` → `postgresql://hypomna:hypomna@localhost:5432/hypomna?schema=public`, credencial só de desenvolvimento) e `BETTER_AUTH_SECRET` como placeholder. `DATABASE_URL` e `BETTER_AUTH_SECRET` só entram quando ausentes: reexecutar a skill nunca devolve o placeholder ao segredo real nem desfaz um `DATABASE_URL` ajustado.
17. Ajustar o `main.ts` do backend de forma incremental (`dotenv/config`, `import './config/env.js'` quando o módulo existir, `app.enableCors()`, porta via `backendPortEnvVar`). A `config-auth` substitui o CORS aberto pela lista de origens dos clientes com cookie.
18. Configurar os git hooks e a rastreabilidade: `.husky/pre-commit` (`pnpm exec lint-staged`), `.husky/pre-push` (`pnpm run check-types` e `pnpm run test:cov`), `.lintstagedrc` (`eslint --fix` e `prettier --write` em código; `prettier --ignore-unknown --write` no resto), cópia de `assets/test-trace.mjs` para `scripts/test-trace.mjs` (`pnpm test:trace`, RF-86) e `pnpm exec husky`.
19. Registrar a execução em `.log/skills.log`, garantindo `.log/` no `.gitignore`.
20. Formatar o projeto com `pnpm run format`.
21. Conferir a tipagem com `pnpm run check-types` na raiz. A falha é reportada como aviso, sem abortar o bootstrap já aplicado.

## Commands

Fluxo padrão:

```bash
node .claude/skills/config-project/scripts/project-init.mjs
```

Pular a instalação global do Nest CLI (forçar `npx`):

```bash
node .claude/skills/config-project/scripts/project-init.mjs --skip-global-nest
```

Customizar backend e porta:

```bash
node .claude/skills/config-project/scripts/project-init.mjs \
  --backend-path apps/api \
  --backend-port 4000
```

Substituir a lista de clientes (repetível; formato `next:<path>:<port>[:<auth>]`, `auth` `cookie` ou `none`):

```bash
node .claude/skills/config-project/scripts/project-init.mjs \
  --app next:apps/web:3000:cookie \
  --app next:apps/web-admin:3001:cookie \
  --app next:apps/web-marketing:3002:none
```

Sobrescrever o namespace por CLI:

```bash
node .claude/skills/config-project/scripts/project-init.mjs --scope @hypomna
```

## Resources

- `scripts/project-init.mjs`: script principal de bootstrap.
- `references/bootstrap-contract.md`: contrato dos arquivos e alterações que o bootstrap aplica.
- `assets/test-trace.mjs`: modelo de `scripts/test-trace.mjs` (rastreabilidade PRD ↔ teste, RF-86), copiado só quando ausente.
- `../setup-pre-commit/SKILL.md`: skill genérica de origem (Husky + lint-staged + ESLint + Prettier), incorporada neste bootstrap; usar isolada só fora do padrão Turborepo desta skill.
- `../.env/skills.config.json`: defaults do projeto (namespace, backend e lista `apps`).
- Log local: `.log/skills.log` (não versionado).

## Git

- **SEMPRE** use [Conventional Commits](https://www.conventionalcommits.org/). Exemplo: `feat: add trader registration`, `fix: tick value rounding`, `docs: update architecture rules`.
- **NUNCA** faça commit sem a permissão explícita do usuário.

## MCPs

- **SEMPRE** use Context7 para buscar documentações.
- **SEMPRE** use Serena para busca e edição de código por símbolo.

## Risk Logging Guardrails

- Registrar fatos de execução em `.log/skills.log` com marcador no início da linha.
- Marcadores mínimos: `[CMD]`, `[FILE_CREATE]`, `[FILE_UPDATE]`, `[FILE_DELETE]`, `[DIR_CREATE]`, `[RISK]`, `[FAIL]`, `[AI]`.
- Sempre registrar `[RISK]` em sobrescrita, exclusão, rename/move ou fallback forçado.
- Toda falha inesperada gera `[FAIL]` com descrição factual curta.
- Operações de terminal e de arquivo passam pelos utilitários de `../utils`.

## Versões

O PRD fixa só Node.js 24.x (§6.1). O script usa `create-next-app@latest` e `nest new`/`@nestjs/cli@latest`, ou seja, as versões correntes. Depois que os apps existem, o script não os recria.

## Reparos de bootstrap que o script aplica sozinho

- **Projetos de exemplo do Turbo.** Nunca são copiados (passo 2). Se um `apps/web` antigo do template ainda declarar `@repo/ui`, a dependência órfã é removida dos `package.json` e os arquivos que ainda a importam são listados como `[RISK]` (o import não é apagado por heurística).
- **Ordem entre namespace e pacotes internos.** Os pacotes rodam `pnpm add <scope>/typescript-config@workspace:*`, que só resolve depois do rename — por isso o namespace vem antes.
- **Referências fora do `package.json`.** Aplicar o namespace também reescreve `extends` de `tsconfig.json` e imports de config/código (ex.: `@repo/eslint-config/next`).
- **`allowBuilds` do pnpm 11.** Pacotes com build nativo são pré-aprovados no `pnpm-workspace.yaml`, e placeholders `set this to true or false` são resolvidos para `true` — sem isso o install aborta com `ERR_PNPM_IGNORED_BUILDS`.
- **`test:trace` com a §11 do Hypomna.** A coluna "Testes" da §11 usa `—` para RF não entregue; o script trata `—`, `-`, vazio e `_(a criar …)_` como pendente.
