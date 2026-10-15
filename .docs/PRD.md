# PRD — HYPOMNA (Diário de Trading Multi-tenant)

> **HYPOMNA** — _o diário que transforma cada trade em aprendizado._ **Revise. Aprenda. Evolua.**

| Campo               | Valor                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Produto             | HYPOMNA — monorepo fullstack multi-tenant                                     |
| Tagline             | "O diário que transforma cada trade em aprendizado."                          |
| Versão do documento | 1.1                                                                           |
| Data                | 2026-10-15                                                                    |
| Status              | Draft — aguardando revisão                                                    |
| Autor               | Luiz Gustavo Lourenço Moura (com apoio de IA)                                 |
| Baseado em          | [`README.md`](../README.md) (definição do produto e princípios de engenharia) |
| Repositório-alvo    | Este repositório (`Hypomna/`), estruturado como monorepo                      |

> **Como usar este documento (SDD).** Este PRD é a fonte de verdade do _o quê_ e do _porquê_ do produto. Ele não descreve implementação linha a linha. Cada requisito funcional tem um ID (`RF-XX`) e critérios de aceite verificáveis, escritos como cenários BDD (convenção no início da §4) e transformados em testes antes do código (TDD, §7.1). **Nenhuma funcionalidade é implementada sem uma spec de feature `.md` aprovada** (`.docs/specs/<módulo>/RF-<nn>-<slug>.md`, §6.3), e toda spec referencia os IDs deste PRD. Mudança de comportamento sem atualizar primeiro este documento é débito de spec. Revisões futuras entram como "Nota de revisão 1.x" logo abaixo, no mesmo formato.

> **Nota de revisão 1.0.** Primeira versão. Define a visão do produto, o modelo de multi-tenancy (o **Trader é o tenant**), o escopo funcional da v1 (RF-01 a RF-86), o modelo de dados conceitual, a arquitetura do monorepo, os requisitos não-funcionais, a estratégia de testes (SDD + TDD + BDD), as métricas, os riscos, as questões em aberto e o roadmap. Formaliza também, como requisito transversal, que **o sistema é multi-idioma** (§4.11, RF-62 a RF-66): interface, mensagens da API, e-mails e formatação de números, datas e moedas no idioma escolhido pelo usuário, com `pt-BR` como padrão e `en` e `es` desde a v1. Os quatro clientes do produto são separados por papel (§1.4): `apps/web` (Trader), `apps/web-admin` (Admin), `apps/web-marketing` (Visitante) e o backend único `apps/api`.

> **Nota de revisão 1.1.** Corrige a divisão das personas, que misturava dois critérios (tipo de conta e estilo de operação) e tratava cada um como um "tipo de trader". Agora existe **uma única persona de Trader** (§2), e as diferenças ficam em dois eixos independentes: a **finalidade da conta** (Conta Própria ou Conta de Mesa — atributo da conta, §4.3), e um mesmo Trader pode ter contas das duas finalidades ao mesmo tempo; e a **modalidade da operação** (day trade ou swing trade — atributo do trade, derivado pelo dia de pregão, novo **RF-87**, §4.5). Efeitos: saem os "estilos de trading" do perfil (RF-08, `TraderProfile.tradingStyles`), inclusive o valor `PROP_FIRM`, que era tipo de conta e não estilo; `Trade` ganha `modality` (§5); finalidade da conta e modalidade entram nos recortes (RF-45) e nos filtros (RF-46); novos cenários CA-RF87-1 a CA-RF87-3; glossário (§11.1) ganha "Finalidade da conta" e "Modalidade".

---

## 1. Visão do Produto

### 1.1 Ponto de partida

O produto nasce do zero (_greenfield_). Não há código legado nem schema a migrar; o repositório contém apenas o `README.md`, que fixa a definição do produto e os princípios de engenharia que este PRD transforma em requisitos:

- **Multi-tenancy por design**, com isolamento por `TenantId` como princípio mais importante do produto.
- **Clean Architecture + SOLID + Object Calisthenics**, com o domínio no centro e Value Objects imutáveis (`Money`, `TradeResult`, `Coordinates`).
- **Precisão monetária** (nunca `float`/`double`) e **modelagem precisa de tick size e valor por tick** para NQ, MNQ, ES e MES.
- **Ingestão de CSV** de NinjaTrader e Tradovate, tolerante a falhas parciais, com normalização para um modelo agnóstico.
- **SDD + TDD + BDD**, com cobertura próxima de 100% em Domínio e Casos de Uso.
- Código e testes em **inglês**; documentação de negócio e UI **multilíngues**.

### 1.2 Problema

Traders de futuros — operando day trade ou swing trade, em conta própria e/ou em contas de mesas proprietárias — sabem que deveriam manter um diário, mas o fazem de forma manual e fragmentada (planilhas, prints soltos, anotações no papel). Isso gera quatro dores recorrentes:

1. **Registrar dá trabalho** — copiar operações da plataforma para uma planilha é lento e sujeito a erro; o diário é abandonado em poucas semanas.
2. **Os números não batem** — cálculos de resultado feitos à mão (ou com `float` em planilhas) erram tick, multiplicador, comissão e fuso do pregão.
3. **Falta contexto** — a planilha guarda preço e resultado, mas não o _porquê_: setup, estado emocional, aderência ao plano, gráfico do momento.
4. **Mesa proprietária é um campo minado** — regras de drawdown (estático, _trailing_ intradiário, _trailing_ de fim de dia), perda diária, meta e consistência variam por mesa e são fáceis de violar sem perceber.

### 1.3 Proposta

Uma plataforma web **multi-tenant** em que **cada Trader é um tenant fechado**. O Trader cadastra suas contas (Conta Própria ou Mesa Proprietária), importa operações por CSV de NinjaTrader e Tradovate ou registra manualmente, enriquece cada trade com contexto (setup, emoção, gestão de risco, notas, capturas do gráfico) e recebe de volta métricas acionáveis (taxa de acerto, payoff, expectativa, fator de lucro, drawdown, desempenho por setup, horário, ativo e conta), além do **status de cada conta de mesa frente às suas regras**. Um Admin da plataforma gerencia tenants, assinaturas, catálogos globais e moderação de contas, sem acesso ao conteúdo do diário.

### 1.4 Clientes do Produto

Este PRD assume **três clientes**, todos consumindo a mesma API (`apps/api`, §6), cada um atendendo **exatamente um papel**:

| Cliente                                         | Público             | Superfície                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App web do Trader** (`apps/web`)              | Trader              | Único cliente do Trader. Contas, importação, registro e diário de trades, métricas, status das contas de mesa, assinatura, perfil e preferências — **todo requisito de Trader deste PRD é entregue aqui**. Responsivo (desktop primeiro, utilizável no celular). |
| **App web do Admin** (`apps/web-admin`)         | Admin da Plataforma | Gestão de tenants, assinaturas, moderação, catálogos globais (instrumentos e modelos de regras de mesa) e auditoria (§4.13). Deploy, domínio e sessão próprios. Sem cadastro público (RF-07).                                                                    |
| **App web de Marketing** (`apps/web-marketing`) | Visitante (lead)    | Landing page, preços e chamada para cadastro (§4.14). Não autentica ninguém; o cadastro acontece em `apps/web`.                                                                                                                                                  |

> App mobile nativo fica fora da v1 (§1.6). A divisão por papel é decisão de superfície: um app nunca renderiza, nem parcialmente, a tela de outro papel (princípio 7, §1.5).

### 1.5 Princípios de produto

1. **Isolamento de tenant é inegociável.** Um Trader jamais acessa dado de outro Trader, em nenhuma camada (rota, caso de uso, query, job, arquivo, cache). Vazamento entre tenants é incidente de segurança, não bug funcional.
2. **O número tem que bater com a corretora.** Todo valor monetário é decimal exato (`Money`), todo resultado é derivado de ticks e valor por tick do instrumento, e comissões e taxas são explícitas. Divergência de centavo é defeito.
3. **Registrar tem que ser mais fácil que não registrar.** Importação em poucos cliques, tolerante a erro de linha; o registro manual pede só o essencial e deixa o contexto para depois.
4. **Contexto transforma dado em aprendizado.** Toda métrica pode ser recortada pelo contexto que o Trader registrou (setup, emoção, aderência ao plano, horário).
5. **A mesa é uma conta com regras, não um rótulo.** `PropFirmAccount` e `PersonalAccount` são conceitos distintos no domínio; as regras de mesa são calculadas, nunca apenas exibidas.
6. **Privacidade do diário.** O Admin opera a plataforma sem ler o diário: ele vê metadados de tenant e assinatura, nunca trades, notas ou capturas.
7. **Cada papel tem um app, e só um.** Trader, Admin e Visitante nunca compartilham binário, layout ou sessão.
8. **Fala a língua do usuário.** Todo texto exibido ao usuário vem de um catálogo de tradução; nenhum texto de UI é escrito direto no código (§4.11).
9. **Spec antes do código, teste antes da implementação.** Nenhuma funcionalidade sem spec aprovada (SDD); nenhum requisito entregue sem os cenários de aceite automatizados, escritos antes do código (TDD/BDD, §7.1).

### 1.6 Não-objetivos (v1)

- Execução de ordens, conexão com corretora ou roteamento (o Hypomna é diário, não plataforma de trading).
- Sincronização automática via API de corretora/plataforma (importação é por CSV na v1; integração direta é candidata a v2 — questão 10.6).
- Ativos fora dos futuros NQ, MNQ, ES e MES (ações, opções, cripto, forex, outros futuros) — o catálogo é extensível, mas só esses quatro são suportados e testados na v1.
- Recomendação de investimento ou sinal de trade.
- App mobile nativo.
- Recursos sociais (compartilhar diário, ranking, mentor com acesso ao diário de terceiros) — candidatos a v2 (questão 10.9).
- Vários usuários por tenant (equipes/mesas com gestores) — na v1, um tenant tem exatamente um Trader (questão 10.2).
- Análise por IA do diário — candidata a v2 (questão 10.10).

---

## 2. Personas

| Persona                         | Descrição                                                                                                                                                                                                                                                                     | Necessidade central                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trader**                      | Opera futuros (NQ, MNQ, ES, MES) em NinjaTrader ou Tradovate, em **day trade** e/ou **swing trade**. Pode ter, ao mesmo tempo, contas com **finalidades diferentes**: Contas Próprias (capital próprio) e Contas de Mesa (avaliação ou financiada, cada uma com suas regras). | Enxergar onde está o seu _edge_ e quais hábitos custam dinheiro, em todas as contas; e, nas Contas de Mesa, não violar regras (drawdown, perda diária, meta, consistência). |
| **Admin da Plataforma**         | Operação interna (não é tenant), em `apps/web-admin`.                                                                                                                                                                                                                         | Gerir tenants, assinaturas, catálogos e moderação — sem acesso ao conteúdo do diário.                                                                                       |
| **Visitante (lead)**            | Trader ainda sem conta, em `apps/web-marketing`.                                                                                                                                                                                                                              | Entender o produto, ver preços e começar rápido.                                                                                                                            |
| **Consumidor da API (técnica)** | Os três clientes do monorepo.                                                                                                                                                                                                                                                 | Endpoints previsíveis, tipados, documentados via OpenAPI, escopados por tenant e localizados.                                                                               |

> **Não existe "tipo de trader" (revisão 1.1).** O produto tem **uma única persona de Trader**. As diferenças de uso são modeladas em dois eixos independentes, nenhum deles no Trader:
>
> | Eixo                       | Onde vive                             | Valores                                                               | Requisitos   |
> | -------------------------- | ------------------------------------- | --------------------------------------------------------------------- | ------------ |
> | **Finalidade da conta**    | Na conta (`TradingAccount`)           | Conta Própria (`PersonalAccount`) e Conta de Mesa (`PropFirmAccount`) | §4.3, §4.9   |
> | **Modalidade da operação** | No trade (`Trade.modality`), derivada | Day trade (`DAY_TRADE`) e swing trade (`SWING_TRADE`)                 | RF-87 (§4.5) |
>
> Um mesmo Trader pode ter qualquer combinação de contas e operar nas duas modalidades, inclusive na mesma conta.

---

## 3. Modelo de Multi-tenancy

Esta é a decisão estrutural central do produto e por isso recebe uma seção própria.

### 3.1 Definição de tenant

- O **tenant é o Trader.** Cada cadastro de Trader cria, na mesma transação, um `Tenant` e o vínculo do `User` como seu dono (`TenantMembership` com papel `OWNER`). Não existe tenant vazio ou compartilhado.
- Na v1, **um tenant tem exatamente um usuário** (o Trader dono). O modelo (`TenantMembership`) já admite vários usuários por tenant para não exigir migração quando equipes/mesas entrarem (questão 10.2), mas nenhum fluxo da v1 cria um segundo membro.
- O **Admin não pertence a tenant algum** (`platformRole = ADMIN` ou `SUPPORT`).

### 3.2 Isolamento de dados

- **Toda entidade de domínio do diário carrega `tenantId`** (contas, trades, execuções, setups, tags, capturas, importações, revisões diárias, ajustes de saldo). Não há tabela de domínio de tenant sem caminho até `tenantId`.
- O `tenantId` usado para autorizar e filtrar **vem sempre da sessão autenticada**, resolvido no início da requisição (`TenantContext`), **nunca** do body, da query, do path, do nome de arquivo nem do conteúdo de um CSV. Rota ou caso de uso que aceite `tenantId` como parâmetro livre é vulnerabilidade IDOR.
- **Defesa em profundidade, três camadas:**
  1. **Aplicação** — `TenantGuard` resolve o `TenantContext`; todo repositório recebe o contexto e filtra por `tenantId` (nenhum método de repositório de domínio existe sem ele).
  2. **ORM** — extensão do Prisma que injeta `tenantId` em `where`/`data` e falha (erro, não silêncio) em query de modelo tenant-scoped sem contexto.
  3. **Banco** — _Row-Level Security_ do PostgreSQL nas tabelas de domínio, com `SET LOCAL app.tenant_id` por transação; a role da aplicação não é dona das tabelas e não tem `BYPASSRLS`.
- **Jobs assíncronos** (importação, exportação, recálculo) carregam o `tenantId` no payload assinado pelo produtor e restabelecem o `TenantContext` antes de qualquer acesso a dado.
- **Arquivos** (CSV importado, capturas de gráfico, exportações) são gravados sob prefixo `tenants/<tenantId>/…` no storage e servidos apenas por URL assinada de curta duração, emitida após checagem de tenant.
- **Cache** (Redis) usa chaves prefixadas por `tenantId` para qualquer dado de domínio.
- Acesso a recurso de outro tenant responde **`404`** (nunca `403`), com corpo idêntico ao de um recurso inexistente, para não vazar existência.

### 3.3 Papéis (RBAC)

| Capacidade                                                         | Trader (OWNER do tenant) | Admin                | Suporte (`SUPPORT`)  |
| ------------------------------------------------------------------ | ------------------------ | -------------------- | -------------------- |
| Gerir contas, trades, importações e diário do próprio tenant       | ✅                       | ❌                   | ❌                   |
| Ver métricas e status de mesa do próprio tenant                    | ✅                       | ❌                   | ❌                   |
| Gerir a própria assinatura                                         | ✅                       | ❌                   | ❌                   |
| Listar tenants e ver metadados (e-mail, plano, uso, datas, status) | ❌                       | ✅                   | ✅ (somente leitura) |
| Suspender/reativar tenant                                          | ❌                       | ✅                   | ❌                   |
| Conceder cortesia/estender teste de assinatura                     | ❌                       | ✅                   | ❌                   |
| Gerir catálogos globais (instrumentos, modelos de regras de mesa)  | ❌                       | ✅                   | ❌                   |
| Ler trades, notas, capturas ou métricas de um tenant               | ✅ (só o próprio)        | ❌                   | ❌                   |
| Conceder papel `ADMIN`/`SUPPORT`                                   | ❌                       | ✅ (auditado, RF-07) | ❌                   |

> **Exceção controlada ao princípio 1:** o Admin enxerga **metadados** de todos os tenants por definição. Isso é implementado por um `AdminGuard` próprio e auditado, distinto do `TenantGuard`, em módulo próprio da API (`admin`), consumido só por `apps/web-admin`. Nenhuma rota de Trader aceita `platformRole` como forma de pular a checagem de tenant, e nenhuma rota de Admin devolve conteúdo de diário (princípio 6).

### 3.4 Ciclo de vida do tenant

