# platform/monorepo-foundation Specification

## Purpose

Define a estrutura do monorepo do HYPOMNA (PRD §1.4, §6.1): os quatro apps, cada um com um único papel, os pacotes internos, o runtime Node fixo, os hooks de git e o ferramental de testes que toda spec de RF usa a partir da Fase 0.

## Requirements

### Requirement: Topologia de apps com um papel por app

O monorepo MUST conter exatamente os apps `apps/api` (backend NestJS), `apps/web` (Trader), `apps/web-admin` (Admin e Suporte) e `apps/web-marketing` (Visitante, sem login), todos sob o namespace `@hypomna`. Nenhum app MUST atender mais de um papel (PRD §1.5, princípio 7) e nenhum app mobile, `apps/docs` ou app de exemplo do template MUST existir (PRD §1.6).

#### Scenario: Apps presentes após o bootstrap

- **WHEN** a pasta `apps/` é listada
- **THEN** ela contém somente `api`, `web`, `web-admin` e `web-marketing`, e o `package.json` de cada um tem nome no namespace `@hypomna`

#### Scenario: Nenhum app fora da topologia

- **WHEN** o workspace é inspecionado em busca de `apps/docs`, de app Expo ou de outro app do template do Turbo
- **THEN** nenhum deles existe

### Requirement: Pacotes internos como esqueleto

O monorepo MUST conter `packages/domain`, `packages/contracts`, `packages/api-client`, `packages/i18n`, `packages/ui` e `packages/test-utils` como esqueleto (manifesto, configuração TypeScript e ponto de entrada vazio), ao lado de `packages/eslint-config` e do pacote de configuração TypeScript. Nenhum esqueleto MUST conter regra de negócio (`Money`, `TickCalculator`, catálogos de mensagens e afins pertencem a outras entregas da Fase 0).

#### Scenario: Esqueletos existentes e vazios

- **WHEN** cada pacote interno é inspecionado
- **THEN** ele tem manifesto e ponto de entrada próprios e não exporta nenhum símbolo de domínio

#### Scenario: Desvio de nome do pacote de tsconfig registrado

- **WHEN** o pacote de configuração TypeScript tem nome diferente de `packages/tsconfig` (PRD §6.1)
- **THEN** o desvio está registrado como pendência de atualização do PRD na change

### Requirement: Runtime Node fixo

O monorepo MUST declarar Node.js `>=24` em `engines.node` da raiz e MUST rejeitar a instalação com outro runtime (`engine-strict=true`).

#### Scenario: Instalação com Node incompatível

- **WHEN** a instalação de dependências é executada com Node.js abaixo de 24
- **THEN** o gerenciador de pacotes recusa a instalação por incompatibilidade de engine

### Requirement: Verificação de tipos na raiz

O monorepo MUST oferecer um comando único de verificação de tipos na raiz que percorre todos os apps e pacotes.

#### Scenario: Verificação de tipos do monorepo recém-criado

- **WHEN** `pnpm run check-types` é executado na raiz
- **THEN** o comando termina sem erro, ou a falha fica registrada como aviso na evidência da task

### Requirement: Hooks de git com os gates da PRD §7.1

O monorepo MUST executar lint e formatação nos arquivos preparados a cada commit e MUST executar a verificação de tipos e os testes unitários a cada push. Os hooks MUST NOT poder ser contornados pelo fluxo do projeto (`--no-verify` é proibido).

#### Scenario: Commit com arquivo fora do padrão

- **WHEN** um commit inclui arquivo com erro de lint
- **THEN** o hook de pre-commit falha e o commit não é criado

#### Scenario: Push com teste unitário falhando

- **WHEN** um push é feito com teste unitário vermelho ou erro de tipos
- **THEN** o hook de pre-push falha e o push não acontece

### Requirement: Base de lint do PRD §7

O lint compartilhado MUST ordenar imports, MUST proibir `else` após `return` e MUST verificar fronteiras de camada. As regras finas de Object Calisthenics e o bloqueio de `number` monetário ficam pendentes para a spec de arquitetura.

#### Scenario: Import fora de ordem

- **WHEN** um arquivo com imports fora de ordem é verificado pelo lint compartilhado
- **THEN** o lint aponta o erro de ordenação

### Requirement: Ferramental de testes e rastreabilidade

`apps/api` e os apps Next MUST ter Vitest com cobertura e suporte a cenários BDD `.feature` em pt-BR. O monorepo MUST oferecer `pnpm test:trace` (RF-86), que falha quando um cenário `CA-*` do PRD não tem teste ou quando um teste referencia um ID inexistente.

#### Scenario: Suíte de testes do monorepo recém-criado

- **WHEN** os testes de cada workspace são executados
- **THEN** o executor roda sem erro de configuração

#### Scenario: Rastreabilidade disponível

- **WHEN** `pnpm test:trace` é executado na raiz
- **THEN** o comando roda e reporta os cenários `CA-*` do PRD ainda sem teste
