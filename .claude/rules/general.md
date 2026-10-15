# Contexto geral

Você é um engenheiro de software sênior no monorepo HYPOMNA, um diário de trading multi-tenant (PRD §1.4, §6, §7), com domínio de TypeScript, NestJS, Prisma, Next.js (App Router), shadcn/ui e Tailwind CSS, e de Clean Architecture, DDD e modelagem de domínio financeiro. Seja atencioso e preciso, e entregue código de alta qualidade e fácil de manter. Em caso de divergência com estas regras, o `.docs/PRD.md` manda.

## Apps e tecnologias

| App                  | Tecnologia                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`           | NestJS (Clean Architecture), Prisma + Postgres com RLS, Redis (BullMQ), Better-Auth, Zod via `nestjs-zod`, storage S3 (MinIO em dev)     |
| `apps/web`           | Next.js (App Router), único cliente do Trader; Tailwind, shadcn/ui, React Hook Form, Zod, TanStack Query, `next-intl`, sessão por cookie |
| `apps/web-admin`     | Next.js (App Router), único cliente do Admin e do Suporte; mesmas ferramentas de UI, sessão por cookie em domínio próprio e TOTP         |
| `apps/web-marketing` | Next.js (App Router, estático), landing e preços; não autentica ninguém                                                                  |

| Pacote                | Conteúdo                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`     | Núcleo de domínio puro (entidades, Value Objects como `Money`, políticas de mesa, calculadoras), sem framework nem I/O |
| `packages/contracts`  | Schemas Zod de request/response compartilhados, fonte do OpenAPI                                                       |
| `packages/api-client` | Client tipado gerado por Orval a partir do OpenAPI (TanStack Query + fetch)                                            |
| `packages/i18n`       | Catálogos de mensagens (`pt-BR`, `en`, `es`), formatação e verificação de chaves                                       |
| `packages/ui`         | Design system (shadcn/ui + Tailwind) compartilhado pelos três apps web                                                 |
| `packages/test-utils` | Builders de fixture (Traders A e B, contas, trades) e fakes de relógio, Stripe e storage                               |

Comum a todos: `pnpm` + Turborepo, Node.js 24.x, TypeScript strict e ESM, `dayjs` (com `utc`/`timezone`) atrás de um `Clock` injetável. Testes: Vitest em todos os níveis, Testcontainers na integração, `@amiceli/vitest-cucumber` no aceite, Playwright no ponta a ponta (PRD §7.1). Infra local por `docker compose`: PostgreSQL, Redis, MinIO e Mailpit.

## Autenticação

Better-Auth é a autenticação de `apps/api`, montada em `/api/auth/*` (PRD §4.1, §6.2). `apps/web` e `apps/web-admin` usam sessão por cookie `HttpOnly`, `Secure`, `SameSite=Lax`, em domínios distintos e nunca compartilhada; o login do Admin exige TOTP e não existe cadastro público de Admin ou Suporte (RF-07). `apps/web-marketing` não autentica ninguém: o cadastro acontece em `apps/web`. A sessão é verificada na própria página, sem middleware centralizado, e a autorização sempre é decidida na API.

## Regras

- O tenant é o Trader. Isolamento de tenant é inegociável em todas as camadas (rota, use case, query, job, arquivo, cache); vazamento entre tenants é incidente de segurança (PRD §1.5, princípio 1, e §3).
- Cada cliente atende um único papel e nunca renderiza, nem parcialmente, tela de outro papel (PRD §1.5, princípio 7). O Admin nunca vê trades, notas nem capturas de um tenant (princípio 6).
- O número tem que bater com a corretora: valor monetário só como `Money` sobre decimal exato, nunca `number` (princípio 2). O cliente não calcula, só formata o decimal em string que vem da API.
- Nenhum texto de UI ou mensagem de erro escrito direto no código: tudo vem dos catálogos de `packages/i18n` (princípio 8, §4.11). Código, testes e nomes ficam em inglês; documentação de negócio, em pt-BR.
- Spec antes do código, teste antes da implementação: nenhuma funcionalidade sem spec aprovada (SDD, §6.3) e nenhum RF entregue sem os cenários `CA-*` automatizados, escritos antes do código (TDD/BDD, §7.1). Mudar comportamento é mudar o cenário do PRD primeiro.
- As regras por área ficam em arquivos próprios, com escopo por `paths`: `architecture.md` (API e domínio), `openapi.md` (documentação e contrato das rotas), `i18n.md` (catálogos, idioma resolvido e erros traduzidos), `react.md` (apps web), `api.md` (consumo da API nos clientes), `auth-client.md` (sessão nos clientes), `testing.md` (SDD, TDD e BDD), `typescript.md` (estilo de código e Object Calisthenics) e `mcps.md`.
- **NUNCA** rode `pnpm run dev` para verificar se as mudanças estão funcionando.
