# Testes (SDD, TDD e BDD)

Resumo operacional da estratégia de testes do PRD (§7.1, com a convenção de aceite no início da §4, o fluxo SDD na §6.3 e o glossário na §11.1). Em caso de divergência, o PRD manda. Vale para toda fase e todo app.

## Ciclo de trabalho (SDD + TDD)

- **NUNCA** escreva código de produção sem a spec da feature `APPROVED` (`.docs/specs/<módulo>/RF-<nn>-<slug>.md`, PRD §6.3). Ao terminar, a spec vira `IMPLEMENTED`.
- **SEMPRE** escreva o teste antes do código: Red → Green → Refactor por RF. Primeiro o teste que falha, depois o mínimo de código para passar, depois a refatoração com a suíte verde.
- **SEMPRE** rode o teste novo e veja-o falhar **pelo motivo certo** antes de implementar. Teste que nunca falhou não prova nada.
- **SEMPRE** trate bug como teste vermelho primeiro: a correção só entra com o teste que a exige.
- Commits do mesmo RF: o `test(...)` antes do `feat(...)` é recomendado.

## Cenários do PRD (BDD)

- **SEMPRE** parta dos cenários `**CA-RF<nn>-<k>**` do RF em que está trabalhando. Um cenário do PRD corresponde a um `Cenário` (ou `Esquema do Cenário`, quando o PRD traz tabela de exemplos) executável, com o ID como tag.
- **NUNCA** implemente comportamento que não tem cenário no PRD, nem que contradiz um. Pare, proponha a mudança no cenário e só então teste e implemente (mudança de comportamento sem atualizar o PRD é débito de spec). Cenário técnico extra descoberto numa spec volta ao PRD na revisão seguinte.
- **NUNCA** marque um RF como entregue na §11 sem que todos os `CA-*` dele tenham teste passando. Confira com `pnpm test:trace` (RF-86), que falha com cenário sem teste ou teste com ID inexistente.
- Onde ficam:
  - API: `apps/api/test/features/<módulo>/RF-<nn>.feature`, com os passos em `RF-<nn>.steps.e2e-spec.ts` ao lado.
  - Apps Next: `test/features/` do app, com `RF-<nn>.steps.test.ts(x)` ao lado.
- Como escrever o `.feature`: pt-BR (`# language: pt`, `Funcionalidade`, `Cenário`, `Esquema do Cenário`, `Exemplos`, `Dado`, `E`, `Quando`, `Então`), tag `@CA-RF<nn>-<k>` em cada cenário, um único `Quando` por cenário, passos em linguagem de domínio (glossário da §11.1: Trader, Conta Própria, Conta de Mesa, Trade, Execução, Lote de importação…), sem SQL, URL ou nome de classe. Status HTTP e `code` só no **Então**.
- Como ligar os passos com `@amiceli/vitest-cucumber`:
  - `loadFeature('./RF-<nn>.feature', { language: 'pt' })`, direto no arquivo de teste. **NUNCA** embrulhe o `loadFeature` num helper: o caminho é resolvido a partir do arquivo que o chama. Sem `language: 'pt'` o parser não reconhece as palavras-chave.
  - Os callbacks de passo têm nome em inglês (`Given`, `When`, `Then`, `And`), qualquer que seja o idioma do `.feature`; o texto do passo tem de bater exatamente com o do `.feature`.
  - Esquema do cenário usa `ScenarioOutline` e o objeto `variables`. Passo sem implementação faz a suíte falhar, e isso é o desejado.
  - Antes de usar uma API da biblioteca que não está aqui, consulte o Context7 (`mcps.md`).

## Níveis e infraestrutura

