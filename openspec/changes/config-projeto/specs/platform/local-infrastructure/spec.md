## Purpose

Define a infraestrutura local de desenvolvimento do HYPOMNA (PRD §6.1): um único `docker compose` com PostgreSQL, Redis, MinIO e Mailpit, com nomes derivados do namespace e alinhado às variáveis de ambiente do backend.

## ADDED Requirements

### Requirement: Quatro serviços num único compose

O `docker-compose.yml` do backend MUST declarar os serviços `postgres` (PostgreSQL 16 ou superior), `redis` (Redis 7 ou superior), `minio` (API S3 e console, com volume persistente) e `mailpit` (SMTP e interface web). O arquivo MUST ser criado uma única vez e cada etapa posterior MUST apenas acrescentar o seu serviço, sem reescrever os existentes.

#### Scenario: Compose válido com os quatro serviços
- **WHEN** `docker compose config` é executado no backend
- **THEN** a configuração é válida e lista `postgres`, `redis`, `minio` e `mailpit`

#### Scenario: Serviços saudáveis
- **WHEN** `docker compose up -d` é executado com Docker disponível
- **THEN** os quatro serviços sobem e ficam saudáveis

### Requirement: Nomes e credenciais derivados do namespace

Os containers MUST se chamar `hypomna-db-postgres`, `hypomna-redis`, `hypomna-storage-minio` e `hypomna-mail-mailpit`. `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB` MUST valer `hypomna`, coerentes com o `DATABASE_URL`.

#### Scenario: Conferência de nomes
- **WHEN** o compose é inspecionado
- **THEN** os `container_name` e as credenciais do Postgres batem com os valores acima

### Requirement: Redis compatível com fila

O serviço `redis` MUST rodar com `maxmemory-policy noeviction` e persistência habilitada, porque a mesma instância guarda jobs do BullMQ, contadores de rate limit e cache de sessão.

#### Scenario: Política de memória da instância
- **WHEN** a configuração `maxmemory-policy` do Redis em execução é consultada
- **THEN** o valor é `noeviction`

### Requirement: Bucket inicial criado por automação

O bucket configurado em `S3_BUCKET` MUST ser criado por um serviço de inicialização do compose de forma idempotente, nunca à mão. As credenciais do MinIO no `.env` MUST ser só de desenvolvimento.

#### Scenario: Subida repetida do compose
- **WHEN** o compose é subido duas vezes seguidas
- **THEN** o bucket existe após a primeira subida e a segunda não falha por ele já existir
