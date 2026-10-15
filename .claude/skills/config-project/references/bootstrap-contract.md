# Turborepo HYPOMNA Bootstrap Contract

## Goal

Padronizar o bootstrap do monorepo Turborepo do HYPOMNA (PRD §1.4, §6.1), multi-tenant, com:

- `<backendAppPath>` (NestJS sem git interno) — backend único, consumido por todos os clientes
- um app Next.js por item de `apps` em `skills.config.json`, cada um atendendo exatamente um papel (PRD princípio 7, §1.5):
  - `apps/web` — Trader
  - `apps/web-admin` — Admin e Suporte da Plataforma
  - `apps/web-marketing` — Visitante (landing e preços), sem login
- os esqueletos de `packages/domain`, `packages/contracts`, `packages/i18n`, `packages/test-utils`, `packages/api-client` e `packages/ui` (PRD §6.1)

Todo o bootstrap usa `pnpm` (scaffold, criação de apps e instalação de dependências).

Defaults de `skills.config.json` (`.claude/skills/.env/`):

- `namespace` (padrão: `@namespace`; neste repositório `@hypomna`)
- `backendAppPath` (padrão: `apps/api`), `backendPort` (padrão: `4000`), `backendPortEnvVar` (padrão: `PORT`)
- `sharedModulePath` (padrão: `packages/shared`, usado pela `config-prisma`)
- `apps[]`, cada item com:
  - `kind`: `next` (único aceito; não há app mobile na v1, PRD §1.6)
  - `path`: caminho do workspace (último segmento `^[a-z][a-z0-9-]*$`; vira o nome do app)
  - `port`: porta do dev server (única entre os apps)
  - `apiUrlEnvVar`: padrão `NEXT_PUBLIC_API_URL` (o Next só inlina em build time `NEXT_PUBLIC_*`)
  - `auth`: `cookie` | `none` (padrão: `cookie`) — consumido pela `config-auth`

Padrão do repositório: `web:3000` (cookie), `web-admin:3001` (cookie), `web-marketing:3002` (none). Override por CLI: `--app next:<path>:<port>[:<auth>]` (repetível, substitui a lista).

## Steps Applied

1. Detectar ausência ou incompletude da estrutura Turbo e, quando necessário, executar `npx create-turbo@latest --package-manager pnpm` num diretório temporário (com `--no-git` se o root já tiver `.git`).
2. Descartar do template, ainda no diretório temporário, `apps/*` e `packages/ui`: no Hypomna `apps/web` e `packages/ui` são projetos reais com os mesmos nomes dos exemplos do Turbo, e copiar o exemplo para apagá-lo depois foi o que destruiu um app real (incidente de 2026-09-04). Reconciliar no repositório só os itens ausentes do restante do template (`.gitignore`, `.npmrc`, `packages/eslint-config`, `packages/typescript-config` e demais configs), sem sobrescrever nada.
3. Limpar projetos de exemplo de execuções antigas: `apps/docs` e `packages/ui` quando detectados como template original. Um app configurado que já é app Next.js válido nunca é removido por essa limpeza.
4. Para cada app `next`: `npx create-next-app@latest <name> --yes --use-pnpm --src-dir`, somente se o app Next.js ainda não existir.
5. Criar `<backendAppPath>` com `nest new <backendName> --skip-git --package-manager pnpm` (ou `npx @nestjs/cli@latest`), somente se o app NestJS ainda não existir.
6. Garantir o `name` `<namespace>/<nome>` em todos os projetos do workspace (`apps/*`, `modules/*`, `packages/*`), reescrevendo também `extends` de `tsconfig.json` e imports de config/código — antes dos pacotes internos.
7. Criar cada pacote interno quando ainda não houver `package.json` no caminho (pacote existente nunca é tocado): `package.json` (`type: module`, `exports`/`main`/`types` direto para `src/index.ts`, script `check-types`), `tsconfig.json` estendendo `<namespace>/typescript-config/base.json` (`domain`, `contracts`, `i18n`, `test-utils`, consumidos pela API em `nodenext`) ou `react-library.json` (`api-client`, `ui`, consumidos só pelos apps Next) com `noEmit`, e `src/index.ts` com `export {};`. Dependências via `pnpm add`: `typescript` e `<namespace>/typescript-config@workspace:*` em todos; `zod@^4` em `contracts`; `@types/react` e `peerDependencies` de `react` (e `react-dom` em `ui`) nos pacotes React. O conteúdo vem das specs de feature, não do bootstrap.
8. Instalar apenas dependências faltantes com `pnpm add`:
   - root: `turbo`, `ts-node`, `prettier`, `husky`, `lint-staged` e `eslint` (dev) — `eslint` na raiz para o lint-staged rodar `eslint --fix` em qualquer app; a config continua vindo de `packages/eslint-config`;
   - backend: `dotenv`.