- **Domínio** (`packages/domain`: `Money`, `TickCalculator`, resolução de símbolo, `PerformanceCalculator`, políticas de mesa, `TradingCalendar`, deduplicação): teste **unitário**, sem I/O. Esquema do cenário vira teste parametrizado; `Money` e métricas têm também teste _property-based_ com `fast-check`.
- **Aplicação** (use cases): teste unitário com as portas falsificadas.
- **Integração** (repositórios, RLS, constraints, transações, filas): Vitest + Testcontainers com Postgres, Redis e MinIO reais, em banco isolado por execução, nunca o de desenvolvimento.
- **API e aceite**: HTTP pela aplicação Nest (guards, pipes, filtros, i18n) com `supertest` e `@amiceli/vitest-cucumber`.
- **Parsers de importação**: cada layout (NinjaTrader, Tradovate) contra os arquivos reais anonimizados de `/fixtures/csv`, com o resultado esperado em _snapshot_ revisado.
- **Contrato** (OpenAPI × Orval × `packages/contracts`), **arquitetura** (`eslint-plugin-boundaries` + teste de dependências) e **i18n** (chaves faltando ou sobrando, ICU válido) rodam no CI.
- **Componente**: Testing Library + Vitest + MSW, com a API simulada pelo contrato. **Ponta a ponta**: Playwright nos fluxos críticos (cadastro → conta → importação → métricas; conta de mesa em risco; troca de idioma), no noturno e no pré-release.
- **NUNCA** simule o Prisma nos testes de integração e de API. Isolamento de tenant, RLS, constraints e transações só se provam em banco real.
- Stripe, storage e e-mail ficam atrás de porta, com fake de `packages/test-utils`. Eventos de webhook do Stripe são simulados e assinados com o segredo de teste. **NUNCA** chame o Stripe real no CI.
- **SEMPRE** injete o relógio (`Clock`/`TradingCalendar`) e os geradores de ID e token. **NUNCA** dependa da hora real, de rede externa nem de `sleep`; espere por condição.

## Isolamento de tenant

- **SEMPRE** teste acesso com os personagens padrão de `packages/test-utils`: Trader A e Trader B (tenants distintos), Admin e Suporte. Use os builders de fixture; não crie personagens à mão em cada teste.
- Rota nova **SEMPRE** entra na matriz de isolamento (RF-85): sem sessão `401`, papel indevido `403` (ou `404` onde a existência do recurso não pode ser denunciada), recurso de outro tenant `404` com corpo idêntico ao de um identificador inexistente. Rota sem entrada na matriz quebra o teste.
- Jobs e URLs assinadas de arquivos têm testes de isolamento próprios: o job restabelece o tenant do payload, e a URL de um tenant não serve ao outro.

## Higiene

- **NUNCA** deixe `it.skip`, `describe.skip` nem `.only` no que for commitado. Teste instável entra em quarentena com prazo e responsável; não se desliga nem se apaga.
- **NUNCA** enfraqueça um teste para fazê-lo passar (afrouxar asserção, aumentar timeout sem causa, apagar caso). Se o teste está errado, corrija o teste e explique por quê.
- **NUNCA** use `--no-verify`. O `pre-push` roda `check-types` e os testes unitários; o CI repete e acrescenta integração, aceite, contrato, arquitetura, i18n, cobertura e `test:trace`.

## Definition of Done de um RF

- Spec da feature `APPROVED` antes do código e `IMPLEMENTED` ao final.
- Todo `CA-*` do RF tem teste automatizado que falhou antes do código.
- Os casos negativos existem: sem sessão, outro tenant, papel indevido e entrada inválida.
- Rotas novas estão na matriz (RF-85) e no OpenAPI, com o client Orval regenerado.
- Textos novos nos três idiomas (`pt-BR`, `en`, `es`, RF-66).
- Suíte verde, sem `skip`, e cobertura dentro das metas: ≥ 95% de linhas e ramos em `packages/domain` e na camada `application` (meta de trabalho próxima de 100%), ≥ 80% em `apps/api` no geral.
- A §11 (spec, código e testes) está atualizada e, se o comportamento mudou, o PRD também.

## Ao concluir uma tarefa

- Rode os testes do que mudou (`pnpm --filter <app> test`, e `test:e2e` na API) e o `pnpm test:trace`, e reporte o resultado como ele é: teste que falhou, cenário pendente ou verificação que não deu para rodar (por exemplo, sem Docker para o Testcontainers) entram no relato, sem dourar.
