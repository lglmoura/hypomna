## Purpose

Garante que cada app do HYPOMNA valide suas variáveis de ambiente na inicialização (PRD §7, "Variáveis de ambiente (iniciais)") e que nenhum segredo real seja versionado.

## ADDED Requirements

### Requirement: Validação de env do backend no boot

`apps/api` MUST validar por schema as variáveis do PRD §7 que o bootstrap usa: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `API_BASE_URL`, `WEB_BASE_URL`, `WEB_ADMIN_BASE_URL`, `WEB_MARKETING_BASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `SMTP_URL`, `EMAIL_FROM`, `DEFAULT_LOCALE` e `SUPPORTED_LOCALES`. A ausência ou o formato inválido de uma variável obrigatória MUST impedir o boot. `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `OTEL_EXPORTER_OTLP_ENDPOINT` MUST ser aceitas como opcionais até as fases que as consomem.

#### Scenario: Variável obrigatória ausente
- **WHEN** `apps/api` inicia sem `DATABASE_URL`
- **THEN** o boot falha com mensagem que identifica a variável ausente

#### Scenario: Variáveis opcionais de fases futuras ausentes
- **WHEN** `apps/api` inicia sem `STRIPE_SECRET_KEY` e sem `OTEL_EXPORTER_OTLP_ENDPOINT`, com todas as obrigatórias presentes
- **THEN** a validação de env passa

### Requirement: Validação de env dos apps Next

Cada app Next MUST validar por schema as variáveis públicas que consome, incluindo a URL da API (`NEXT_PUBLIC_API_URL`).

#### Scenario: URL da API inválida no app web
- **WHEN** `apps/web` é construído com `NEXT_PUBLIC_API_URL` em formato inválido
- **THEN** a validação de env falha e identifica a variável

### Requirement: Valores locais derivados do namespace

O `.env.example` do backend MUST trazer `DATABASE_URL` igual a `postgresql://hypomna:hypomna@localhost:5432/hypomna?schema=public` e `REDIS_URL` apontando para a porta 6379 local. O `.env.example` MUST listar todas as variáveis do schema do backend.

#### Scenario: Conferência do exemplo de env
- **WHEN** `apps/api/.env.example` é lido
- **THEN** ele contém `DATABASE_URL` com usuário, senha e banco `hypomna` e todas as variáveis do schema de env

### Requirement: Segredo nunca versionado

`BETTER_AUTH_SECRET` MUST aparecer no `.env.example` só como placeholder e os arquivos `.env` MUST NOT ser versionados. O valor real MUST ser gerado pelo usuário localmente.

#### Scenario: Arquivo de env real fora do git
- **WHEN** o status do git é consultado com `apps/api/.env` presente
- **THEN** o arquivo aparece como ignorado e não pode entrar num commit sem forçar