9. Atualizar o `package.json` root: `name` (default `<namespace>/workspace`), `private`, `workspaces` (`apps/*`, `modules/*`, `packages/*`), `packageManager` (`pnpm@latest` quando ausente), `engines.node = ">=24"` quando ausente (PRD §6.1), scripts `test` (`turbo run test`), `test:cov` (`turbo run test:cov`), `test:trace` (`node scripts/test-trace.mjs`), `format`, `check-types` (`turbo run check-types`) e `prepare` (`husky`).
10. Garantir `engine-strict=true` no `.npmrc` da raiz (upsert, preservando as demais linhas).
11. Garantir `.prettierrc` na raiz.
12. Atualizar `turbo.json`: `test` e `test:cov` sem cache e com `outputs` `coverage/**`; `build.outputs` com `dist/**`; `check-types.dependsOn` com `^check-types`.
13. Atualizar o `next.config.ts|js|mjs` de cada app com `images.remotePatterns` para `https` e `http` com `hostname: "**"` (incremental).
14. Garantir `scripts["check-types"]` em cada app: `tsc --noEmit` nos apps, `tsc --noEmit -p tsconfig.json` no backend.
15. Reconciliar o `tsconfig.json` de cada app com o baseline:

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

    - Backend: baseline completo; criado com esse conteúdo quando ausente.
    - Apps Next: só `target`, `skipLibCheck` e `strict` (`module`, `moduleResolution`, `outDir`, `include` e `extends` são do bundler e não são tocados).
    - Pacotes internos: fora desta reconciliação.
    - Flags da família `strict` declaradas como `false` são removidas. As demais chaves são preservadas; comentários e vírgulas finais são tolerados na leitura, mas o arquivo é reescrito como JSON puro.

