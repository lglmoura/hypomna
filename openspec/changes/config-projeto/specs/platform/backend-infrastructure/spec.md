## Purpose

Define a infraestrutura de persistência e de Redis de `apps/api` (PRD §6.2, §7) — schema modular, transações, cache de sessão, rate limit e fila — sem regra de negócio nem modelo de domínio.

## ADDED Requirements

### Requirement: Schema de banco modular por domínio

O schema do banco MUST ser composto por um arquivo por módulo em `prisma/models/`, e o client gerado MUST estar disponível antes de qualquer build do backend. Enquanto nenhum modelo real existir, o schema MUST conter só o modelo temporário de bootstrap, que MUST ser removido quando o primeiro modelo real entrar.

#### Scenario: Geração do client
- **WHEN** o script de geração do client do banco é executado no backend
- **THEN** o client é gerado sem erro

#### Scenario: Modelo temporário removido
- **WHEN** o modelo de identidade passa a existir no schema
- **THEN** o modelo temporário de bootstrap não existe mais

### Requirement: Transação explícita para casos de uso

O backend MUST expor uma porta de transação que permite a um caso de uso executar várias escritas de forma atômica.

#### Scenario: Escrita atômica
- **WHEN** um caso de uso executa duas escritas dentro da transação e a segunda falha
- **THEN** nenhuma das duas fica persistida

### Requirement: Migrations só sob demanda e não destrutivas

Uma migration MUST ser criada somente quando houver modelo real a migrar e MUST ser aplicada só com o comando que aplica o que falta. Comandos que apagam dados (reset, push com reset forçado) MUST NOT ser usados, e nenhuma migration MUST rodar contra banco que não seja o local do compose.

#### Scenario: Primeira migration do projeto
- **WHEN** o schema de identidade é migrado pela primeira vez
- **THEN** existe uma única migration nova em `prisma/migrations/`, aplicada ao banco local sem apagar dados

### Requirement: Cache de sessão nunca é fonte de verdade

O cache de sessão MUST seguir cache-aside na frente do banco, com TTL em toda chave. Cache frio ou Redis indisponível MUST cair para o banco e MUST NOT negar acesso.

#### Scenario: Redis indisponível durante a validação de sessão
- **WHEN** uma sessão válida é verificada com o Redis fora do ar
- **THEN** a sessão é validada pelo banco e o acesso é concedido

### Requirement: Rate limit com throttlers separados

O backend MUST ter storage de rate limit no Redis com dois throttlers nomeados, `default` e `sensitive`. A aplicação a rotas específicas (RF-81) e a política de degradação ficam para a spec do RF-81.

#### Scenario: Throttlers registrados
- **WHEN** o módulo de rate limit do backend é inicializado
- **THEN** os throttlers `default` e `sensitive` estão registrados e usam o Redis como storage

### Requirement: Fila nunca fail-open

A infraestrutura de fila MUST converter falha de enfileiramento em erro `503`, nunca descartando o job em silêncio. Nenhuma fila de negócio MUST ser criada por esta change.

#### Scenario: Redis indisponível ao enfileirar
- **WHEN** um job é enfileirado com o Redis fora do ar
- **THEN** a operação falha com `503`

### Requirement: Chaves de domínio prefixadas por tenant

Toda chave de cache com dado de domínio e todo payload de job MUST carregar o `tenantId` (PRD §3.2). Esta change não cria chave nem job de domínio; a regra vale para as specs que os criarem.

#### Scenario: Infraestrutura sem chave de domínio
- **WHEN** as chaves criadas pela infraestrutura são listadas
- **THEN** só existem prefixos técnicos (`session:`, `throttle:`, `bull:`), sem dado de domínio sem tenant
