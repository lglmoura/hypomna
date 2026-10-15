## Context

Ver `proposal.md` (Why). Estado atual observado: o repositório tem só `.docs/`, `.claude/` (regras e skills), `openspec/` e `README.md`; não existe `package.json`, app nem pacote. `.claude/skills/.env/skills.config.json` já traz `namespace: "@hypomna"`, `backendAppPath: "apps/api"`, `backendPort: 4000`, `sharedModulePath: "packages/shared"` e os três clientes Next (`web` 3000 `cookie`, `web-admin` 3001 `cookie`, `web-marketing` 3002 `none`). O `.gitignore` já ignora `.env` e `.log/` e reabre só `skills.config.json`.

Restrições que moldam a abordagem: as skills são scripts determinísticos com `--dry-run`/`--apply` (exceto `config-project`, sem `--dry-run`); a ordem é fixa (1 → 5) porque cada passo consome o que o anterior gerou; nenhuma verificação usa `pnpm run dev` (`.claude/rules/general.md`).

## Goals / Non-Goals

**Goals:**

- Executar os passos 0–5 do prompt na ordem, cada um em um subagente com contexto limpo, sequencialmente.
- Deixar cada passo verificável por comando (`check-types`, testes, `docker compose config/up`, `prisma generate`, `migrate dev`), com evidência no `tasks.md`.
- Registrar todo desvio entre skill, prompt e PRD como task de pendência, em vez de decidir em silêncio.

**Non-Goals:**

- Qualquer RF com cenário `CA-*` (RF-01 a RF-07, RF-68, RF-81 etc.); `packages/domain` com `Money`/`TickCalculator`; catálogos de `packages/i18n`; `RF-00-schema` com RLS; CI com gates; templates de spec e ADR — outras entregas da Fase 0/1.
- Porta `FileStorage`, adaptador S3, URLs assinadas e envio de e-mail.
- Filas BullMQ de negócio (`--queue`).

## Decisions

1. **Skills como implementação principal, MinIO/Mailpit à mão.** Os passos 1, 2, 3 e 5 usam `config-project`, `config-prisma`, `config-redis` e `config-auth`; o passo 4 não tem skill e é editado à mão no `docker-compose.yml`. Alternativa descartada: escrever tudo à mão — perderia a idempotência e as convenções que as skills já codificam.
2. **`config-project` roda uma única vez e `setup-pre-commit` não roda.** A skill não tem `--dry-run` e já apagou apps ao ser reexecutada (incidente kynesa 2026-09-04); por isso o passo 0 exige `git status` limpo, para que qualquer estrago seja recuperável. Os hooks já vêm da `config-project`; rodar `setup-pre-commit` geraria configs concorrentes de ESLint/lint-staged.
3. **Conferir `DATABASE_URL` antes do passo 2.** O `docker-compose.yml` é criado uma vez pela `config-prisma` a partir do `DATABASE_URL`; um valor errado no passo 1 viraria credencial errada permanente no compose.
4. **Sem `--module auth` na `config-prisma`.** `auth.model.prisma` pertence à `config-auth`; sem `--module`, nasce o `bootstrap.model.prisma` temporário, removido no passo 5.
5. **Uma única migration, no passo 5, com `prisma migrate dev --name auth-init`.** Antes disso não há modelo real. Comandos destrutivos estão proibidos, **inclusive o passo 6 do workflow do `SKILL.md` da `config-prisma`** (que cita `prisma migrate reset`) — esse trecho não é seguido.
6. **Uma instância Redis com `noeviction`.** Segue o PRD §6.2/§7 e a `config-redis`. O `SKILL.md` da `config-prisma` ainda menciona "dois Redis (`redis-queue` e `redis-cache`)": texto herdado do kynesa, ignorado aqui e registrado como correção da skill.
7. **Bucket por serviço de init (`mc mb --ignore-existing`).** Idempotente e reproduzível; criação à mão não seria.
8. **`auth.model.prisma` conferido contra o CLI do Better-Auth instalado** (`pnpm exec @better-auth/cli generate` para arquivo temporário, comparando sem sobrescrever), porque a skill nunca o regenera depois de criado.
9. **Versões atuais, sem pinar**, exceto Node 24.x, PostgreSQL 16+ e Redis 7+ (PRD). Documentação de bibliotecas via Context7 durante a execução.
10. **Infraestrutura local própria, coexistindo com outros projetos.** Decisão do usuário durante o apply: a máquina já roda o kynesa nas portas 5432, 6379, 9000 e 9001, e o Hypomna não pode reutilizar nem parar os containers dele. O compose usa `name: hypomna` e portas de host próprias (Postgres 5433, Redis 6381, MinIO 9010/9011, Mailpit 1025/8025); as portas internas dos containers não mudam. `DATABASE_URL`, `REDIS_URL` e `S3_ENDPOINT` locais seguem essas portas. Alternativas descartadas: parar o outro projeto (interfere em trabalho alheio) e portas parametrizáveis por variável (mais configuração sem ganho no dev local).
11. **MinIO pela imagem do Chainguard, fixada por digest.** As imagens oficiais `minio/minio` e `minio/mc` deixaram de ser publicadas para pull. `cgr.dev/chainguard/minio` e `cgr.dev/chainguard/minio-client` trazem `minio`, `mc` e `/bin/sh`; a tag `latest` é fixada pelo digest para reprodutibilidade.
12. **Nomes de capability em inglês (`platform/*`, `identity/*`)**, alinhados aos diretórios `.docs/specs/platform` e `.docs/specs/identity` do PRD; conteúdo em pt-BR.

## Risks / Trade-offs

- [Reexecução da `config-project` apaga apps] → executar uma vez; `git status` limpo antes; nunca repetir sem diff revisado.
- [Os artefatos desta change deixam o `git status` sujo, contrariando o passo 0] → o usuário commita a change (com permissão explícita) antes de iniciar o apply.
- [`check-types` falha no monorepo recém-criado por versões `latest` incompatíveis] → a skill registra como aviso; a evidência cita a falha e a task de correção fica aberta.
- [`auth.model.prisma` divergente da versão instalada do Better-Auth] → comparação do passo 8 e ajuste à mão antes da migration.
- [Sessão compartilhada entre `web` e `web-admin` no domínio da API (CA-RF03-2)] → não resolvido aqui; ADR obrigatório antes da spec de identidade.
- [Rate limit fail-open/fail-closed não está no PRD] → pendência para a spec do RF-81.
- [`DATABASE_URL` de migration e da aplicação vão divergir quando a `RF-00-schema` criar a role sem `BYPASSRLS`] → consequência prevista, tratada naquela spec.
- [`packages/shared` (criado pela `config-prisma`) e `typescript-config` fora do PRD §6.1] → pendências de decisão na spec de arquitetura e de atualização do PRD.
- [Sem Docker na máquina] → as verificações de compose e migration ficam registradas como não executadas, e a task continua aberta.

## Migration Plan

Não há sistema anterior. Rollback de cada passo: o diff do git do passo (por isso o `git status` limpo entre passos é recomendado); para o banco local, `docker compose down` mantém os volumes — apagar volume só com confirmação do usuário.

## Open Questions

- Nome real do workspace do backend (`@hypomna/api` esperado), confirmado em `apps/api/package.json` após o passo 1.
