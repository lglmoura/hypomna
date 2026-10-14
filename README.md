# HYPOMNA

**Hypomna — o diário que transforma cada trade em aprendizado.**

Na Grécia antiga, os estoicos mantinham os _hypomnemata_: cadernos pessoais onde registravam ações, reflexões e erros para relê-los e se corrigir. O Hypomna traz essa disciplina para o mercado financeiro.

A maioria dos traders sabe que deveria manter um diário, mas poucos conseguem transformar anotações em evolução real. O Hypomna resolve isso unindo registro estruturado e análise de desempenho numa única plataforma.

Com o Hypomna, o trader registra cada operação com contexto: ativo, setup, entrada, saída, gestão de risco, estado emocional e capturas do gráfico. A plataforma converte esse histórico em métricas acionáveis, como taxa de acerto, payoff, expectativa, drawdown e desempenho por setup, horário e ativo. Com isso, o trader enxerga com clareza onde está o seu edge e quais hábitos estão custando dinheiro.

Mais do que uma planilha sofisticada, o Hypomna é uma ferramenta de autoconhecimento. Ele foi feito para traders de day trade, swing trade e mesas proprietárias que querem trocar a intuição pela consistência e tratar o trading como um negócio.

**Revise. Aprenda. Evolua.**

## O que o produto faz

- Um **Trader** cadastra suas contas, diferenciando **Conta Própria** (risco do próprio capital) de **Mesa Proprietária** (regras de drawdown, meta de lucro e consistência).
- Um **Trader** importa operações por **CSV** das plataformas **NinjaTrader** e **Tradovate**, ou registra manualmente, e o sistema normaliza tudo para um formato único.
- Um **Trader** acompanha métricas precisas por ativo — com foco em **NQ**, **MNQ**, **ES** e **MES** —, por conta e por período, além do status de cada conta de mesa frente às suas regras.
- Um **Admin** da plataforma gerencia tenants, assinaturas e a moderação de contas.

## Isolamento por tenant

Cada Trader é um tenant fechado: operações, contas e resultados são isolados por `TenantId`. Nenhuma consulta ou regra de negócio é executada sem validar e filtrar pelo contexto do tenant atual. Essa garantia é o princípio mais importante do produto.

## Princípios de engenharia

### Arquitetura e design

- **Multi-tenancy por design** — todo dado sensível é escopado por `TenantId`.
- **SOLID & Clean Architecture** — o domínio é o centro; regras de negócio não dependem de UI nem de persistência.
- **Object Calisthenics** — um nível de indentação por método, sem `else`, primitivos e strings encapsulados em Value Objects, entidades pequenas.
- **Imutabilidade** — Value Objects como `Money`, `TradeResult` e `Coordinates` são estritamente imutáveis.

### Domínio financeiro

- **Precisão monetária** — nunca `float`/`double` para valores financeiros; somente tipos decimais de precisão arbitrária encapsulados em `Money`.
- **Ativos suportados** — índices futuros do CME/CBOT, com modelagem precisa de tick size e valor por tick para NQ, MNQ, ES e MES.
- **Tipos de conta** — `PersonalAccount` e `PropFirmAccount` são conceitos distintos no domínio, cada um com suas próprias regras.

### Ingestão de dados

- **Importação manual e automatizada**, com parser de CSV robusto e tolerante a falhas parciais (linhas inválidas são reportadas, sem descartar o lote inteiro).
- **Normalização** — layouts de terceiros (NinjaTrader, Tradovate) são convertidos para um modelo agnóstico do domínio antes da persistência.

### Metodologia

- **Spec-Driven Development (SDD)** — nenhuma funcionalidade é implementada sem uma especificação `.md` de feature aprovada.
- **Test-Driven Development (TDD)** — os testes unitários guiam o design: Red → Green → Refactor.
- **Behavior-Driven Development (BDD)** — testes de integração e aceitação descrevem o comportamento do usuário em Given-When-Then.
- **Cobertura** — próxima de 100% nas camadas de Domínio e Casos de Uso (Application/Services).

### Padrões de código

- Código e testes em **inglês** (ex.: `Trade`, `PropFirmAccount`, `ImportTradesCsvCommand`); documentação de negócio e UI podem ser multilíngues.
- Nomes intencionais que revelam propósito (ex.: `CalculateDailyDrawdown()` em vez de `CalcDD()`).

## Documentação

A especificação completa do produto — requisitos funcionais, modelo de domínio, arquitetura, riscos e roadmap — ficará em [`.docs/PRD.md`](./.docs/PRD.md).