| Estado      | Como entra                                                  | Efeito                                                                                         |
| ----------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ACTIVE`    | Cadastro do Trader (RF-01) ou reativação pelo Admin (RF-74) | Acesso completo, conforme o plano de assinatura (§4.12).                                       |
| `READ_ONLY` | Assinatura `CANCELED` ou `PAST_DUE` após a carência (RF-71) | Leitura e exportação liberadas; criar/editar/importar bloqueado (`402 SUBSCRIPTION_REQUIRED`). |
| `SUSPENDED` | Ação do Admin por violação de termos (RF-74)                | Login bloqueado com mensagem genérica; dados preservados; sessões encerradas.                  |
| `DELETED`   | Exclusão a pedido do titular (RF-82)                        | Dados de domínio apagados após a janela de arrependimento; registros financeiros anonimizados. |

---

## 4. Escopo Funcional

Numeração `RF-XX` organizada por módulo. Cada tabela traz o requisito e uma observação com prioridade (**Alta**, **Média**, **Baixa**) e detalhes de contrato.

**Convenção de aceite (BDD).** Os critérios de aceite de cada seção são cenários no formato Dado/Quando/Então, escritos para serem lidos pelo negócio e executados como teste (§7.1):

- Um cenário por item, com ID estável `CA-RF<nn>-<k>` (RF e ordem). O ID é o elo com o teste (tag `@CA-RF04-1` no `.feature`) e com a §11.
- As palavras em **negrito** — **Dado**, **e**, **quando**, **então** — são as palavras-chave do Gherkin em pt-BR; a conversão para `.feature` é mecânica. Cada cenário tem um único **quando**.
- **Esquema do cenário** (_Scenario Outline_): regra combinatória traz uma tabela de exemplos logo abaixo, com valores nos limites.
- Linguagem de domínio, conforme o glossário da §11.1. Códigos de erro e status HTTP aparecem no **então** quando fazem parte do contrato.
- Todo RF tem o caminho feliz e, quando mexe em dado de tenant, ao menos um caso negativo (outro tenant, sem sessão, papel indevido ou entrada inválida).
- Personagens padrão: **Trader A** e **Trader B** (tenants distintos), **Admin** e **Suporte**.
- Mudar comportamento é mudar o cenário primeiro (SDD), depois o teste e por último o código.

**Contrato de erro.** Todo erro da API tem o formato `{ error, code, message, details? }`: `code` é estável, em inglês `UPPER_SNAKE_CASE` e nunca traduzido; `message` vem no idioma resolvido (RF-63).

### 4.1 Autenticação e Contas de Usuário

| ID    | Requisito                                                             | Observação                                                                                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-01 | Cadastro do Trader por e-mail e senha, com criação atômica do tenant  | Alta. Em `apps/web`. Cria `User`, `Tenant` (`ACTIVE`), `TenantMembership` (`OWNER`) e `TraderProfile` com idioma e fuso detectados do navegador, numa transação. Senha mínima de 8 caracteres. Inicia o teste gratuito (RF-68).                                                      |
| RF-02 | Verificação de e-mail antes do primeiro login                         | Alta. Link de uso único com expiração de 24 h, e-mail no idioma do usuário (RF-65).                                                                                                                                                                                                  |
| RF-03 | Login por e-mail e senha, com sessão                                  | Alta. Better-Auth. `apps/web` e `apps/web-admin` usam sessão por cookie `HttpOnly`, `Secure`, `SameSite=Lax`, em domínios distintos (sessões nunca compartilhadas). Mensagem de falha genérica (não revela se o e-mail existe). Bloqueio progressivo após tentativas falhas (RF-81). |
| RF-04 | Toda rota de negócio protegida por sessão e por autorização de tenant | Alta. Sem sessão: `401 UNAUTHORIZED`. Recurso de outro tenant: `404 NOT_FOUND` (§3.2). Rotas abertas: `/health`, `/docs`, `/openapi.json`, `/public/*`, `/api/auth/*`, `/webhooks/*` (estas com assinatura própria).                                                                 |
| RF-05 | Recuperação de senha por e-mail                                       | Alta. Token de uso único, expira em 1 h; ao redefinir, encerra todas as sessões. Resposta sempre igual, exista o e-mail ou não.                                                                                                                                                      |
| RF-06 | Troca de senha e encerramento de sessões                              | Média. Exige a senha atual; encerra as demais sessões. Botão "Sair de todos os dispositivos".                                                                                                                                                                                        |
| RF-07 | Contas de Admin e Suporte sem cadastro público                        | Alta. Criadas por seed ou promovidas por outro Admin; toda concessão de papel é auditada (RF-77). Login do Admin exige segundo fator (TOTP).                                                                                                                                         |

**Aceite**

- **CA-RF01-1** — _Cadastro cria tenant._ **Dado** um visitante sem conta; **quando** se cadastra com e-mail válido e senha de 8 caracteres ou mais; **então** existem um `User`, um `Tenant` `ACTIVE` e um `TenantMembership` `OWNER` ligando os dois; **e** a assinatura está em teste (`TRIALING`); **e** um e-mail de verificação é enviado.
- **CA-RF01-2** — _Cadastro é atômico._ **Dado** uma falha ao criar o `TraderProfile`; **quando** o cadastro é processado; **então** nenhum `User`, `Tenant` ou `TenantMembership` permanece gravado.
- **CA-RF01-3** — _Entradas inválidas (esquema do cenário)._ **Dado** um visitante na tela de cadastro; **quando** confirma com e-mail `<e-mail>` e senha `<senha>`; **então** vê o erro no campo `<campo>`; **e** nenhuma chamada de cadastro é feita.

  | e-mail         | senha               | campo              |
  | -------------- | ------------------- | ------------------ |
  | `ana`          | `senha-valida-1`    | e-mail             |
  | _(vazio)_      | `senha-valida-1`    | e-mail             |
  | `ana@mail.com` | `1234567` (7 chars) | senha              |
  | `ana@mail.com` | `12345678` (8)      | _(nenhum: aceita)_ |

- **CA-RF01-4** — _E-mail já cadastrado._ **Dado** um e-mail que já tem conta; **quando** um visitante tenta se cadastrar com ele; **então** vê uma mensagem genérica que não revela se a conta existe; **e** nenhum tenant novo é criado.
- **CA-RF02-1** — _Login antes de verificar._ **Dado** um Trader com e-mail não verificado; **quando** tenta entrar; **então** o login é recusado com `code: "EMAIL_NOT_VERIFIED"`; **e** pode pedir o reenvio do link.
- **CA-RF03-1** — _Credenciais inválidas._ **Dado** um visitante; **quando** informa e-mail e senha que não correspondem a uma conta; **então** recebe `401 INVALID_CREDENTIALS` com a mesma mensagem para e-mail inexistente e senha errada.
- **CA-RF03-2** — _Sessão não cruza apps._ **Dado** um Trader autenticado em `apps/web`; **quando** abre `apps/web-admin`; **então** não está autenticado ali.
- **CA-RF04-1** — _Rota de negócio sem sessão._ **Dado** que não envio sessão; **quando** chamo qualquer rota fora das abertas; **então** recebo `401 { code: "UNAUTHORIZED" }`.
- **CA-RF04-2** — _Leitura de recurso de outro tenant._ **Dado** que sou Trader A autenticado; **quando** consulto um trade do Trader B pelo identificador; **então** recebo `404 NOT_FOUND`; **e** o corpo é idêntico ao de um identificador inexistente.
- **CA-RF04-3** — _Escrita em recurso de outro tenant._ **Dado** que sou Trader A autenticado; **quando** tento alterar uma conta do Trader B; **então** recebo `404`; **e** nenhum dado de B é alterado.
- **CA-RF04-4** — _tenantId do payload é ignorado._ **Dado** que sou Trader A autenticado; **quando** crio um trade enviando `tenantId` do Trader B no corpo; **então** a requisição é recusada com `400 VALIDATION_ERROR` (campo desconhecido); **e** nada é gravado no tenant B.
- **CA-RF05-1** — _Recuperação não revela conta._ **Dado** um e-mail com conta e outro sem; **quando** peço recuperação para cada um; **então** as duas respostas são idênticas; **e** só o e-mail com conta recebe o link.
- **CA-RF05-2** — _Redefinir encerra sessões._ **Dado** um Trader com duas sessões abertas; **quando** redefine a senha pelo link válido; **então** as duas sessões deixam de ser aceitas.
- **CA-RF06-1** — _Troca exige senha atual._ **Dado** um Trader autenticado; **quando** troca a senha informando a senha atual errada; **então** recebe `400 INVALID_CURRENT_PASSWORD`; **e** a senha não muda.
- **CA-RF07-1** — _Sem autocadastro de Admin._ **Dado** qualquer fluxo público de cadastro; **quando** é concluído; **então** o usuário criado nunca tem `platformRole` `ADMIN` ou `SUPPORT`.
- **CA-RF07-2** — _Admin exige segundo fator._ **Dado** um Admin com senha correta; **quando** entra em `apps/web-admin` sem informar o TOTP; **então** a sessão não é criada.

---

### 4.2 Perfil e Preferências do Trader

| ID    | Requisito               | Observação                                                                                                                                                                                                                                                      |
| ----- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-08 | Perfil do Trader        | Média. Nome de exibição, foto, plataformas usadas (`NINJATRADER`, `TRADOVATE`).                                                                                                                                                                                 |
| RF-09 | Preferências regionais  | Alta. Idioma (RF-62), fuso horário IANA (padrão: detectado; fallback `America/Sao_Paulo`), formato de data/número derivado do idioma, moeda de exibição (`USD` na v1). O fuso é usado para exibição; o **dia de pregão** segue a sessão do instrumento (RF-48). |
| RF-10 | Preferências de cálculo | Média. Incluir ou não comissões/taxas nas métricas (padrão: métricas em **resultado líquido**); horário de corte do "dia" para o calendário: `SESSION` (pregão CME, padrão) ou `CALENDAR` (meia-noite no fuso do Trader).                                       |

**Aceite**

- **CA-RF08-1** — _Editar perfil._ **Dado** o Trader A autenticado; **quando** altera nome de exibição e plataformas usadas; **então** o perfil reflete os novos valores; **e** o perfil do Trader B não muda.
- **CA-RF09-1** — _Fuso inválido._ **Dado** o Trader A; **quando** salva o fuso `Mars/Olympus`; **então** recebe `400 VALIDATION_ERROR`; **e** o fuso salvo não muda.
- **CA-RF09-2** — _Fuso muda a exibição, não o dado._ **Dado** um trade com saída em `2026-03-10T14:30:00Z`; **quando** o Trader troca o fuso de `America/Sao_Paulo` para `America/Chicago`; **então** o horário exibido muda de `11:30` para `09:30`; **e** o instante gravado não muda.
- **CA-RF10-1** — _Métricas brutas ou líquidas._ **Dado** um trade de +US$ 100,00 bruto com US$ 4,12 de comissão e taxas; **quando** o Trader alterna a preferência entre líquido e bruto; **então** o resultado exibido é US$ 95,88 e US$ 100,00, respectivamente.

---

### 4.3 Contas de Trading

> `PersonalAccount` (capital próprio) e `PropFirmAccount` (mesa proprietária) são **tipos distintos no domínio**, com invariantes próprias, e não um campo `type` com regras opcionais. Ambas compartilham a abstração `TradingAccount` (identidade, plataforma, moeda, saldo inicial, status).

| ID    | Requisito                                                            | Observação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-11 | Criar Conta Própria (`PersonalAccount`)                              | Alta. Nome, plataforma (`NINJATRADER`/`TRADOVATE`/`OTHER`), identificador da conta na plataforma (opcional, usado no mapeamento da importação, RF-38), corretora (opcional), moeda (`USD`), saldo inicial (`Money` > 0), data de abertura.                                                                                                                                                                                                                                                                                                                                                 |
| RF-12 | Criar Conta de Mesa (`PropFirmAccount`) com o seu conjunto de regras | Alta. Firma, plano/produto, tamanho da conta (saldo inicial), fase (`EVALUATION`/`FUNDED`), e o **conjunto de regras** (`PropFirmRuleSet`): tipo de drawdown (`STATIC`, `TRAILING_INTRADAY`, `TRAILING_END_OF_DAY`) e valor; trava do drawdown (opcional: valor do saldo em que o drawdown para de subir, ex.: saldo inicial + US$ 100); limite de perda diária (opcional); meta de lucro (obrigatória em `EVALUATION`); regra de consistência (opcional, % máximo do melhor dia sobre o lucro total); mínimo de dias operados (opcional); máximo de contratos por instrumento (opcional). |
| RF-13 | Criar Conta de Mesa a partir de modelo (`PropFirmRuleTemplate`)      | Média. O Trader escolhe um modelo do catálogo global mantido pelo Admin (RF-75) e o conjunto de regras é **copiado** para a conta (snapshot): mudar o modelo depois não altera contas já criadas. Todos os campos podem ser ajustados antes de salvar. Modelos são referência, não garantia — a tela avisa que as regras da mesa podem mudar.                                                                                                                                                                                                                                              |
| RF-14 | Ciclo de vida da conta                                               | Alta. `ACTIVE` → `ARCHIVED` (manual, reversível). Conta de mesa também: `PASSED` (meta e demais regras atingidas em `EVALUATION`), `FAILED` (violação detectada, RF-55, ou marcada pelo Trader), `PAYOUT` registrado por ajuste (RF-15). Conta arquivada sai dos seletores padrão, mas suas métricas continuam consultáveis.                                                                                                                                                                                                                                                               |
| RF-15 | Ajustes de saldo (`BalanceAdjustment`)                               | Média. Depósito, saque, _payout_ de mesa, reset de conta de mesa e correção, cada um com data, valor (`Money`) e nota. Ajustes **não** são trades e não entram em métricas de desempenho; entram no saldo e na curva de patrimônio. Reset de mesa reinicia o cálculo das regras a partir da data do reset.                                                                                                                                                                                                                                                                                 |
| RF-16 | Listar, editar e excluir contas                                      | Alta. Editar regras de uma conta de mesa recalcula o status (RF-49 a RF-55). Excluir conta com trades exige confirmação digitada do nome e remove trades, execuções e capturas da conta (exclusão lógica por 30 dias, depois definitiva — RF-83). Lista com saldo atual e, para mesas, o status resumido.                                                                                                                                                                                                                                                                                  |
| RF-17 | Limite de contas por plano de assinatura                             | Média. O número de contas `ACTIVE` respeita o plano (§4.12); excedente responde `402 PLAN_LIMIT_REACHED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Aceite**

- **CA-RF11-1** — _Criar Conta Própria._ **Dado** o Trader A; **quando** cria uma Conta Própria com saldo inicial de US$ 25.000,00; **então** a conta existe no tenant A com saldo atual de US$ 25.000,00; **e** não aparece para o Trader B.
- **CA-RF11-2** — _Saldo inicial inválido (esquema do cenário)._ **Dado** o Trader A; **quando** cria uma conta com saldo inicial `<valor>`; **então** o resultado é `<resultado>`.

  | valor      | resultado                                |
  | ---------- | ---------------------------------------- |
  | `0`        | `400 VALIDATION_ERROR`                   |
  | `-1.00`    | `400 VALIDATION_ERROR`                   |
  | `0.001`    | `400 VALIDATION_ERROR` (mais de 2 casas) |
  | `"abc"`    | `400 VALIDATION_ERROR`                   |
  | `50000.00` | criada                                   |

- **CA-RF12-1** — _Conta de avaliação exige meta._ **Dado** o Trader A; **quando** cria uma Conta de Mesa em `EVALUATION` sem meta de lucro; **então** recebe `400 VALIDATION_ERROR` no campo `profitTarget`.
- **CA-RF12-2** — _Drawdown maior que o saldo._ **Dado** o Trader A; **quando** cria uma Conta de Mesa de US$ 50.000,00 com drawdown de US$ 60.000,00; **então** recebe `400 VALIDATION_ERROR` no campo `maxDrawdown`.
- **CA-RF13-1** — _Modelo é copiado._ **Dado** uma conta criada a partir do modelo "50K Evaluation" com drawdown de US$ 2.500,00; **quando** o Admin altera o modelo para US$ 2.000,00; **então** a conta já criada continua com US$ 2.500,00.
- **CA-RF14-1** — _Conta arquivada sai do seletor, não das métricas._ **Dado** uma conta arquivada com trades; **quando** o Trader abre o registro de trade; **então** a conta não aparece no seletor padrão; **e** **quando** filtra métricas incluindo arquivadas, os trades dela entram no cálculo.
- **CA-RF15-1** — _Ajuste não é trade._ **Dado** uma conta com 10 trades e um saque de US$ 1.000,00; **quando** consulto as métricas; **então** o número de trades é 10 e o resultado líquido não inclui o saque; **e** o saldo atual inclui o saque.
- **CA-RF16-1** — _Exclusão exige confirmação._ **Dado** uma conta com trades; **quando** peço a exclusão sem a confirmação do nome; **então** recebo `400 CONFIRMATION_REQUIRED`; **e** a conta continua existindo.
- **CA-RF17-1** — _Limite do plano._ **Dado** um Trader no plano com limite de 3 contas ativas e 3 contas ativas; **quando** cria a quarta; **então** recebe `402 PLAN_LIMIT_REACHED`.

---

### 4.4 Instrumentos

| ID    | Requisito                                                     | Observação                                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-18 | Catálogo global de instrumentos com especificação de contrato | Alta. Tabela global (sem tenant), mantida pelo Admin (RF-75), versionada por vigência (`validFrom`/`validTo`) para que mudança de especificação não altere trades antigos. Campos: raiz, nome, bolsa, tick size, valor por tick, moeda, sessão (fuso e horários), meses de vencimento. Seed da v1 abaixo.           |
| RF-19 | Resolução de símbolo de contrato para o instrumento           | Alta. Reconhece as formas usadas por NinjaTrader e Tradovate (`NQZ6`, `NQZ26`, `NQ 12-26`, `MNQZ2026`, `ESH7`, `MES 03-27`) e devolve raiz + vencimento. Ordem de verificação garante que `MNQ`/`MES` não sejam lidos como `NQ`/`ES`. Símbolo não reconhecido → `UNSUPPORTED_INSTRUMENT`.                           |
| RF-20 | Cálculo de resultado por tick                                 | Alta. `resultado bruto = (ticks ganhos) × valor por tick × quantidade`, com `ticks = (saída − entrada) / tick size` (sinal invertido na venda). Preço fora da grade do tick (não múltiplo de 0,25) é recusado no registro manual e reportado na importação. Implementado no domínio como `TickCalculator`, sem I/O. |

**Seed de instrumentos da v1**

| Raiz  | Nome                    | Bolsa | Tick size | Valor por tick | Valor por ponto |
| ----- | ----------------------- | ----- | --------- | -------------- | --------------- |
| `NQ`  | E-mini Nasdaq-100       | CME   | 0,25      | US$ 5,00       | US$ 20,00       |
| `MNQ` | Micro E-mini Nasdaq-100 | CME   | 0,25      | US$ 0,50       | US$ 2,00        |
| `ES`  | E-mini S&P 500          | CME   | 0,25      | US$ 12,50      | US$ 50,00       |
| `MES` | Micro E-mini S&P 500    | CME   | 0,25      | US$ 1,25       | US$ 5,00        |

Sessão CME Globex para os quatro: domingo a sexta, 17:00–16:00 `America/Chicago`, pausa diária 16:00–17:00. Meses de vencimento: H, M, U, Z. Os valores da tabela são validados contra a especificação oficial da CME na Fase 0 (questão 10.4).

**Aceite**

- **CA-RF18-1** — _Catálogo global vigente._ **Dado** o seed da v1; **quando** os Traders A e B consultam o instrumento `MNQ` vigente; **então** ambos recebem tick size 0,25 e valor por tick US$ 0,50; **e** nenhum dos dois pode alterá-lo (`404` nas rotas de escrita do catálogo).
- **CA-RF19-1** — _Resolução de símbolo (esquema do cenário)._ **Dado** o catálogo da v1; **quando** resolvo o símbolo `<símbolo>`; **então** obtenho a raiz `<raiz>` e o vencimento `<vencimento>`.

  | símbolo     | raiz  | vencimento                |
  | ----------- | ----- | ------------------------- |
  | `NQZ6`      | `NQ`  | 2026-12                   |
  | `NQ 12-26`  | `NQ`  | 2026-12                   |
  | `MNQZ2026`  | `MNQ` | 2026-12                   |
  | `MNQ 12-26` | `MNQ` | 2026-12                   |
  | `ESH7`      | `ES`  | 2027-03                   |
  | `MES 03-27` | `MES` | 2027-03                   |
  | `CLZ6`      | —     | `UNSUPPORTED_INSTRUMENT`  |
  | `NQ`        | `NQ`  | sem vencimento (contínuo) |

- **CA-RF20-1** — _Resultado por tick (esquema do cenário)._ **Dado** um trade de `<instrumento>`, `<direção>`, `<qtd>` contrato(s), entrada `<entrada>` e saída `<saída>`; **quando** o resultado bruto é calculado; **então** é exatamente `<resultado>`.

  | instrumento | direção | qtd | entrada  | saída    | resultado   |
  | ----------- | ------- | --- | -------- | -------- | ----------- |
  | NQ          | LONG    | 1   | 21000.00 | 21010.25 | US$ 205,00  |
  | NQ          | SHORT   | 2   | 21000.00 | 21010.25 | −US$ 410,00 |
  | MNQ         | LONG    | 5   | 21000.00 | 21000.25 | US$ 2,50    |
  | ES          | LONG    | 1   | 6000.00  | 5999.75  | −US$ 12,50  |
  | MES         | SHORT   | 10  | 6000.00  | 5990.00  | US$ 500,00  |

- **CA-RF20-2** — _Preço fora da grade._ **Dado** um registro manual de NQ; **quando** informo a entrada `21000.10`; **então** recebo `400 PRICE_OFF_TICK_GRID`.
- **CA-RF20-3** — _Sem ponto flutuante._ **Dado** 1.000 trades de MNQ de +1 tick (US$ 0,50) cada; **quando** somo o resultado; **então** o total é exatamente US$ 500,00, sem resíduo de arredondamento.

---

### 4.5 Registro Manual de Trades

> **Modelo.** Um `Trade` é uma operação completa (de flat a flat) num instrumento e numa conta. É composto por uma ou mais **execuções** (`Execution`: compra/venda, quantidade, preço, instante, comissão e taxas). Entradas e saídas parciais são execuções; preço médio de entrada e saída, quantidade máxima, resultado e duração são **derivados** das execuções, nunca digitados. Um registro simples (uma entrada, uma saída) é só um trade com duas execuções.

| ID    | Requisito                                        | Observação                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-21 | Registrar trade manualmente                      | Alta. Campos obrigatórios: conta, instrumento (ou símbolo de contrato), direção, ao menos uma execução de entrada. Modo simples (entrada/saída/quantidade) e modo avançado (lista de execuções). Comissões e taxas por execução ou totais do trade. `source = MANUAL`.                                                                                                                                             |
| RF-22 | Trade aberto                                     | Alta. Trade sem execução que zere a posição fica `OPEN`: aparece no diário, **não** entra em métricas nem nas regras de mesa até ser fechado. A soma das execuções nunca pode inverter a posição (de comprado para vendido) num mesmo trade: `400 POSITION_FLIP_NOT_ALLOWED` — o Trader registra dois trades.                                                                                                      |
| RF-23 | Gestão de risco planejada e múltiplo de R        | Alta. Stop inicial e alvo planejado (preços, opcionais). Com stop: risco planejado (`Money`) e **múltiplo de R** = resultado líquido ÷ risco planejado (decimal com 2 casas). Sem stop, o R fica indefinido e o trade sai das métricas de R (mas não das demais).                                                                                                                                                  |
| RF-24 | Editar e excluir trade                           | Alta. Editar execuções recalcula o trade, as métricas e as regras de mesa da conta. Trade importado pode ser editado; a edição fica marcada (`isEditedAfterImport`) para a deduplicação (RF-36). Exclusão lógica com desfazer por 30 dias (lixeira), depois definitiva.                                                                                                                                            |
| RF-25 | Validações de consistência                       | Alta. Saída anterior à entrada, quantidade ≤ 0, instrumento fora do catálogo, preço fora da grade, instante no futuro e conta arquivada são recusados com `code` próprio. Quantidade acima do máximo de contratos da conta de mesa **é aceita**, mas registra uma violação (RF-54).                                                                                                                                |
| RF-87 | Modalidade da operação: day trade ou swing trade | Alta — novo (revisão 1.1). Atributo **do trade**, nunca do Trader nem da conta, **derivado** das execuções: `DAY_TRADE` quando a abertura e o fechamento caem no **mesmo dia de pregão** (RF-48); `SWING_TRADE` quando a posição atravessa ao menos um fechamento de sessão. Trade `OPEN` fica sem modalidade até fechar. Recalculada a cada edição de execução. Disponível como filtro (RF-46) e recorte (RF-45). |

**Aceite**

- **CA-RF21-1** — _Registro simples._ **Dado** a Conta Própria do Trader A; **quando** registra NQ LONG 1 contrato, entrada 21000.00 às 10:00 e saída 21010.00 às 10:05 (horário de Nova York), com US$ 4,12 de comissão e taxas; **então** o trade fica `CLOSED` com resultado bruto US$ 200,00, líquido US$ 195,88 e duração de 5 minutos.
- **CA-RF21-2** — _Execuções parciais._ **Dado** o Trader A; **quando** registra MNQ LONG com compras de 2 @ 21000.00 e 2 @ 20990.00 e vendas de 3 @ 21010.00 e 1 @ 21020.00; **então** a entrada média é 20995.00, a saída média é 21012.50, a quantidade máxima é 4 e o resultado bruto é US$ 140,00.
- **CA-RF21-3** — _Conta de outro tenant._ **Dado** o Trader A; **quando** registra um trade informando uma conta do Trader B; **então** recebe `404 NOT_FOUND`; **e** nenhum trade é criado.
- **CA-RF22-1** — _Trade aberto fora das métricas._ **Dado** um trade `OPEN`; **quando** consulto as métricas; **então** ele não é contado; **e** aparece no diário com o rótulo "Aberto".
- **CA-RF22-2** — _Virada de posição._ **Dado** um trade LONG de 2 contratos; **quando** registro uma venda de 3 contratos nele; **então** recebo `400 POSITION_FLIP_NOT_ALLOWED`.
- **CA-RF23-1** — _Múltiplo de R._ **Dado** um trade ES LONG 1 contrato, entrada 6000.00, stop 5995.00 e resultado líquido de US$ 500,00; **quando** o R é calculado; **então** o risco planejado é US$ 250,00 e o R é 2,00.
- **CA-RF23-2** — _Sem stop, sem R._ **Dado** um trade sem stop inicial; **quando** consulto o R médio; **então** esse trade não entra no cálculo do R; **e** entra na taxa de acerto e no resultado.
- **CA-RF24-1** — _Editar recalcula._ **Dado** um trade de +US$ 200,00 numa conta de mesa; **quando** corrijo a saída para um resultado de −US$ 300,00; **então** as métricas e o status da conta de mesa refletem o novo valor.
- **CA-RF24-2** — _Lixeira._ **Dado** um trade excluído há 10 dias; **quando** o restauro; **então** ele volta às métricas; **e** **dado** um trade excluído há 31 dias, ele não existe mais.
- **CA-RF25-1** — _Validações (esquema do cenário)._ **Dado** o Trader A; **quando** registra um trade com `<problema>`; **então** recebe `400` com `code` `<code>`.

  | problema               | code                     |
  | ---------------------- | ------------------------ |
  | saída antes da entrada | `EXIT_BEFORE_ENTRY`      |
  | quantidade 0           | `VALIDATION_ERROR`       |
  | instrumento `CL`       | `UNSUPPORTED_INSTRUMENT` |
  | entrada amanhã         | `EXECUTION_IN_FUTURE`    |
  | conta arquivada        | `ACCOUNT_ARCHIVED`       |

- **CA-RF87-1** — _Modalidade derivada (esquema do cenário)._ **Dado** um trade de NQ aberto em `<abertura CT>` e fechado em `<fechamento CT>`; **quando** é gravado; **então** a modalidade é `<modalidade>`.

  | abertura CT          | fechamento CT        | modalidade                                        |
  | -------------------- | -------------------- | ------------------------------------------------- |
  | seg 2026-03-09 09:00 | seg 2026-03-09 15:30 | `DAY_TRADE`                                       |
  | seg 2026-03-09 17:30 | ter 2026-03-10 09:00 | `DAY_TRADE` (mesmo dia de pregão)                 |
  | seg 2026-03-09 15:00 | seg 2026-03-09 17:30 | `SWING_TRADE` (atravessou o fechamento das 16:00) |
  | seg 2026-03-09 10:00 | qui 2026-03-12 11:00 | `SWING_TRADE`                                     |

- **CA-RF87-2** — _Modalidade não depende da conta._ **Dado** o Trader A com uma Conta Própria e uma Conta de Mesa; **quando** registra um day trade e um swing trade em cada uma; **então** as quatro operações são aceitas; **e** o recorte por modalidade mostra 2 day trades e 2 swing trades.
- **CA-RF87-3** — _Edição recalcula a modalidade._ **Dado** um `DAY_TRADE`; **quando** corrijo a saída para o dia de pregão seguinte; **então** o trade passa a `SWING_TRADE`.

---

### 4.6 Contexto do Trade (Diário)

| ID    | Requisito                  | Observação                                                                                                                                                                                                                                                                                                                                    |
| ----- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-26 | Setups do tenant           | Alta. Catálogo de setups **por tenant** (nome, descrição, regras de entrada em texto, cor). Um trade tem zero ou um setup. Nome único por tenant (sem diferenciar maiúsculas). Excluir setup em uso exige escolher outro ou "sem setup".                                                                                                      |
| RF-27 | Estado emocional           | Alta. Antes e depois do trade, em escala fechada (enum traduzível): `CALM`, `CONFIDENT`, `ANXIOUS`, `FEARFUL`, `GREEDY`, `FRUSTRATED`, `EUPHORIC`, `BORED`, mais intensidade de 1 a 5. Os rótulos vêm do catálogo de tradução (RF-62), nunca do banco.                                                                                        |
| RF-28 | Tags e erros               | Alta. Tags livres por tenant (ex.: "notícia", "abertura") e uma lista de **erros** padronizados e traduzíveis (`FOMO_ENTRY`, `MOVED_STOP`, `NO_STOP`, `OVERSIZED`, `REVENGE_TRADE`, `EARLY_EXIT`, `LATE_ENTRY`, `IGNORED_SETUP`, `OVERTRADING`), extensível com erros próprios do tenant.                                                     |
| RF-29 | Notas e aderência ao plano | Alta. Nota de texto rico (Markdown limitado, sanitizado) por trade. Pergunta "Segui meu plano?" (`YES`/`PARTIAL`/`NO`) e nota de qualidade da execução (1 a 5).                                                                                                                                                                               |
| RF-30 | Capturas do gráfico        | Alta. Até 5 imagens por trade (PNG, JPEG, WebP; até 5 MB cada), com legenda. Upload direto ao storage por URL pré-assinada; o servidor valida tipo real (magic bytes), remove metadados EXIF e gera miniatura. Armazenadas em `tenants/<tenantId>/…` e servidas só por URL assinada de curta duração (§3.2). Cota de armazenamento por plano. |
| RF-31 | Revisão diária             | Média. Uma entrada de diário por dia de pregão e tenant: plano pré-mercado, humor geral, lições e nota do dia (1 a 5). A tela mostra ao lado os trades e o resultado daquele dia.                                                                                                                                                             |
| RF-32 | Edição de contexto em lote | Média. Selecionar vários trades e aplicar setup, tags ou erros de uma vez — essencial depois de uma importação.                                                                                                                                                                                                                               |

**Aceite**

- **CA-RF26-1** — _Setup é do tenant._ **Dado** o Trader A com o setup "Rompimento" e o Trader B sem setups; **quando** o Trader B lista seus setups; **então** a lista é vazia; **e** **quando** B tenta associar o setup de A a um trade seu, recebe `404`.
- **CA-RF26-2** — _Nome duplicado._ **Dado** o setup "Rompimento" no tenant A; **quando** o Trader A cria "rompimento"; **então** recebe `409 SETUP_NAME_TAKEN`; **e** o Trader B pode criar "Rompimento" no próprio tenant.
- **CA-RF27-1** — _Rótulo no idioma do usuário._ **Dado** um trade com emoção `ANXIOUS`; **quando** um Trader com idioma `en` o abre; **então** vê "Anxious"; **e** com `pt-BR`, vê "Ansioso".
- **CA-RF28-1** — _Erros próprios são do tenant._ **Dado** o Trader A com o erro próprio "Operou cansado"; **quando** o Trader B lista os erros disponíveis; **então** vê apenas os erros padrão, traduzidos no seu idioma; **e** não vê "Operou cansado".
- **CA-RF29-1** — _Nota é sanitizada._ **Dado** o Trader A; **quando** salva uma nota com `<script>alert(1)</script>`; **então** a nota é gravada sem o script; **e** nenhum código é executado ao exibi-la.
- **CA-RF30-1** — _Captura de outro tenant._ **Dado** uma captura do Trader B; **quando** o Trader A pede a URL dela pelo identificador; **então** recebe `404`.
- **CA-RF30-2** — _Tipo falso._ **Dado** um arquivo executável renomeado para `grafico.png`; **quando** o Trader A conclui o upload; **então** o arquivo é recusado com `415 UNSUPPORTED_MEDIA_TYPE` e removido do storage.
- **CA-RF30-3** — _Limites (esquema do cenário)._ **Dado** um trade com `<n>` capturas; **quando** envio outra de `<tamanho>`; **então** o resultado é `<resultado>`.

  | n   | tamanho | resultado              |
  | --- | ------- | ---------------------- |
  | 4   | 5 MB    | aceita                 |
  | 4   | 5,1 MB  | `413 FILE_TOO_LARGE`   |
  | 5   | 1 MB    | `409 ATTACHMENT_LIMIT` |

- **CA-RF31-1** — _Uma revisão por dia._ **Dado** uma revisão do dia 2026-03-10; **quando** o Trader cria outra para o mesmo dia; **então** a existente é aberta para edição, sem duplicar.
- **CA-RF32-1** — _Lote só no próprio tenant._ **Dado** uma seleção com 3 trades do Trader A e 1 identificador de trade do Trader B; **quando** A aplica o setup em lote; **então** a operação inteira é recusada com `404`; **e** nenhum trade é alterado.

---

### 4.7 Importação por CSV

> **Pipeline.** `upload → detecção de layout → parse por linha → normalização para NormalizedTrade (modelo agnóstico do domínio) → validação de domínio → deduplicação → prévia → confirmação → persistência`. Os parsers de NinjaTrader e Tradovate são **adaptadores** (porta `TradeImportParser`) na camada de infraestrutura; o domínio só conhece `NormalizedTrade`. Adicionar uma plataforma é adicionar um adaptador, sem tocar no domínio (Open/Closed).

| ID    | Requisito                                            | Observação                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-33 | Importar CSV do NinjaTrader                          | Alta. Layout "Trades" do Trade Performance (colunas como `Trade number`, `Instrument`, `Account`, `Market pos.`, `Qty`, `Entry price`, `Exit price`, `Entry time`, `Exit time`, `Profit`, `Commission`). Aceita separador `,` ou `;`, decimal `.` ou `,` e formatos de data da cultura do NinjaTrader (en-US e pt-BR). Layout exato validado com arquivos reais (questão 10.5). |
| RF-34 | Importar CSV do Tradovate                            | Alta. Layout "Performance" (colunas como `symbol`, `qty`, `buyPrice`, `sellPrice`, `pnl`, `boughtTimestamp`, `soldTimestamp`, `buyFillId`, `sellFillId`) e, como segunda opção, o layout de execuções ("Fills"), agrupado em trades pelo domínio. Layout exato validado com arquivos reais (questão 10.5).                                                                      |
| RF-35 | Detecção de layout e prévia antes de gravar          | Alta. O sistema detecta a plataforma e o layout pelo cabeçalho; se ambíguo, pede ao Trader. A prévia mostra trades válidos, duplicados e linhas com erro, com o resultado calculado pelo Hypomna ao lado do resultado informado no arquivo, e destaca divergências.                                                                                                             |
| RF-36 | Tolerância a falhas parciais e relatório por linha   | Alta. Linha inválida **não** descarta o lote: é reportada com número da linha, coluna, valor e `code` do motivo (`UNSUPPORTED_INSTRUMENT`, `INVALID_DATE`, `PRICE_OFF_TICK_GRID`, `MISSING_COLUMN`, `PNL_MISMATCH`, …). O relatório é baixável em CSV. Se o arquivo inteiro for ilegível (sem cabeçalho reconhecido), o lote falha com `UNRECOGNIZED_LAYOUT`.                   |
| RF-37 | Deduplicação e idempotência                          | Alta. Cada trade importado tem uma **impressão digital** (`fingerprint`) derivada de conta, instrumento, execuções (instante, preço, quantidade) e identificador da plataforma quando existir. Reimportar o mesmo arquivo, ou um arquivo com período sobreposto, não duplica trades. Unique `(tenantId, accountId, fingerprint)` no banco.                                      |
| RF-38 | Mapeamento de conta da plataforma para conta Hypomna | Alta. Cada valor distinto da coluna de conta do CSV é mapeado para uma conta do tenant (sugestão automática pelo identificador da conta, RF-11; o Trader confirma). O mapeamento é lembrado para as próximas importações.                                                                                                                                                       |
| RF-39 | Fuso horário do arquivo                              | Alta. O Trader informa o fuso em que a plataforma exportou os horários (padrão: o último usado para aquela plataforma; sugestão: fuso do Trader). Todo instante é convertido para UTC antes de gravar.                                                                                                                                                                          |
| RF-40 | Processamento assíncrono e limites                   | Alta. Arquivo de até 10 MB e 50.000 linhas; processamento em fila (BullMQ) com progresso visível; o `ImportBatch` registra status (`UPLOADED`, `PARSING`, `PREVIEW_READY`, `COMMITTING`, `COMPLETED`, `FAILED`). Limite de importações por mês conforme o plano.                                                                                                                |
| RF-41 | Histórico de importações e desfazer lote             | Média. Lista de lotes com data, arquivo, plataforma e contagens (importados, duplicados, com erro). "Desfazer importação" remove os trades daquele lote que não foram editados depois; os editados são listados para decisão do Trader.                                                                                                                                         |
| RF-42 | O arquivo é dado não confiável                       | Alta. Proteção contra _CSV injection_ no relatório de erros exportado (células iniciadas por `=`, `+`, `-`, `@` são escapadas); nenhuma célula vira fórmula, HTML ou comando; o arquivo original é guardado no storage do tenant por 30 dias e depois apagado.                                                                                                                  |

**Aceite**

- **CA-RF33-1** — _Importação NinjaTrader válida._ **Dado** o arquivo de exemplo `ninjatrader-trades-ok.csv` com 20 trades de NQ e MNQ; **quando** o Trader A o importa para a conta mapeada; **então** 20 trades são criados com `source = IMPORT_NINJATRADER`; **e** o resultado de cada trade calculado pelo Hypomna bate com a coluna `Profit` do arquivo.
- **CA-RF34-1** — _Importação Tradovate válida._ **Dado** o arquivo `tradovate-performance-ok.csv` com 15 linhas de ES e MES; **quando** o Trader A o importa; **então** 15 trades são criados com `source = IMPORT_TRADOVATE`; **e** o total líquido bate com a soma da coluna `pnl` descontadas as comissões informadas.
- **CA-RF34-2** — _Execuções agrupadas em trades._ **Dado** um arquivo de execuções do Tradovate com compra 2, venda 1, venda 1 em MNQ; **quando** é importado; **então** vira um único trade com três execuções.
- **CA-RF35-1** — _Nada é gravado antes da confirmação._ **Dado** um lote em `PREVIEW_READY`; **quando** o Trader abandona a prévia; **então** nenhum trade foi criado.
- **CA-RF35-2** — _Divergência de resultado é destacada._ **Dado** uma linha cujo `Profit` informado difere do resultado calculado em mais de US$ 0,01; **quando** a prévia é gerada; **então** a linha é marcada com `PNL_MISMATCH`; **e** o Trader escolhe importá-la assim mesmo (vale o cálculo do Hypomna) ou ignorá-la.
- **CA-RF36-1** — _Falha parcial._ **Dado** um arquivo com 100 linhas, 3 delas com data inválida e 2 com o instrumento `CL`; **quando** o Trader confirma a importação; **então** 95 trades são criados; **e** o relatório lista as 5 linhas com número, coluna e `code` (`INVALID_DATE` ×3, `UNSUPPORTED_INSTRUMENT` ×2).
- **CA-RF36-2** — _Arquivo irreconhecível._ **Dado** um CSV de extrato bancário; **quando** é enviado; **então** o lote fica `FAILED` com `UNRECOGNIZED_LAYOUT`; **e** nenhum trade é criado.
- **CA-RF37-1** — _Reimportar não duplica._ **Dado** que o arquivo `ninjatrader-trades-ok.csv` já foi importado; **quando** o Trader A o importa de novo; **então** a prévia mostra 20 duplicados e 0 novos; **e** confirmar não cria nenhum trade.
- **CA-RF37-2** — _Período sobreposto._ **Dado** um arquivo de 1 a 15 de março já importado; **quando** o Trader importa outro de 10 a 31 de março; **então** só os trades de 16 a 31 (e os de 10 a 15 que não existiam) são criados.
- **CA-RF37-3** — _Mesma operação em tenants diferentes._ **Dado** que o Trader B importou um arquivo idêntico ao do Trader A; **quando** o Trader A importa o seu; **então** os trades de A são criados normalmente (a deduplicação é por tenant).
- **CA-RF38-1** — _Mapeamento lembrado._ **Dado** que o Trader mapeou a conta `APEX-12345` do CSV para a conta "Apex 50K #1"; **quando** importa outro arquivo com `APEX-12345`; **então** o mapeamento vem preenchido.
- **CA-RF39-1** — _Conversão de fuso._ **Dado** um arquivo com entrada `03/10/2026 09:35:00` exportado em `America/New_York`; **quando** é importado; **então** o instante gravado é `2026-03-10T13:35:00Z`.
- **CA-RF40-1** — _Arquivo grande demais._ **Dado** um arquivo de 12 MB; **quando** é enviado; **então** recebo `413 FILE_TOO_LARGE`; **e** nenhum lote é criado.
- **CA-RF40-2** — _Job restabelece o tenant._ **Dado** um job de importação do tenant A; **quando** é processado; **então** todas as leituras e escritas ocorrem com o `TenantContext` de A; **e** um job cujo payload não tem `tenantId` válido falha sem acessar dado.
- **CA-RF41-1** — _Desfazer lote._ **Dado** um lote de 20 trades em que 2 foram editados depois; **quando** o Trader desfaz o lote; **então** 18 trades são removidos; **e** os 2 editados são listados para decisão.
- **CA-RF42-1** — _CSV injection._ **Dado** uma linha com a conta `=HYPERLINK("http://mal.example")`; **quando** baixo o relatório de erros; **então** a célula começa com `'` e não é interpretada como fórmula.

---

### 4.8 Métricas de Desempenho

> **Fonte única de cálculo.** Todas as métricas são calculadas no domínio (`PerformanceCalculator`, puro, sem I/O) sobre trades `CLOSED`, a partir de `Money` e decimais exatos, e expostas pela API. A interface nunca recalcula métrica. Por padrão as métricas usam o resultado **líquido** (RF-10).

| ID    | Requisito                      | Observação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-43 | Métricas centrais              | Alta. Número de trades; resultado líquido e bruto; comissões e taxas totais; **taxa de acerto** (ganhos ÷ trades, trade de resultado zero é _breakeven_ e fica fora do numerador e do denominador); **ganho médio** e **perda média**; **payoff** (ganho médio ÷ \|perda média\|); **expectativa** por trade (resultado líquido ÷ trades) e em R; **fator de lucro** (soma dos ganhos ÷ \|soma das perdas\|); maior ganho e maior perda; sequências máximas de ganhos e de perdas; duração média de ganhadores e perdedores. Divisão por zero devolve `null` (exibido como "—"), nunca `Infinity`/`NaN`. |
| RF-44 | Drawdown e curva de patrimônio | Alta. Curva de patrimônio por trade e por dia (saldo inicial + resultados + ajustes, RF-15); **drawdown máximo** (valor e %) e drawdown atual, sobre o pico do patrimônio fechado.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| RF-45 | Recortes                       | Alta. Todas as métricas centrais agrupadas por: setup, instrumento, conta, **finalidade da conta** (própria/mesa), **modalidade** (day/swing, RF-87), direção, **faixa horária** (blocos de 30 min no fuso da sessão do instrumento), dia da semana, duração do trade, emoção, aderência ao plano e erro.                                                                                                                                                                                                                                                                                                |
| RF-46 | Filtros combináveis            | Alta. Período (presets e intervalo), contas (inclui arquivadas opcionalmente), finalidade da conta, modalidade, instrumentos, setups, tags, erros, direção, origem (manual/importado). Os filtros valem para métricas, recortes, calendário e lista de trades, e ficam na URL para compartilhar o mesmo recorte entre abas.                                                                                                                                                                                                                                                                              |
| RF-47 | Calendário de resultado diário | Alta. Mapa de calor mensal com resultado líquido e número de trades por dia de pregão; clicar no dia abre os trades e a revisão diária (RF-31). Totais por semana e por mês.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| RF-48 | Dia de pregão                  | Alta. O dia de um trade é o **dia de pregão** do instrumento, pelo instante de **saída**: na CME, a sessão que começa às 17:00 de `America/Chicago` pertence ao dia seguinte. Ex.: trade fechado na segunda às 18:00 CT pertence à terça. Com a preferência `CALENDAR` (RF-10), usa a meia-noite no fuso do Trader. Horário de verão tratado pelo fuso IANA, nunca por deslocamento fixo.                                                                                                                                                                                                                |
| RF-49 | Métricas comportamentais       | Média. Resultado e taxa de acerto por emoção (antes do trade), por aderência ao plano e por erro; custo total de cada erro ("quanto o `MOVED_STOP` custou no período"); comparação "com plano" × "sem plano".                                                                                                                                                                                                                                                                                                                                                                                            |
| RF-50 | Dashboard do Trader            | Alta. Tela inicial de `apps/web`: resultado do período, curva de patrimônio, métricas centrais, calendário resumido, os três melhores e piores setups, os erros mais caros e um card por conta de mesa ativa com o status (RF-56). Período padrão: mês corrente.                                                                                                                                                                                                                                                                                                                                         |

**Aceite**

- **CA-RF43-1** — _Métricas centrais (conjunto de referência)._ **Dado** os trades líquidos +200, +100, −50, −150, 0 (US$); **quando** calculo as métricas; **então** trades = 5, taxa de acerto = 50,00% (2 de 4, o _breakeven_ fica fora), ganho médio = 150,00, perda média = −100,00, payoff = 1,50, expectativa = 20,00, fator de lucro = 1,50, resultado líquido = 100,00.
- **CA-RF43-2** — _Sem perdas._ **Dado** apenas trades ganhadores; **quando** calculo payoff e fator de lucro; **então** ambos são `null`; **e** a tela mostra "—".
- **CA-RF43-3** — _Sem trades._ **Dado** um período sem trades fechados; **quando** consulto as métricas; **então** trades = 0, resultado = US$ 0,00 e as razões são `null`.
- **CA-RF44-1** — _Drawdown máximo._ **Dado** saldo inicial de US$ 10.000,00 e resultados diários +500, −300, −400, +1.000; **quando** calculo o drawdown; **então** o pico é 10.500,00, o drawdown máximo é US$ 700,00 (6,67%) e o drawdown atual é 0.
- **CA-RF45-1** — _Recorte por setup._ **Dado** 3 trades do setup "Rompimento" (+100, +100, −50) e 2 do "Reversão" (−100, −100); **quando** consulto o recorte por setup; **então** "Rompimento" tem resultado 150,00 e acerto 66,67%; **e** "Reversão" tem −200,00 e acerto 0,00%.
- **CA-RF45-2** — _Recorte só do próprio tenant._ **Dado** os Traders A e B com o setup "Rompimento"; **quando** A consulta o recorte por setup; **então** só os trades de A entram.
- **CA-RF46-1** — _Filtro combinado._ **Dado** trades de NQ e ES em duas contas; **quando** filtro instrumento NQ e a conta 1; **então** métricas, calendário e lista mostram só os trades de NQ da conta 1.
- **CA-RF47-1** — _Calendário diário._ **Dado** dois trades no dia de pregão 2026-03-10 (+US$ 200,00 e −US$ 50,00) e um no dia 2026-03-11 (−US$ 30,00); **quando** abro o calendário de março; **então** o dia 10 mostra +US$ 150,00 e 2 trades; **e** o dia 11 mostra −US$ 30,00 e 1 trade; **e** a semana soma +US$ 120,00.
- **CA-RF48-1** — _Dia de pregão (esquema do cenário)._ **Dado** um trade de NQ com saída em `<instante CT>`; **quando** o dia de pregão é calculado com a preferência `SESSION`; **então** o dia é `<dia>`.

  | instante CT          | dia        |
  | -------------------- | ---------- |
  | seg 2026-03-09 15:59 | 2026-03-09 |
  | seg 2026-03-09 17:00 | 2026-03-10 |
  | dom 2026-03-08 18:30 | 2026-03-09 |
  | sex 2026-03-13 15:00 | 2026-03-13 |

- **CA-RF48-2** — _Horário de verão._ **Dado** trades fechados às 16:30 de Brasília antes e depois da mudança de horário de verão nos EUA (8 de março de 2026); **quando** calculo a faixa horária no fuso da sessão; **então** a faixa reflete o horário de Chicago correto em cada data.
- **CA-RF49-1** — _Custo do erro._ **Dado** 4 trades com o erro `MOVED_STOP` somando −US$ 800,00; **quando** consulto o recorte por erro; **então** `MOVED_STOP` mostra 4 trades e −US$ 800,00.
- **CA-RF50-1** — _Dashboard vazio._ **Dado** um Trader recém-cadastrado sem trades; **quando** abre o dashboard; **então** vê o estado vazio com os atalhos "Criar conta", "Importar CSV" e "Registrar trade", sem erro.

---

### 4.9 Status das Contas de Mesa Proprietária

> **Princípio.** O Hypomna **calcula** as regras de cada `PropFirmAccount` a partir dos trades e ajustes registrados, como um espelho da mesa. O resultado é **informativo**: a mesa é a fonte oficial, e diferenças de dado (trades não importados, slippage, taxas) são explicitadas na tela. Todas as regras são implementadas no domínio como políticas independentes (`DrawdownPolicy`, `DailyLossLimitPolicy`, `ProfitTargetPolicy`, `ConsistencyPolicy`, `MinTradingDaysPolicy`, `MaxContractsPolicy`), cada uma com testes de esquema do cenário.

| ID    | Requisito                                        | Observação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-51 | Drawdown máximo por tipo                         | Alta. **Nível de liquidação** (saldo abaixo do qual a conta viola) calculado conforme o tipo: `STATIC` = saldo inicial − drawdown; `TRAILING_END_OF_DAY` = maior saldo **de fechamento de dia de pregão** − drawdown; `TRAILING_INTRADAY` = maior saldo **atingido**, considerando o resultado não realizado quando disponível — na v1, com dados de CSV, aproximado pelo maior saldo realizado após cada trade (limitação explicada na tela, DT-05). Com trava: o nível para de subir ao alcançar o valor de trava. |
| RF-52 | Limite de perda diária                           | Alta. Perda líquida do dia de pregão (RF-48) ≥ limite → violação do dia.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| RF-53 | Meta de lucro                                    | Alta. Progresso = (saldo atual − saldo inicial) ÷ meta, em %.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| RF-54 | Consistência, dias mínimos e máximo de contratos | Alta. Consistência: (melhor dia ÷ lucro total) ≤ % da regra; dias mínimos: dias de pregão com ao menos um trade fechado; máximo de contratos: quantidade máxima de um trade por instrumento (micros contam pela razão definida na regra, padrão 10 micros = 1 mini).                                                                                                                                                                                                                                                 |
| RF-55 | Status consolidado e violação                    | Alta. Status por regra: `OK`, `WARNING` (≥ 80% do limite consumido, configurável), `VIOLATED`; status da conta: `ON_TRACK`, `AT_RISK`, `VIOLATED`, `TARGET_REACHED` (meta atingida e demais regras cumpridas). Violação detectada não muda a conta para `FAILED` sozinha: o Trader confirma (RF-14), porque o dado pode estar incompleto.                                                                                                                                                                            |
| RF-56 | Painel da conta de mesa                          | Alta. Para cada conta de mesa: saldo atual, nível de liquidação e **distância até ele** (US$ e em ticks de cada instrumento suportado), perda do dia × limite, progresso da meta, consistência atual, dias operados × mínimo e o histórico de violações com data e trade que as causou. Também no dashboard (RF-50).                                                                                                                                                                                                 |
| RF-57 | Recalcular após qualquer mudança                 | Alta. Criar, editar, excluir ou importar trade, ajustar saldo ou alterar regras recalcula o status da conta (em fila quando a mudança atingir mais de 500 trades), de forma determinística: o mesmo conjunto de dados sempre produz o mesmo status.                                                                                                                                                                                                                                                                  |

**Aceite**

- **CA-RF51-1** — _Drawdown (esquema do cenário)._ **Dado** uma conta de mesa de US$ 50.000,00 com drawdown de US$ 2.500,00 do tipo `<tipo>` e saldos de fechamento diários 50.000 → 51.000 → 50.400; **quando** calculo o nível de liquidação; **então** ele é `<nível>`.

  | tipo                  | nível         |
  | --------------------- | ------------- |
  | `STATIC`              | US$ 47.500,00 |
  | `TRAILING_END_OF_DAY` | US$ 48.500,00 |

- **CA-RF51-2** — _Trava do drawdown._ **Dado** uma conta `TRAILING_END_OF_DAY` de US$ 50.000,00, drawdown de US$ 2.500,00 e trava em US$ 50.100,00, com maior fechamento de US$ 54.000,00; **quando** calculo o nível de liquidação; **então** ele é US$ 50.100,00.
- **CA-RF51-3** — _Trailing intradiário pelo maior saldo realizado._ **Dado** uma conta `TRAILING_INTRADAY` de US$ 50.000,00, drawdown de US$ 2.500,00 e, no mesmo dia, trades de +800 e −300; **quando** calculo o nível; **então** ele é US$ 48.300,00; **e** a tela informa que o resultado não realizado não está disponível no CSV.
- **CA-RF52-1** — _Perda diária._ **Dado** uma conta com limite de perda diária de US$ 1.000,00 e trades no mesmo dia de pregão de −600 e −450; **quando** o status é calculado; **então** a regra de perda diária fica `VIOLATED` naquele dia, com o trade de −450 como causa.
- **CA-RF52-2** — _Perda no limite de sessões._ **Dado** um trade de −600 fechado às 15:30 CT de segunda e outro de −450 às 17:30 CT de segunda; **quando** o status é calculado; **então** os trades pertencem a dias de pregão diferentes; **e** a perda diária não é violada.
- **CA-RF53-1** — _Progresso da meta._ **Dado** uma conta de US$ 50.000,00 com meta de US$ 3.000,00 e saldo atual de US$ 51.500,00; **quando** consulto o painel; **então** o progresso é 50,00%.
- **CA-RF54-1** — _Consistência._ **Dado** uma regra de consistência de 30% e lucro total de US$ 3.000,00 com melhor dia de US$ 1.200,00; **quando** o status é calculado; **então** a consistência é 40,00% e a regra fica `VIOLATED`.
- **CA-RF54-2** — _Máximo de contratos com micros._ **Dado** uma regra de no máximo 5 contratos e razão de 10 micros por mini; **quando** registro um trade de 60 MNQ; **então** o trade é gravado; **e** a regra de contratos fica `VIOLATED` com esse trade como causa.
- **CA-RF55-1** — _Aviso antes da violação._ **Dado** um drawdown de US$ 2.500,00 com US$ 2.050,00 consumidos; **quando** o status é calculado; **então** a regra de drawdown fica `WARNING`; **e** a conta fica `AT_RISK`.
- **CA-RF55-2** — _Violação não encerra a conta sozinha._ **Dado** uma regra `VIOLATED`; **quando** o status é calculado; **então** a conta fica `VIOLATED` no painel; **e** o ciclo de vida continua `ACTIVE` até o Trader confirmar `FAILED`.
- **CA-RF56-1** — _Distância até a liquidação em ticks._ **Dado** uma conta de mesa com saldo atual de US$ 49.000,00 e nível de liquidação de US$ 47.500,00; **quando** abro o painel da conta; **então** a distância é US$ 1.500,00; **e** equivale a 300 ticks de NQ, 3.000 de MNQ, 120 de ES e 1.200 de MES por contrato.
- **CA-RF57-1** — _Edição recalcula._ **Dado** uma conta `VIOLATED` por perda diária; **quando** o Trader corrige o trade que causou a violação e a perda do dia fica abaixo do limite; **então** a conta volta a `ON_TRACK`.
- **CA-RF57-2** — _Determinismo._ **Dado** o mesmo conjunto de trades importado em ordens diferentes; **quando** o status é calculado; **então** o resultado é idêntico.

---

### 4.10 Lista e Busca de Trades

| ID    | Requisito                | Observação                                                                                                                                                                 |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-58 | Lista de trades paginada | Alta. Paginação por cursor (padrão 50, máximo 200), ordenação por instante de saída (desc), resultado e R; colunas configuráveis; filtros da RF-46.                        |
| RF-59 | Detalhe do trade         | Alta. Execuções, resultado bruto e líquido, R, duração, contexto (RF-26 a RF-30), capturas e navegação "anterior/próximo" dentro do filtro atual.                          |
| RF-60 | Busca textual            | Baixa. Busca nas notas e tags do próprio tenant (PostgreSQL full-text, configuração de dicionário por idioma).                                                             |
| RF-61 | Exportar trades          | Média. Exporta a lista filtrada para CSV no formato normalizado do Hypomna (reimportável). Valores com ponto decimal e instantes em ISO 8601 UTC, independentes do idioma. |

**Aceite**

- **CA-RF58-1** — _Paginação estável._ **Dado** 120 trades; **quando** percorro a lista com páginas de 50; **então** recebo 50, 50 e 20 trades, sem repetição nem omissão, mesmo que um trade novo seja criado entre as páginas.
- **CA-RF58-2** — _Limite de página._ **Dado** o Trader A; **quando** peço página de 500; **então** recebo `400 VALIDATION_ERROR`.
- **CA-RF59-1** — _Navegação respeita o filtro._ **Dado** a lista filtrada pelo setup "Rompimento" com 3 trades; **quando** abro o primeiro e avanço com "próximo" duas vezes; **então** vejo os três trades do filtro, na ordem da lista; **e** o "próximo" do último fica desabilitado.
- **CA-RF60-1** — _Busca não cruza tenants._ **Dado** a palavra "payroll" numa nota do Trader B; **quando** o Trader A busca "payroll"; **então** o resultado é vazio.
- **CA-RF61-1** — _Exportação reimportável._ **Dado** 30 trades exportados pelo Trader A; **quando** o arquivo é importado em uma conta nova do mesmo tenant; **então** 30 trades são criados com o mesmo resultado líquido total.

---

### 4.11 Sistema Multi-idioma (Internacionalização)

> **Requisito transversal.** O Hypomna é **multi-idioma desde a v1**. Idiomas suportados: **`pt-BR` (padrão e fallback)**, **`en`** e **`es`**. Toda superfície que fala com o usuário é traduzível: telas dos três apps, mensagens de erro e de validação da API, e-mails transacionais, rótulos de enums de domínio (emoções, erros, status) e conteúdo dos catálogos globais (nomes de modelos de regras de mesa). O código, os nomes de domínio, os `code` de erro e os logs ficam em **inglês** (README). Adicionar um idioma é adicionar arquivos de tradução, sem mudar código. O catálogo de mensagens vive em `packages/i18n`, compartilhado pela API e pelos três apps.

| ID    | Requisito                                                         | Observação                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-62 | Interface traduzida nos três apps                                 | Alta. `apps/web`, `apps/web-admin` e `apps/web-marketing` usam chaves de tradução (ICU MessageFormat, com plural e gênero) e nunca texto literal no JSX — garantido por lint. `apps/web-marketing` tem rotas por idioma (`/pt-BR`, `/en`, `/es`) com `hreflang`; os apps autenticados usam a preferência do usuário (RF-09) sem prefixo na URL. Seletor de idioma visível no cabeçalho e no perfil. |
| RF-63 | Mensagens da API no idioma resolvido                              | Alta. Resolução por requisição: preferência salva do usuário → `Accept-Language` → `pt-BR`. Todo erro traz `message` traduzido; `code` e `error` não mudam. Detalhes de validação (`details[].message`) também traduzidos. Resposta com `Content-Language`. Mudar o idioma vale já na requisição seguinte.                                                                                          |
| RF-64 | Formatação regional                                               | Alta. Números, moeda, percentuais, datas e horas formatados pelo idioma do usuário (`Intl`), sempre a partir de valores canônicos (decimal exato e instante UTC) — a API nunca devolve número formatado. Ex.: `US$ 1.234,50` em `pt-BR`, `$1,234.50` em `en`, `1234,50 US$` em `es`. Entradas de formulário aceitam o separador decimal do idioma.                                                  |
| RF-65 | E-mails transacionais no idioma do usuário                        | Média. Verificação, recuperação de senha, avisos de assinatura e de exportação, renderizados no idioma salvo do destinatário; sem preferência, no idioma do navegador no momento do cadastro.                                                                                                                                                                                                       |
| RF-66 | Conteúdo traduzível nos catálogos globais e cobertura de tradução | Média. Campos de texto dos catálogos globais (RF-13, RF-18) guardam traduções por idioma, com fallback para `pt-BR`. O CI falha se uma chave existir em `pt-BR` e faltar em outro idioma suportado, ou se houver chave sem uso. Conteúdo criado pelo Trader (notas, nomes de setups) **não** é traduzido.                                                                                           |

**Aceite**

- **CA-RF62-1** — _Interface no idioma escolhido._ **Dado** um Trader com idioma `es`; **quando** abre o dashboard; **então** todos os rótulos aparecem em espanhol; **e** nenhuma chave crua (ex.: `dashboard.title`) aparece.
- **CA-RF62-2** — _Trocar idioma._ **Dado** um Trader com idioma `pt-BR`; **quando** escolhe `en` no seletor; **então** a interface muda sem novo login; **e** a preferência fica salva para a próxima sessão e para os e-mails.
- **CA-RF62-3** — _Landing por idioma._ **Dado** um visitante com navegador em `en-US`; **quando** abre a raiz de `apps/web-marketing`; **então** é levado a `/en`; **e** a página declara `hreflang` para `pt-BR`, `en` e `es`.
- **CA-RF63-1** — _Resolução do idioma (esquema do cenário)._ **Dado** um usuário com preferência `<preferência>`; **quando** a requisição traz `Accept-Language` `<cabeçalho>` e resulta em erro; **então** o `message` vem em `<idioma>`; **e** o `code` é o mesmo em todos os casos.

  | preferência | cabeçalho           | idioma  |
  | ----------- | ------------------- | ------- |
  | `en`        | `pt-BR`             | `en`    |
  | _(nenhuma)_ | `es-AR`             | `es`    |
  | _(nenhuma)_ | `en-US`             | `en`    |
  | _(nenhuma)_ | `fr`                | `pt-BR` |
  | _(nenhuma)_ | _(ausente)_         | `pt-BR` |
  | _(nenhuma)_ | `;;;`               | `pt-BR` |
  | _(nenhuma)_ | `fr;q=0.9,es;q=0.8` | `es`    |

- **CA-RF63-2** — _404 indistinguível em qualquer idioma._ **Dado** um trade do Trader B; **quando** o Trader A o consulta em `pt-BR` e em `en`, e consulta também um identificador inexistente nos dois idiomas; **então** em cada idioma o corpo da resposta ao trade de B é idêntico ao do inexistente.
- **CA-RF63-3** — _Fallback de tradução._ **Dado** um `code` sem tradução em `es`; **quando** a requisição pede `es`; **então** o `message` vem da tradução `pt-BR`; **e** nunca é vazio nem a chave crua.
- **CA-RF64-1** — _Formatação (esquema do cenário)._ **Dado** o valor canônico `1234.5` USD e o instante `2026-03-10T13:35:00Z` no fuso `America/Sao_Paulo`; **quando** exibidos no idioma `<idioma>`; **então** aparecem como `<valor>` e `<data>`.

  | idioma  | valor          | data                   |
  | ------- | -------------- | ---------------------- |
  | `pt-BR` | `US$ 1.234,50` | `10/03/2026 10:35`     |
  | `en`    | `$1,234.50`    | `03/10/2026, 10:35 AM` |
  | `es`    | `1234,50 US$`  | `10/03/2026 10:35`     |

- **CA-RF64-2** — _API devolve valor canônico._ **Dado** qualquer idioma; **quando** consulto um trade pela API; **então** valores monetários vêm como string decimal (`"1234.50"`) com a moeda, e instantes em ISO 8601 UTC.
- **CA-RF65-1** — _E-mail no idioma do destinatário._ **Dado** um Trader com idioma `en`; **quando** pede recuperação de senha a partir de um navegador em `pt-BR`; **então** o e-mail chega em inglês.
- **CA-RF66-1** — _Chave faltando quebra o CI._ **Dado** uma chave nova adicionada só em `pt-BR`; **quando** o CI roda a verificação de traduções; **então** a verificação falha apontando a chave e os idiomas faltantes.

---

### 4.12 Assinatura e Cobrança (Stripe)

| ID    | Requisito                                    | Observação                                                                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-67 | Planos de assinatura                         | Alta. Planos configuráveis (`PlanCatalog`) com limites: contas ativas, importações/mês, armazenamento de capturas, histórico consultável. Proposta inicial: **Trial** (14 dias, limites do Pro), **Pro** mensal e anual. Preços e faixas: questão 10.3.                                                            |
| RF-68 | Teste gratuito                               | Alta. Todo tenant novo começa em `TRIALING` por 14 dias, sem cartão. Aviso 3 dias e 1 dia antes do fim (e-mail e banner).                                                                                                                                                                                          |
| RF-69 | Checkout e portal do cliente                 | Alta. Stripe Checkout para assinar e Stripe Customer Portal para trocar plano, cartão e cancelar. Nenhum dado de cartão passa pela aplicação.                                                                                                                                                                      |
| RF-70 | Webhooks idempotentes                        | Alta. `/webhooks/stripe` com assinatura verificada, processado em fila, idempotente por `event.id` (tabela de eventos processados). Eventos fora de ordem não regridem o estado (comparação por `created`).                                                                                                        |
| RF-71 | Degradação por inadimplência ou cancelamento | Alta. `PAST_DUE`: 7 dias de carência com acesso normal e aviso; depois, tenant `READ_ONLY` (§3.4). `CANCELED`: `READ_ONLY` ao fim do período pago. Em `READ_ONLY`, leitura, métricas e exportação seguem liberadas (o dado é do Trader); escrita responde `402 SUBSCRIPTION_REQUIRED`. Reassinar volta a `ACTIVE`. |

**Aceite**

- **CA-RF67-1** — _Planos públicos._ **Dado** o catálogo de planos; **quando** um visitante sem sessão chama `GET /public/plans` com `Accept-Language: en`; **então** recebe os planos ativos com preço (decimal canônico), intervalo e limites; **e** nomes e descrições em inglês.
- **CA-RF68-1** — _Teste termina._ **Dado** um tenant em `TRIALING` há 14 dias sem assinatura; **quando** o período acaba; **então** o tenant fica `READ_ONLY`; **e** o Trader ainda consulta métricas e exporta trades.
- **CA-RF69-1** — _Checkout ativa a assinatura._ **Dado** um tenant em `TRIALING`; **quando** o Stripe confirma o pagamento do Checkout por webhook; **então** a assinatura fica `ACTIVE` com o plano escolhido; **e** nenhum dado de cartão é gravado pela aplicação.
- **CA-RF70-1** — _Webhook sem assinatura válida._ **Dado** uma chamada a `/webhooks/stripe` com `stripe-signature` inválida; **quando** é recebida; **então** a resposta é `400`; **e** nenhum estado muda.
- **CA-RF70-2** — _Evento repetido._ **Dado** um evento `invoice.paid` já processado; **quando** chega de novo; **então** é ignorado; **e** a resposta é `200`.
- **CA-RF70-3** — _Evento fora de ordem._ **Dado** uma assinatura `ACTIVE` por um evento mais recente; **quando** chega um evento antigo de `past_due`; **então** o estado continua `ACTIVE`.
- **CA-RF71-1** — _Carência (esquema do cenário)._ **Dado** uma assinatura `PAST_DUE` há `<dias>` dias; **quando** o Trader tenta registrar um trade; **então** o resultado é `<resultado>`.

  | dias | resultado                   |
  | ---- | --------------------------- |
  | 6    | criado                      |
  | 7    | criado                      |
  | 8    | `402 SUBSCRIPTION_REQUIRED` |

- **CA-RF71-2** — _Somente leitura preserva o dado._ **Dado** um tenant `READ_ONLY`; **quando** o Trader exporta seus trades; **então** a exportação é concluída normalmente.

---

### 4.13 Módulo Administrador (`apps/web-admin`)

| ID    | Requisito                   | Observação                                                                                                                                                                                                                                                               |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-72 | Lista e busca de tenants    | Alta. Por e-mail, status do tenant, status da assinatura e datas. Colunas de **metadados**: e-mail, nome, criação, último acesso, plano, status, uso (nº de contas, nº de trades, armazenamento). Nunca trades, notas, capturas ou métricas de desempenho (princípio 6). |
| RF-73 | Detalhe do tenant           | Alta. Metadados, histórico de assinatura e faturas (via Stripe), histórico de importações (contagens e falhas, sem conteúdo) e trilha de auditoria do tenant.                                                                                                            |
| RF-74 | Suspender e reativar tenant | Alta. Exige motivo; suspender encerra as sessões do Trader e bloqueia o login com mensagem genérica; reativar devolve ao estado anterior. Auditado.                                                                                                                      |
| RF-75 | Catálogos globais           | Alta. Instrumentos (RF-18, com vigência) e modelos de regras de mesa (RF-13), com textos por idioma (RF-66). Alteração nunca muda dado já gravado em tenant (vigência e snapshot).                                                                                       |
| RF-76 | Ações de assinatura         | Média. Estender teste, conceder cortesia por período, ver o estado sincronizado com o Stripe. Auditado.                                                                                                                                                                  |
| RF-77 | Auditoria administrativa    | Alta. Toda ação de Admin com efeito (suspender, reativar, cortesia, catálogo, concessão de papel) grava `AuditLog`: quem, quando, alvo, valor anterior e novo, motivo. Somente inserção (sem update/delete pela aplicação). Suporte vê, não age.                         |

**Aceite**

- **CA-RF72-1** — _Admin não lê diário._ **Dado** um Admin autenticado; **quando** chama qualquer rota de trades, contas, capturas ou métricas de um tenant; **então** recebe `404` (rotas de Trader não aceitam `platformRole`); **e** nenhuma rota de `admin` devolve campos de trade ou nota (verificado pelo schema do OpenAPI).
- **CA-RF72-2** — _Trader não acessa admin._ **Dado** um Trader autenticado; **quando** chama uma rota `/admin/*`; **então** recebe `404`.
- **CA-RF73-1** — _Detalhe só com metadados._ **Dado** um tenant com 3 lotes de importação; **quando** o Admin abre o detalhe do tenant; **então** vê data, plataforma e contagens de cada lote; **e** não vê linhas, trades nem o arquivo original.
- **CA-RF74-1** — _Suspensão encerra sessões._ **Dado** um Trader com sessão ativa; **quando** o Admin suspende o tenant com motivo; **então** a próxima requisição do Trader recebe `401`; **e** o login seguinte é recusado com mensagem genérica; **e** a auditoria registra o motivo.
- **CA-RF74-2** — _Suporte não suspende._ **Dado** um usuário `SUPPORT`; **quando** tenta suspender um tenant; **então** recebe `403 FORBIDDEN`.
- **CA-RF75-1** — _Vigência de instrumento._ **Dado** trades de MNQ registrados com valor por tick de US$ 0,50; **quando** o Admin cadastra uma nova vigência com outro valor a partir de amanhã; **então** o resultado dos trades antigos não muda.
- **CA-RF76-1** — _Estender teste é auditado._ **Dado** um tenant em `TRIALING` com fim em 2026-03-20; **quando** o Admin estende o teste em 7 dias com motivo; **então** o fim passa a 2026-03-27; **e** a auditoria registra o Admin, o valor anterior, o novo e o motivo.
- **CA-RF77-1** — _Auditoria imutável._ **Dado** um registro de auditoria; **quando** qualquer rota tenta alterá-lo ou apagá-lo; **então** a operação não existe na API; **e** a role do banco da aplicação não tem `UPDATE`/`DELETE` na tabela.

---

### 4.14 Landing Page (`apps/web-marketing`)

| ID    | Requisito                      | Observação                                                                                                                                                                                               |
| ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-78 | Landing institucional e preços | Média. Proposta de valor (a partir do README), recursos, mesas suportadas, preços (lidos de `GET /public/plans`), FAQ, termos e privacidade, nos três idiomas (RF-62). Geração estática com revalidação. |
| RF-79 | Chamada para cadastro          | Média. "Começar teste grátis" leva ao cadastro de `apps/web` preservando idioma e UTM. A landing nunca autentica nem guarda sessão.                                                                      |

**Aceite**

- **CA-RF78-1** — _Preços vêm da API._ **Dado** um plano com preço alterado no catálogo; **quando** a página de preços é revalidada; **então** mostra o novo preço formatado no idioma da rota.
- **CA-RF79-1** — _Cadastro preserva idioma._ **Dado** um visitante em `/es`; **quando** clica em "Começar teste grátis"; **então** a tela de cadastro de `apps/web` abre em espanhol; **e** o cadastro grava o idioma `es` na preferência.

---

### 4.15 Privacidade, Segurança e Plataforma

| ID    | Requisito                                     | Observação                                                                                                                                                                                                                                                                |
| ----- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-80 | Documentação e contrato da API                | Alta. OpenAPI 3.1 gerado dos schemas Zod, publicado em `/docs`; clients tipados gerados por Orval para os três apps; o CI falha se o client gerado divergir do commitado.                                                                                                 |
| RF-81 | Rate limit e proteção de autenticação         | Alta. Rate limit por IP e por usuário (Redis), mais restrito em `/api/auth/*`, upload e importação; bloqueio progressivo de login após 5 falhas em 15 min; `429 RATE_LIMITED` com `Retry-After`.                                                                          |
| RF-82 | Exclusão de conta a pedido do titular (LGPD)  | Alta. Exige senha; cancela a assinatura; tenant `DELETED` com 7 dias de arrependimento; depois, apagamento definitivo de todo dado de domínio e arquivos do tenant; dados financeiros exigidos por lei (faturas) ficam anonimizados no Stripe/registro mínimo.            |
| RF-83 | Exportação completa dos dados (portabilidade) | Alta. Arquivo ZIP com JSON e CSV de contas, trades, execuções, contexto, revisões diárias e as capturas; gerado em fila, disponível por link assinado por 24 h, aviso por e-mail.                                                                                         |
| RF-84 | Health check e observabilidade                | Alta. `GET /health` (liveness) e `/health/ready` (Postgres, Redis, storage); logs estruturados com `requestId` e `tenantId` (nunca conteúdo de nota, e-mail completo ou senha); métricas e _tracing_ OpenTelemetry.                                                       |
| RF-85 | Matriz de isolamento de tenant (teste)        | Alta. Um teste percorre o OpenAPI e, para cada rota de negócio, executa os casos sem sessão, papel indevido e recurso de outro tenant com os Traders A e B. Rota nova sem entrada na matriz quebra o teste. Jobs e URLs assinadas de arquivos entram com testes próprios. |
| RF-86 | Rastreabilidade cenário ↔ teste               | Alta. Script `pnpm test:trace` lê os IDs `CA-*` deste PRD e os IDs presentes nos testes e falha se houver cenário sem teste ou teste com ID inexistente.                                                                                                                  |

**Aceite**

- **CA-RF80-1** — _Client gerado em dia._ **Dado** uma rota alterada sem regenerar o client; **quando** o CI roda; **então** a verificação de contrato falha.
- **CA-RF81-1** — _Bloqueio progressivo._ **Dado** 5 tentativas de login falhas para o mesmo e-mail em 15 minutos; **quando** a sexta é feita, mesmo com a senha correta; **então** a resposta é `429 RATE_LIMITED` com `Retry-After`.
- **CA-RF82-1** — _Exclusão com arrependimento._ **Dado** um Trader que pediu a exclusão há 3 dias; **quando** entra e cancela o pedido; **então** o tenant volta a `ACTIVE` com os dados intactos; **e** **dado** um pedido de 8 dias atrás, os dados de domínio e arquivos do tenant não existem mais.
- **CA-RF83-1** — _Exportação só do próprio tenant._ **Dado** a exportação do Trader A; **quando** o Trader B usa o link dela; **então** recebe `404`; **e** o link expira em 24 h.
- **CA-RF84-1** — _Prontidão._ **Dado** o Redis fora do ar; **quando** chamo `/health/ready`; **então** a resposta é `503` indicando o Redis; **e** `/health` continua `200`.
- **CA-RF85-1** — _Rota nova sem matriz._ **Dado** uma rota de negócio nova sem caso na matriz; **quando** a suíte roda; **então** o teste de isolamento falha nomeando a rota.
- **CA-RF86-1** — _Cenário sem teste._ **Dado** um `CA-*` neste PRD sem teste correspondente; **quando** `pnpm test:trace` roda como gate; **então** falha listando o ID.

---

## 5. Modelo de Dados (conceitual)

```
Tenant 1───* TenantMembership *───1 User ───0..1 TraderProfile
Tenant 1───1 Subscription (Stripe)
Tenant 1───* TradingAccount ◄─┬─ PersonalAccount
                              └─ PropFirmAccount 1───1 PropFirmRuleSet (snapshot de PropFirmRuleTemplate)
TradingAccount 1───* BalanceAdjustment
TradingAccount 1───* Trade 1───* Execution
                      │  ├──0..1 Setup (do tenant)
                      │  ├──*  TradeTag ──* Tag (do tenant)
                      │  ├──*  TradeMistake ──* Mistake (padrão global + do tenant)
                      │  ├──0..1 TradeContext (emoções, aderência, nota)
                      │  └──*  Attachment (captura no storage)
                      └──0..1 ImportBatch (origem)
Tenant 1───* ImportBatch 1───* ImportRowError
Tenant 1───* ImportAccountMapping
Tenant 1───* DailyReview
Tenant 1───* PropFirmAccountStatus (projeção recalculável, RF-57)
Instrument (global, com vigência) ── InstrumentSpecVersion
PropFirmRuleTemplate (global, traduzível) · PlanCatalog (global) · AuditLog (global, só inserção)
User (Admin/Suporte) — sem tenant, `platformRole`
```

| Entidade                               | Papel no produto                              | Observação                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                                 | Identidade (Better-Auth)                      | Só autenticação + `locale`, `timeZone`, `platformRole` (`null`/`ADMIN`/`SUPPORT`). Dados de domínio ficam em `TraderProfile`.                                                                                                                                                                                                                                                                                              |
| `Tenant`                               | O tenant                                      | `status` (`ACTIVE`/`READ_ONLY`/`SUSPENDED`/`DELETED`), `suspendedReason`, `deletionRequestedAt`.                                                                                                                                                                                                                                                                                                                           |
| `TenantMembership`                     | Liga usuário a tenant                         | `role` (`OWNER` na v1). Unique `(tenantId, userId)`; na v1, unique também em `userId`.                                                                                                                                                                                                                                                                                                                                     |
| `TraderProfile`                        | Perfil e preferências                         | `displayName`, `platforms[]`, `pnlBasis` (`NET`/`GROSS`), `dayBoundary` (`SESSION`/`CALENDAR`).                                                                                                                                                                                                                                                                                                                            |
| `TradingAccount`                       | Conta (abstração)                             | `kind` (`PERSONAL`/`PROP_FIRM`) como discriminador de tabela; `name`, `platform`, `platformAccountId`, `currency`, `initialBalance` (`Decimal(18,2)`), `status`, `openedAt`.                                                                                                                                                                                                                                               |
| `PropFirmRuleSet`                      | Regras da conta de mesa (snapshot)            | `firmName`, `phase`, `drawdownType`, `maxDrawdown`, `drawdownLockAt?`, `dailyLossLimit?`, `profitTarget?`, `consistencyMaxPct?`, `minTradingDays?`, `maxContracts?`, `microToMiniRatio`, `warningThresholdPct`.                                                                                                                                                                                                            |
| `BalanceAdjustment`                    | Depósito, saque, payout, reset, correção      | `type`, `amount` (`Decimal(18,2)`), `occurredAt`, `note`.                                                                                                                                                                                                                                                                                                                                                                  |
| `Instrument` / `InstrumentSpecVersion` | Catálogo global versionado                    | `root`, `exchange`, `sessionTimeZone`, `sessionOpen`/`Close`; versão com `tickSize` (`Decimal(18,6)`), `tickValue` (`Decimal(18,4)`), `currency`, `validFrom`/`validTo`.                                                                                                                                                                                                                                                   |
| `Trade`                                | Operação de flat a flat                       | `tenantId`, `accountId`, `instrumentSpecVersionId`, `contractSymbol`, `direction`, `status` (`OPEN`/`CLOSED`), `modality` (`DAY_TRADE`/`SWING_TRADE`, nulo enquanto `OPEN`, RF-87), derivados persistidos para consulta (`avgEntry`, `avgExit`, `maxQty`, `grossPnl`, `fees`, `netPnl`, `rMultiple`, `openedAt`, `closedAt`, `tradingDay`), `source`, `importBatchId?`, `fingerprint`, `isEditedAfterImport`, `deletedAt`. |
| `Execution`                            | Fill                                          | `side` (`BUY`/`SELL`), `quantity`, `price` (`Decimal(18,6)`), `executedAt`, `commission`, `fees`, `platformFillId?`.                                                                                                                                                                                                                                                                                                       |
| `TradeContext`                         | Contexto do diário                            | `emotionBefore`/`After` + intensidades, `followedPlan`, `executionScore`, `note`, `plannedStop?`, `plannedTarget?`.                                                                                                                                                                                                                                                                                                        |
| `Setup`, `Tag`, `Mistake`              | Catálogos do tenant (`Mistake` também global) | Unique `(tenantId, lower(name))`.                                                                                                                                                                                                                                                                                                                                                                                          |
| `Attachment`                           | Captura de gráfico                            | `storageKey` (`tenants/<tenantId>/trades/<tradeId>/<uuid>`), `mimeType`, `sizeBytes`, `caption`, `thumbnailKey`.                                                                                                                                                                                                                                                                                                           |
| `ImportBatch`                          | Lote de importação                            | `platform`, `layout`, `fileTimeZone`, `status`, `fileKey`, contagens, `createdBy`.                                                                                                                                                                                                                                                                                                                                         |
| `ImportRowError`                       | Erro de linha                                 | `rowNumber`, `column`, `rawValue` (truncado), `code`.                                                                                                                                                                                                                                                                                                                                                                      |
| `ImportAccountMapping`                 | Conta da plataforma → conta Hypomna           | Unique `(tenantId, platform, platformAccountValue)`.                                                                                                                                                                                                                                                                                                                                                                       |
| `DailyReview`                          | Revisão do dia                                | Unique `(tenantId, tradingDay)`.                                                                                                                                                                                                                                                                                                                                                                                           |
| `PropFirmAccountStatus`                | Projeção do status das regras                 | Recalculável a partir dos trades (RF-57); nunca fonte de verdade.                                                                                                                                                                                                                                                                                                                                                          |
| `Subscription`                         | Assinatura Stripe do tenant                   | `stripeCustomerId`, `stripeSubscriptionId`, `planCode`, `status`, `currentPeriodEnd`, `pastDueSince`.                                                                                                                                                                                                                                                                                                                      |
| `ProcessedWebhookEvent`                | Idempotência de webhooks                      | Unique `eventId`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `AuditLog`                             | Auditoria administrativa                      | `actorId`, `action`, `targetType`, `targetId`, `before`, `after`, `reason`, `createdAt`.                                                                                                                                                                                                                                                                                                                                   |

### Restrições que o schema deve garantir (não apenas a aplicação)

- `tenantId NOT NULL` em toda tabela de domínio de tenant, com **RLS** habilitado e política `tenant_id = current_setting('app.tenant_id')::uuid`; FK compostas `(tenantId, id)` onde uma entidade aponta para outra do mesmo tenant (ex.: `Trade(tenantId, accountId)` → `TradingAccount(tenantId, id)`), impedindo referência cruzada entre tenants no próprio banco.
- Valores monetários e preços em `NUMERIC` (nunca `real`/`double precision`); `CHECK (quantity > 0)`, `CHECK (initialBalance > 0)`.
- Unique `(tenantId, accountId, fingerprint)` em `Trade` (deduplicação, RF-37), parcial `WHERE deletedAt IS NULL`.
- Unique `(tenantId, tradingDay)` em `DailyReview`; unique `(tenantId, lower(name))` em `Setup` e `Tag`.
- `AuditLog` sem `UPDATE`/`DELETE` concedido à role da aplicação.
- Identificadores UUID v7 (ordenáveis), nunca sequenciais expostos.
- O schema Prisma detalhado é a primeira spec da Fase 0 (`.docs/specs/platform/RF-00-schema.md`), derivada desta seção.

---

## 6. Arquitetura do Monorepo

### 6.1 Estrutura

```
/apps
  /api                 # NestJS + Prisma + Better-Auth — backend único (Clean Architecture)
  /web                 # Next.js (App Router) — cliente exclusivo do Trader
  /web-admin           # Next.js (App Router) — cliente exclusivo do Admin/Suporte
  /web-marketing       # Next.js (App Router, estático) — landing, sem autenticação
/packages
  /domain              # núcleo de domínio puro em TS: entidades, Value Objects (Money, Price, Quantity,
                       #   TickSize, TradeResult, Coordinates…), políticas de mesa, calculadoras — sem
                       #   dependência de framework, ORM ou I/O
  /contracts           # schemas Zod de request/response compartilhados (fonte do OpenAPI)
  /api-client          # client tipado gerado por Orval a partir do OpenAPI (TanStack Query + fetch)
  /i18n                # catálogos de mensagens (pt-BR, en, es), helpers de formatação e verificação de chaves
  /ui                  # design system (shadcn/ui + Tailwind) compartilhado pelos três apps web
  /test-utils          # builders de fixture (Traders A/B, contas, trades), fakes de relógio/Stripe/storage
  /eslint-config       # ESLint + Prettier + regras de Object Calisthenics e de fronteira de camadas
  /tsconfig            # tsconfig base (strict)
/.docs
  PRD.md               # este documento
  /specs               # specs de feature (SDD), uma por RF ou grupo coeso de RFs
  /adr                 # Architecture Decision Records
/fixtures
  /csv                 # arquivos reais anonimizados de NinjaTrader e Tradovate (base dos testes de importação)
```

- **Gerenciador e orquestração:** pnpm workspaces + Turborepo (cache de `build`, `lint`, `check-types`, `test`).
- **Runtime:** Node.js LTS vigente (24.x), TypeScript `strict`, ESM.
- **Infra local:** `docker compose` com PostgreSQL 16+, Redis 7+, MinIO (S3) e Mailpit (e-mail).

### 6.2 Arquitetura da API (Clean Architecture)

```
apps/api/src/
  modules/<bounded-context>/      # identity, tenancy, accounts, instruments, trades, journal,
                                  # imports, analytics, prop-rules, billing, admin, i18n, platform
    application/                  # use cases (Command/Query + Handler), ports (interfaces), DTOs de saída
    infrastructure/               # repositórios Prisma, parsers CSV (adaptadores), Stripe, storage, filas
    presentation/                 # controllers Nest, guards, pipes Zod, mapeadores HTTP
  shared/                         # TenantContext, ExceptionFilter global, i18n de erros, relógio, IDs
```

- **Regra de dependência:** `presentation → application → domain`; `infrastructure` implementa portas de `application`. `packages/domain` não importa nada do Nest, Prisma, Zod de transporte ou Node I/O — garantido por regra de lint de fronteira (`eslint-plugin-boundaries`) e por teste de arquitetura.
- **Use cases** são classes com um método `execute`, recebem `TenantContext` explícito e retornam DTO próprio (nunca model do Prisma). Comandos e consultas separados (CQRS leve): consultas de métricas podem ler projeções otimizadas.
- **Controllers** sem regra de negócio: validam com Zod (`nestjs-zod`), extraem sessão e contexto, chamam o use case, mapeiam o status HTTP.
- **Erros de domínio** são tipos (`DomainError` com `code`); um `ExceptionFilter` global os traduz para HTTP e para o idioma resolvido (RF-63). Use case não conhece HTTP.
- **Filas:** BullMQ sobre Redis para importação, recálculo de status de mesa, exportação, e-mails e webhooks.
- **Storage:** porta `FileStorage` com adaptador S3 (MinIO em dev; provedor de produção na questão 10.7).
- **Autenticação:** Better-Auth montado em `/api/auth/*`, sessão por cookie para `apps/web` e `apps/web-admin` em domínios distintos; TOTP para Admin.

### 6.3 Fluxo SDD no repositório

1. **PRD** (`.docs/PRD.md`) — o _o quê_ e o _porquê_, com `RF-XX` e `CA-*`.
2. **Spec de feature** (`.docs/specs/<módulo>/RF-<nn>-<slug>.md`) — o _como_ daquele recorte: contexto, RFs cobertos, cenários copiados do PRD (e cenários técnicos extras), contrato da API (rotas, schemas, códigos de erro), mudanças de schema, decisões, fora de escopo, plano de tarefas. Status: `DRAFT` → `APPROVED` → `IMPLEMENTED`.
3. **Aprovação** — a spec só vira `APPROVED` por revisão do autor; **código de produção não é escrito antes disso**.
4. **Testes primeiro** (§7.1) a partir dos cenários da spec.
5. **Implementação**, refatoração e atualização da §11 (spec, código, testes).
6. **ADR** para decisões de arquitetura que afetem mais de um módulo (`.docs/adr/NNNN-titulo.md`).

### 6.4 Frontend

- **Next.js (App Router)**, React Server Components primeiro, TanStack Query no cliente, client gerado por Orval, formulários com React Hook Form + Zod (schemas de `packages/contracts`), shadcn/ui + Tailwind, gráficos com uma biblioteca única para todo o produto (questão 10.8).
- **i18n** com `next-intl` sobre os catálogos de `packages/i18n`.
- Nenhuma regra de negócio na interface: valores monetários vêm prontos da API como decimal em string e só são formatados (RF-64).

---

## 7. Requisitos Não-Funcionais

| Categoria                   | Requisito                                                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Isolamento multi-tenant** | Três camadas (aplicação, ORM, RLS) — §3.2; matriz de isolamento obrigatória (RF-85). Vazamento é incidente de severidade máxima.                                                                                                                                                                          |
| **Precisão monetária**      | `Money` imutável sobre decimal de precisão arbitrária (`decimal.js` ou equivalente), arredondamento explícito (`HALF_EVEN` para exibição, nunca no cálculo intermediário); proibido `number` para valor monetário — garantido por lint e tipo nominal.                                                    |
| **Arquitetura**             | Clean Architecture e SOLID (§6.2); domínio sem dependências externas; teste de arquitetura no CI.                                                                                                                                                                                                         |
| **Object Calisthenics**     | Um nível de indentação por método (`max-depth: 1` no domínio e na aplicação), sem `else` (`no-else-return` + revisão), primitivos de domínio encapsulados em Value Objects, coleções de primeira classe, entidades pequenas (limite de linhas por classe e de parâmetros por método configurado no lint). |
| **Imutabilidade**           | Value Objects `readonly` e congelados; operações retornam nova instância.                                                                                                                                                                                                                                 |
| **Nomenclatura**            | Código e testes em inglês, nomes que revelam intenção (`CalculateDailyDrawdown`, não `CalcDD`).                                                                                                                                                                                                           |
| **Contrato**                | Zod em toda rota; OpenAPI gerado; erros `{ error, code, message, details? }`.                                                                                                                                                                                                                             |
| **Datas e fusos**           | Instantes sempre em UTC no banco e na API (ISO 8601); fusos IANA; `dayjs` com plugins `utc`/`timezone` (ou Temporal quando estável) encapsulado num `Clock`/`TradingCalendar` injetável.                                                                                                                  |
| **Desempenho**              | p95 < 300 ms nas consultas de métricas com até 10.000 trades no filtro; importação de 5.000 linhas até a prévia em < 30 s; dashboard com LCP < 2,5 s.                                                                                                                                                     |
| **Disponibilidade**         | 99,5% mensal na v1; backups diários do Postgres com retenção de 30 dias e restauração testada por trimestre.                                                                                                                                                                                              |
| **Segurança**               | OWASP ASVS nível 2 como referência; `helmet`, CSP restritiva, CSRF nas rotas de cookie, segredos só por env validado (Zod), dependências auditadas no CI, uploads validados por conteúdo, URLs de arquivo assinadas e curtas.                                                                             |
| **Privacidade (LGPD)**      | Exportação e exclusão (RF-82/RF-83); logs sem dado pessoal sensível; Admin sem acesso ao diário; política de retenção do CSV original (30 dias).                                                                                                                                                          |
| **Acessibilidade**          | WCAG 2.2 AA nos três apps; cores de ganho/perda nunca são o único indicador (ícone/sinal).                                                                                                                                                                                                                |
| **Internacionalização**     | §4.11; nenhum texto literal de UI no código (lint); verificação de chaves no CI.                                                                                                                                                                                                                          |
| **Observabilidade**         | Logs estruturados (Pino) com `requestId`/`tenantId`; OpenTelemetry; alertas de taxa de erro, fila parada e falha de webhook.                                                                                                                                                                              |
| **Deploy**                  | Docker multi-stage por app; migrations Prisma versionadas e aplicadas no deploy; ambientes `dev`, `staging` e `prod`; CI/CD no GitHub Actions.                                                                                                                                                            |

### Variáveis de ambiente (iniciais)

`DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `API_BASE_URL`, `WEB_BASE_URL`, `WEB_ADMIN_BASE_URL`, `WEB_MARKETING_BASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SMTP_URL`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DEFAULT_LOCALE` (`pt-BR`), `SUPPORTED_LOCALES` (`pt-BR,en,es`), `OTEL_EXPORTER_OTLP_ENDPOINT`. Todas validadas por schema Zod na inicialização; ausência falha o boot.

### 7.1 Estratégia de Testes (SDD + TDD + BDD)

O PRD é a especificação (SDD). A §4 traz os critérios de aceite como cenários BDD; esta seção define como eles viram testes.

**Princípios**

1. **Teste primeiro (TDD).** Red → Green → Refactor por RF. Todo bug nasce como teste vermelho.
2. **Comportamento especificado (BDD).** Cada `CA-*` vira um `Cenário` executável com o ID como tag, na linguagem do glossário (§11.1).
3. **Infraestrutura real onde está o risco.** Isolamento de tenant, RLS, constraints e transações só se provam contra Postgres e Redis reais (Testcontainers); o Prisma não é simulado nos testes de integração.
4. **Determinismo.** Relógio, IDs, Stripe, storage e e-mail são injetáveis e falsificados nos testes; nenhum teste depende de hora real, rede externa ou `sleep`.

**Níveis de teste**

| Nível                 | O que verifica                                                                                                               | Ferramenta                                                                                                      | Quando roda                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Unitário (domínio)    | `Money`, `TickCalculator`, resolução de símbolo, `PerformanceCalculator`, políticas de mesa, `TradingCalendar`, deduplicação | Vitest (esquemas de cenário → testes parametrizados; _property-based_ com `fast-check` para `Money` e métricas) | A cada mudança, pre-push, CI |
| Unitário (aplicação)  | Use cases com portas falsificadas                                                                                            | Vitest                                                                                                          | Pre-push, CI                 |
| Integração            | Repositórios, RLS, constraints, transações, filas                                                                            | Vitest + Testcontainers (Postgres, Redis, MinIO)                                                                | CI                           |
| API e aceite (BDD)    | HTTP pela aplicação Nest (guards, pipes, filtros, i18n)                                                                      | Vitest + `supertest` + `@amiceli/vitest-cucumber` (`.feature` em pt-BR)                                         | CI, todo PR                  |
| Parsers de importação | Cada layout contra os arquivos reais anonimizados de `/fixtures/csv`, com o resultado esperado em _snapshot_ revisado        | Vitest                                                                                                          | CI                           |
| Contrato              | OpenAPI × client Orval × `packages/contracts`                                                                                | Orval no CI + `check-types`                                                                                     | CI                           |
| Arquitetura           | Fronteiras de camada, domínio sem dependências                                                                               | `eslint-plugin-boundaries` + teste de dependências                                                              | CI                           |
| Componente            | Telas e componentes com API simulada pelo contrato                                                                           | Testing Library + Vitest + MSW                                                                                  | CI                           |
| Ponta a ponta         | Fluxos críticos: cadastro → conta → importação → métricas; conta de mesa em risco; troca de idioma                           | Playwright                                                                                                      | Noturno e pré-release        |
| i18n                  | Chaves faltantes/sobrando, ICU válido                                                                                        | Script próprio em `packages/i18n`                                                                               | CI                           |

**Regras**

- `.feature` em `apps/api/test/features/<módulo>/RF-<nn>.feature`, `# language: pt`, uma tag `@CA-RFnn-k` por cenário.
- Passos em linguagem de domínio (sem SQL, URL ou nome de classe); detalhes de contrato só no **Então**.
- Personagens padrão (`packages/test-utils`): Trader A, Trader B, Admin, Suporte; todo cenário de acesso roda com A e B.
- Nenhum `it.skip`/`.only` no merge; teste instável vai para quarentena com prazo e responsável.
- Recomendado no histórico: commit `test(...)` antes do `feat(...)` do mesmo RF.

Exemplo de tradução do CA-RF04-2:

```gherkin
# language: pt
@RF-04
Funcionalidade: Autorização de tenant

  @CA-RF04-2
  Cenário: Leitura de recurso de outro tenant
    Dado que sou Trader A autenticado
    Quando consulto um trade do Trader B pelo identificador
    Então recebo 404 NOT_FOUND
    E o corpo é idêntico ao de um identificador inexistente
```

**Definition of Done de um RF**

- Spec da feature `APPROVED` antes do código e `IMPLEMENTED` ao final.
- Todo `CA-*` do RF tem teste automatizado que falhou antes do código.
- Casos negativos presentes: sem sessão, outro tenant, papel indevido, entrada inválida.
- Rotas novas na matriz de isolamento (RF-85) e no OpenAPI, client regenerado.
- Textos novos nos três idiomas (RF-66).
- Suíte verde, cobertura dentro das metas, sem `skip`; §11 atualizada.

**Metas de cobertura:** **≥ 95% de linhas e ramos em `packages/domain` e na camada `application`** da API (meta de trabalho: próxima de 100%, conforme o README); ≥ 80% em `apps/api` no geral; 100% das rotas de negócio na matriz RF-85; 100% dos `CA-*` com teste (RF-86).

**Gates:** `pre-push` com `check-types` e testes unitários; CI em todo PR com lint, `check-types`, unitários, integração, aceite, contrato, arquitetura, i18n, cobertura e `test:trace`; pré-release com Playwright e teste de carga dos NFRs de desempenho.

---

## 8. Métricas de Sucesso

| Métrica                 | Definição                                                                          | Alvo inicial   |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------- |
| Ativação                | % de Traders que criam uma conta e registram/importam ≥ 1 trade nas primeiras 24 h | ≥ 60%          |
| Importação bem-sucedida | % de lotes concluídos com ≥ 95% das linhas importadas                              | ≥ 90%          |
| Precisão do cálculo     | % de trades importados sem `PNL_MISMATCH` contra o valor da plataforma             | ≥ 99,5%        |
| Hábito de diário        | % de trades da semana com setup ou emoção preenchidos                              | ≥ 50%          |
| Retenção W4             | % de Traders ativos (≥ 1 trade registrado) 4 semanas após o cadastro               | ≥ 40%          |
| Conversão do teste      | % de tenants em teste que assinam                                                  | ≥ 15%          |
| Churn                   | % de assinaturas canceladas por mês                                                | < 5%           |
| Uso do status de mesa   | % de Traders com conta de mesa que abrem o painel da conta ≥ 2x/semana             | ≥ 50%          |
| Uso de idiomas          | Distribuição de usuários por idioma                                                | Acompanhamento |
| Isolamento              | Incidentes de vazamento entre tenants                                              | **0**          |
| Saúde da API            | p95 das rotas de métricas                                                          | < 300 ms       |

---

## 9. Riscos e Débitos Técnicos

| ID    | Item                                                           | Risco                                                       | Ação proposta                                                                                                                                 |
| ----- | -------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| DT-01 | Vazamento entre tenants por query sem filtro                   | Falha de segurança grave                                    | Três camadas (§3.2), RLS, FK compostas, matriz RF-85 desde a Fase 1.                                                                          |
| DT-02 | Layouts de CSV mudam sem aviso                                 | Importação quebra ou, pior, importa errado                  | Detecção estrita de cabeçalho, `UNRECOGNIZED_LAYOUT`, fixtures reais versionadas, conferência `PNL_MISMATCH`, adaptador por versão de layout. |
| DT-03 | Erros de ponto flutuante em valores                            | Números que não batem com a corretora (princípio 2)         | `Money`/decimal em todas as camadas, `NUMERIC` no banco, lint contra `number` monetário, testes de propriedade.                               |
| DT-04 | Dia de pregão e horário de verão                               | Trades no dia errado, perda diária e calendário incorretos  | `TradingCalendar` único no domínio, fusos IANA, cenários nos limites da sessão e nas datas de mudança de horário (EUA e Brasil).              |
| DT-05 | Trailing intradiário sem resultado não realizado               | Status de mesa otimista em relação à mesa real              | Aproximação documentada na tela (RF-51); campo opcional de MAE/MFE quando o CSV trouxer; avaliar integração direta na v2.                     |
| DT-06 | Regras de mesa variam e mudam                                  | Modelos desatualizados                                      | Snapshot por conta, todos os campos editáveis, aviso de "referência", revisão periódica dos modelos pelo Admin.                               |
| DT-07 | Object Calisthenics rígido demais em adaptadores e controllers | Atrito e código artificial em camadas de borda              | Regras estritas no domínio e na aplicação; regras padrão em `infrastructure` e `presentation` (decisão em ADR).                               |
| DT-08 | RLS e pool de conexões                                         | `app.tenant_id` vazando entre requisições no pool           | `SET LOCAL` sempre dentro de transação; teste de concorrência com dois tenants em paralelo.                                                   |
| DT-09 | Custo de recalcular métricas com histórico grande              | Lentidão com dezenas de milhares de trades                  | Derivados persistidos no trade, projeções diárias por conta, índices por `(tenantId, closedAt)`; medir antes de cachear.                      |
| DT-10 | Tradução incompleta ou inconsistente                           | Interface mista de idiomas                                  | Verificação de chaves no CI (RF-66), revisão nativa de `en`/`es` antes do lançamento (questão 10.11).                                         |
| DT-11 | Upload de imagens maliciosas                                   | XSS, malware, vazamento de metadados (EXIF com localização) | Validação por magic bytes, reprocessamento da imagem, remoção de EXIF, `Content-Disposition` e domínio de arquivos separado.                  |

---

## 10. Questões em Aberto

1. **Nome do domínio e marca:** domínios de `apps/web`, `apps/web-admin` e `apps/web-marketing` (ex.: `app.`, `admin.`, raiz).
2. **Vários usuários por tenant:** a v1 tem um usuário por tenant. Mesas/equipes com gestor (e mentor com acesso de leitura) entram em qual versão? O modelo `TenantMembership` já prevê isso.
3. **Planos e preços:** faixas, limites (contas, importações, armazenamento) e preços do Pro mensal/anual; haverá plano gratuito permanente?
4. **Especificação dos instrumentos:** confirmar tick size, valor por tick e horários de sessão contra a CME no momento da Fase 0; tratar feriados e sessões encurtadas (calendário de feriados da CME) na v1 ou na v1.x?
5. **Layouts de CSV:** obter arquivos reais (anonimizados) de NinjaTrader 8 (Trade Performance → Trades, em en-US e pt-BR) e Tradovate (Performance e Fills/Orders) para fixar os layouts suportados e as versões.
6. **Integração direta:** API do Tradovate e conexão com NinjaTrader para sincronização automática — v2?
7. **Provedores de produção:** nuvem (região), Postgres gerenciado, Redis, storage S3, e-mail transacional.
8. **Biblioteca de gráficos** para curva de patrimônio, calendário e recortes.
9. **Recursos sociais/mentoria:** compartilhamento de trades ou relatórios por link público — v2?
10. **IA no diário:** resumo semanal, detecção de padrões de erro — v2? Qual provedor, com que garantias de privacidade?
11. **Revisão de tradução:** quem revisa `en` e `es`? Haverá mais idiomas na v1.x?
12. **Moeda:** a v1 é só USD (futuros CME). Exibir também convertido para BRL é desejado? Com qual fonte de câmbio?
13. **Status `FAILED` automático:** manter a confirmação manual (RF-55) ou permitir que o Trader opte por encerramento automático na violação?
14. **Termos de uso e política de privacidade:** redação jurídica e base legal (LGPD) para a v1.

---

## 11. Rastreabilidade

Preenchida à medida que as specs forem aprovadas e implementadas. Um RF só é marcado como entregue quando a coluna de testes está preenchida e o `pnpm test:trace` (RF-86) passa.

| Requisito            | Spec de implementação                  | Código | Aceite (BDD)                                 | Testes |
| -------------------- | -------------------------------------- | ------ | -------------------------------------------- | ------ |
| RF-01 a RF-07        | `.docs/specs/identity/` _(a criar)_    | —      | CA-RF01-1 a CA-RF07-2                        | —      |
| RF-08 a RF-10        | `.docs/specs/tenancy/` _(a criar)_     | —      | CA-RF08-1 a CA-RF10-1                        | —      |
| RF-11 a RF-17        | `.docs/specs/accounts/` _(a criar)_    | —      | CA-RF11-1 a CA-RF17-1                        | —      |
| RF-18 a RF-20        | `.docs/specs/instruments/` _(a criar)_ | —      | CA-RF19-1 a CA-RF20-3                        | —      |
| RF-21 a RF-25, RF-87 | `.docs/specs/trades/` _(a criar)_      | —      | CA-RF21-1 a CA-RF25-1, CA-RF87-1 a CA-RF87-3 | —      |
| RF-26 a RF-32        | `.docs/specs/journal/` _(a criar)_     | —      | CA-RF26-1 a CA-RF32-1                        | —      |
| RF-33 a RF-42        | `.docs/specs/imports/` _(a criar)_     | —      | CA-RF33-1 a CA-RF42-1                        | —      |
| RF-43 a RF-50        | `.docs/specs/analytics/` _(a criar)_   | —      | CA-RF43-1 a CA-RF50-1                        | —      |
| RF-51 a RF-57        | `.docs/specs/prop-rules/` _(a criar)_  | —      | CA-RF51-1 a CA-RF57-2                        | —      |
| RF-58 a RF-61        | `.docs/specs/trades/` _(a criar)_      | —      | CA-RF58-1 a CA-RF61-1                        | —      |
| RF-62 a RF-66        | `.docs/specs/i18n/` _(a criar)_        | —      | CA-RF62-1 a CA-RF66-1                        | —      |
| RF-67 a RF-71        | `.docs/specs/billing/` _(a criar)_     | —      | CA-RF68-1 a CA-RF71-2                        | —      |
| RF-72 a RF-77        | `.docs/specs/admin/` _(a criar)_       | —      | CA-RF72-1 a CA-RF77-1                        | —      |
| RF-78 a RF-79        | `.docs/specs/marketing/` _(a criar)_   | —      | CA-RF78-1 a CA-RF79-1                        | —      |
| RF-80 a RF-86        | `.docs/specs/platform/` _(a criar)_    | —      | CA-RF80-1 a CA-RF86-1                        | —      |

> **Fundação da Fase 0 (infraestrutura, sem RF):** change OpenSpec `openspec/changes/config-projeto/` (monorepo, env, `docker compose` local, Prisma, Redis e a fundação do Better-Auth). Não entrega nenhum RF nem marca linha desta tabela: os cenários `CA-*` de identidade continuam com as specs de `.docs/specs/identity/`. Pendências abertas pelo bootstrap em `.docs/pendencias/fase-0.md`.

> Todo RF desta versão tem ao menos um cenário `CA-*`. Cenários técnicos adicionais descobertos durante a escrita de uma spec de feature voltam a este PRD na revisão seguinte, para que o `test:trace` os cubra.

### 11.1 Glossário de domínio (linguagem ubíqua)

| Termo (pt-BR)           | Termo no código            | Definição                                                                                                                   |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Tenant                  | `Tenant`                   | Espaço isolado de dados de um Trader.                                                                                       |
| Trader                  | `Trader` / `TraderProfile` | Usuário dono de um tenant.                                                                                                  |
| Finalidade da conta     | `TradingAccount` (subtipo) | Para que a conta serve: Conta Própria ou Conta de Mesa. Eixo da conta, não do Trader.                                       |
| Conta Própria           | `PersonalAccount`          | Conta de trading com capital do próprio Trader.                                                                             |
| Conta de Mesa           | `PropFirmAccount`          | Conta de mesa proprietária, com conjunto de regras.                                                                         |
| Conjunto de regras      | `PropFirmRuleSet`          | Snapshot das regras de uma conta de mesa.                                                                                   |
| Modelo de regras        | `PropFirmRuleTemplate`     | Conjunto de regras de referência do catálogo global.                                                                        |
| Nível de liquidação     | `LiquidationThreshold`     | Saldo abaixo do qual a conta de mesa viola o drawdown.                                                                      |
| Instrumento             | `Instrument`               | Contrato futuro pela raiz (NQ, MNQ, ES, MES).                                                                               |
| Símbolo de contrato     | `ContractSymbol`           | Raiz + vencimento (ex.: `NQZ6`).                                                                                            |
| Tick                    | `TickSize` / `TickValue`   | Menor variação de preço e seu valor monetário por contrato.                                                                 |
| Trade                   | `Trade`                    | Operação completa, de flat a flat, num instrumento e numa conta.                                                            |
| Modalidade              | `TradeModality`            | Day trade (abre e fecha no mesmo dia de pregão) ou swing trade (atravessa o fechamento da sessão). Eixo do trade, derivado. |
| Execução                | `Execution`                | Um fill de compra ou venda.                                                                                                 |
| Resultado bruto/líquido | `grossPnl` / `netPnl`      | Resultado antes/depois de comissões e taxas.                                                                                |
| Múltiplo de R           | `RMultiple`                | Resultado líquido ÷ risco planejado.                                                                                        |
| Taxa de acerto          | `winRate`                  | Ganhadores ÷ (ganhadores + perdedores).                                                                                     |
| Payoff                  | `payoffRatio`              | Ganho médio ÷ \|perda média\|.                                                                                              |
| Expectativa             | `expectancy`               | Resultado médio por trade.                                                                                                  |
| Fator de lucro          | `profitFactor`             | Soma dos ganhos ÷ \|soma das perdas\|.                                                                                      |
| Drawdown                | `drawdown`                 | Queda do patrimônio a partir do pico.                                                                                       |
| Dia de pregão           | `TradingDay`               | Dia da sessão do instrumento a que um trade pertence (pela saída).                                                          |
| Setup                   | `Setup`                    | Padrão de entrada definido pelo Trader.                                                                                     |
| Erro                    | `Mistake`                  | Falha de disciplina registrada num trade.                                                                                   |
| Revisão diária          | `DailyReview`              | Entrada de diário de um dia de pregão.                                                                                      |
| Lote de importação      | `ImportBatch`              | Um arquivo CSV importado e seu processamento.                                                                               |
| Trade normalizado       | `NormalizedTrade`          | Representação agnóstica de plataforma, saída dos parsers.                                                                   |
| Impressão digital       | `fingerprint`              | Hash que identifica um trade importado para deduplicação.                                                                   |
| Idioma                  | `Locale`                   | `pt-BR`, `en` ou `es`.                                                                                                      |
| Somente leitura         | `READ_ONLY`                | Estado do tenant sem assinatura válida: lê e exporta, não escreve.                                                          |

---

## 12. Roadmap

**Testes e spec em todas as fases.** Nenhuma fase entrega um RF sem spec aprovada e sem os cenários de aceite automatizados antes do código (§6.3, §7.1).

**Fase 0 — Fundação do monorepo**
pnpm + Turborepo, `packages/tsconfig`, `eslint-config` (incluindo Object Calisthenics e fronteiras), `docker compose` (Postgres, Redis, MinIO, Mailpit), CI com todos os gates (vazios), esqueleto dos quatro apps, `packages/domain` com `Money` e `TickCalculator`, `packages/i18n` com os três idiomas, schema Prisma inicial com RLS (spec `RF-00-schema`), template de spec e de ADR, script `test:trace`.

**Fase 1 — Identidade e multi-tenancy**
RF-01 a RF-10, RF-62 a RF-65 (base), RF-80, RF-81, RF-84, RF-85: cadastro com criação de tenant, login, recuperação, `TenantContext` nas três camadas, preferências, i18n de ponta a ponta, matriz de isolamento rodando.

**Fase 2 — Contas e instrumentos**
RF-11 a RF-20: Conta Própria, Conta de Mesa com regras e modelos, ajustes de saldo, catálogo de instrumentos e resolução de símbolos.

**Fase 3 — Registro manual e diário**
RF-21 a RF-32, RF-58 a RF-61 e RF-87: trades com execuções, modalidade (day/swing), R, contexto, capturas, revisão diária, lista, detalhe e exportação.

**Fase 4 — Importação**
RF-33 a RF-42: pipeline completo, NinjaTrader e Tradovate, prévia, deduplicação, falhas parciais, histórico e desfazer.

**Fase 5 — Métricas e dashboard**
RF-43 a RF-50: métricas centrais, drawdown, recortes, filtros, calendário, dia de pregão, comportamento, dashboard.

**Fase 6 — Regras de mesa**
RF-51 a RF-57: políticas de drawdown, perda diária, meta, consistência, dias mínimos e contratos; painel da conta de mesa; recálculo.

**Fase 7 — Monetização e Admin**
RF-67 a RF-77: planos, teste, Stripe, webhooks, degradação, módulo Admin e auditoria.

**Fase 8 — Lançamento**
RF-66 (cobertura de traduções revisada), RF-78, RF-79, RF-82, RF-83, RF-86 como gate: landing, LGPD, NFRs de desempenho validados, Playwright nos fluxos críticos.

**Pós-v1 (candidatos)** — integração direta com Tradovate/NinjaTrader, mais instrumentos, equipes e mentoria, IA no diário, app mobile, conversão para BRL.