16. Configurar o [Zod](https://zod.dev/):
    - `zod@^4` em cada app e no backend; `nestjs-zod` no backend.
    - `<appPath>/src/lib/env.ts`: `z.object({ <apiUrlEnvVar>: z.url() })` com `safeParse` sobre objeto literal (a chave `NEXT_PUBLIC_*` precisa ser referenciada explicitamente) e export de `env` e `Env`.
    - `<backendAppPath>/src/config/env.ts`: `NODE_ENV`, `<backendPortEnvVar>` (`z.coerce.number()`), `DATABASE_URL` (`z.url()`) e `BETTER_AUTH_SECRET`, lançando erro com a lista de issues — "ausência falha o boot" (PRD §7). As demais variáveis do PRD §7 entram pelas skills e specs que as usam. Não há variável de "modo de tenancy".
    - `<backendAppPath>/src/common/pipes/zod-validation.pipe.ts`: reexporta o `ZodValidationPipe` de `nestjs-zod`.
    - Arquivos só são criados quando ausentes.

17. Configurar o ferramental de testes da **PRD §7.1**:
    - Vitest em `<backendAppPath>` e nos apps Next (substitui o Jest do `nest new`, que é removido junto com o bloco `jest`): `vitest.config.ts` (coverage `v8`), `vitest.setup.ts` nos apps (`@testing-library/jest-dom/vitest`) e `vitest.e2e.config.ts` no backend (Supertest, `include: test/**/*.e2e-spec.ts`); scripts `test`/`test:watch`/`test:cov` (e `test:e2e` no backend).
    - BDD: `@amiceli/vitest-cucumber` em todos, `@^7` para Vitest 4 ou `@^8` para Vitest 5 (a peerDependency exige a major exata). `.feature` (pt-BR) em `test/features/<módulo>/RF-<nn>.feature`, passos ao lado (`RF-<nn>.steps.e2e-spec.ts` na API, `RF-<nn>.steps.test.ts(x)` nos apps), com `loadFeature('./RF-<nn>.feature', { language: 'pt' })` direto no arquivo de teste.
    - Um teste do schema de env de cada app, criado junto com o módulo de env.
    - Arquivos só são criados quando ausentes.

18. Atualizar env files por upsert (preservando chaves extras):
    - cada app: `<apiUrlEnvVar>=http://localhost:<backendPort>` e `PORT=<port do app>`;
    - backend: `<backendPortEnvVar>=<backendPort>`, `DATABASE_URL` derivado do namespace (`postgresql://<nome>:<nome>@localhost:5432/<nome>?schema=public`, `<nome>` = namespace sem `@`) e `BETTER_AUTH_SECRET` placeholder. `DATABASE_URL` e `BETTER_AUTH_SECRET` só são gravados quando ausentes; o valor existente nunca é trocado.

19. Atualizar `<backendAppPath>/src/main.ts`: `import "dotenv/config"`, `import './config/env.js'` quando o módulo de env existir, `app.enableCors()` e porta por `process.env.<backendPortEnvVar>`.

20. Git hooks e rastreabilidade na raiz:
    - `.husky/pre-commit`: `pnpm exec lint-staged`;
    - `.husky/pre-push`: `pnpm run check-types` e `pnpm run test:cov`;
    - `.lintstagedrc`: `{ "*.{js,jsx,ts,tsx,mjs,cjs}": ["eslint --fix", "prettier --write"], "*": "prettier --ignore-unknown --write" }`;
    - `scripts/test-trace.mjs` copiado de `assets/test-trace.mjs` quando ausente: compara os `**CA-RF<nn>-<k>**` do PRD com as tags `@CA-…` dos `.feature` e os IDs nos títulos dos testes; com `--strict`, falha se um RF marcado como entregue na coluna "Testes" da §11 (qualquer valor diferente de `—`, `-`, vazio ou `_(a criar …)_`) tiver cenário sem teste, ou se um teste citar um ID que o PRD não tem (RF-86);
    - `pnpm exec husky` para ativar os hooks.

21. Formatar (`pnpm run format`) e conferir a tipagem com `pnpm run check-types` na raiz. A falha é reportada como aviso e não desfaz o bootstrap.

## Notes

- O script é idempotente: reexecutar pula etapas já atendidas e não recria nem remove nenhum app. Mesmo assim, o `config-project` não tem `--dry-run`: rode-o uma vez e confira o `git status` antes de qualquer reexecução.
- Se um diretório de app existir sem ser do tipo esperado (Next/Nest), o processo falha para evitar sobrescrita.
- O isolamento de tenant (PRD §3.2) é regra de modelagem, queries, RLS, jobs, arquivos e cache — não deste bootstrap.
- O baseline de TypeScript é aplicado por merge: o `tsconfig.json` só é gravado quando alguma chave diverge.
- Os módulos gerados (`env.ts`, `zod-validation.pipe.ts`, `packages/*/src/index.ts`) são pontos de partida e nunca são reescritos.
- Os hooks exigem `.git` no root; `pnpm exec husky` pode rodar várias vezes.
- `allowBuilds` do `pnpm-workspace.yaml`: pacotes com build nativo das skills seguintes (`prisma`, `@prisma/engines`, `msgpackr-extract`) são pré-aprovados aqui; `config-prisma`, `config-redis` e `config-auth` também resolvem isso sozinhas (`utils/ensure-pnpm-allow-builds.mjs`).
- O `apps/api` só passa em `check-types` depois de `prisma generate` (o client em `src/generated/prisma` não é versionado): em CI e clones novos, rode `pnpm --filter <api> run prisma:generate` antes de `check-types`/`build`.
