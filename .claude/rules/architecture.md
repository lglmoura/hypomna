---
paths:
  - "apps/api/**/*"
  - "packages/domain/**/*"
---

# Arquitetura da API (NestJS, Clean Architecture)

Resumo operacional do PRD §3 (multi-tenancy), §5 ("Restrições que o schema deve garantir"), §6.2 ("Arquitetura da API") e §7 ("Isolamento multi-tenant", "Precisão monetária", "Arquitetura", "Object Calisthenics", "Imutabilidade", "Contrato", "Datas e fusos", "Segurança", "Observabilidade"). Em caso de divergência, o PRD manda.

## Camadas: Presentation → Application → Domain

- Cada bounded context é um módulo em `apps/api/src/modules/<contexto>/` (`identity`, `tenancy`, `accounts`, `instruments`, `trades`, `journal`, `imports`, `analytics`, `prop-rules`, `billing`, `admin`, `i18n`, `platform`), com as pastas `application/`, `infrastructure/` e `presentation/`. O que é transversal (`TenantContext`, `ExceptionFilter` global, i18n de erros, relógio, gerador de IDs) fica em `apps/api/src/shared/`.
- **Regra de dependência:** `presentation → application → domain`; `infrastructure` implementa as portas (interfaces) declaradas em `application`. **NUNCA** importe `infrastructure` a partir de `application` nem de `domain`. A fronteira é garantida por `eslint-plugin-boundaries` e por teste de arquitetura no CI.
- **Presentation** (controllers Nest, guards, pipes Zod, mapeadores HTTP): valida a entrada com Zod (`nestjs-zod`), extrai sessão e `TenantContext`, chama o use case e define o status HTTP. **NUNCA** contém regra de negócio.
- **Application** (use cases): Command ou Query com um `Handler` (classe com método `execute`), separados no estilo CQRS leve; consultas de métricas podem ler projeções otimizadas. Todo use case recebe o `TenantContext` explícito e retorna um DTO de saída próprio, **NUNCA** o model do Prisma. Use case **NUNCA** conhece HTTP: lança `DomainError` com `code`.
- **Infrastructure**: repositórios Prisma, parsers de CSV (adaptadores de NinjaTrader e Tradovate), Stripe, storage e filas. Layout de terceiro é normalizado para o modelo agnóstico do domínio antes de persistir.
- Operação em várias tabelas **SEMPRE** numa única transação, que também carrega o `SET LOCAL app.tenant_id` do RLS (ex.: cadastro do Trader cria `Tenant` e `TenantMembership` `OWNER` juntos).

## Domínio (`packages/domain`)

- Núcleo puro em TypeScript: entidades, Value Objects (`Money`, `Price`, `Quantity`, `TickSize`, `TradeResult`, `Coordinates`…), políticas de mesa e calculadoras. **NUNCA** importa Nest, Prisma, Zod de transporte nem I/O do Node.
- **Precisão monetária:** valor monetário e preço só como `Money`/`Price` sobre decimal de precisão arbitrária. **NUNCA** `number`/`float` para dinheiro (garantido por lint e por tipo nominal); `NUMERIC` no banco. Arredondamento explícito, `HALF_EVEN` só na exibição, nunca no cálculo intermediário. A API devolve decimal em string, e o cliente só formata.
- **Imutabilidade:** Value Objects `readonly` e congelados; toda operação retorna nova instância.
- **Object Calisthenics** no domínio e na aplicação: um nível de indentação por método (`max-depth: 1`), sem `else` (early return), primitivos de domínio encapsulados em Value Objects, coleções de primeira classe, entidades e métodos pequenos (limites no lint).
- `PersonalAccount` e `PropFirmAccount` são conceitos distintos, cada um com as próprias regras. Instrumentos (NQ, MNQ, ES, MES) modelam tick size e valor por tick com precisão.
- Código, testes e nomes em inglês, revelando intenção (`CalculateDailyDrawdown`, não `CalcDD`).

## Contrato e validação

- Toda rota tipada com Zod na entrada e na saída; os schemas compartilhados ficam em `packages/contracts` e são a fonte do OpenAPI 3.1 (`/docs`). O client de `packages/api-client` é gerado por Orval, e o CI falha se o client commitado divergir (RF-80).
- Erros no formato `{ error, code, message, details? }`, traduzidos pelo `ExceptionFilter` global para HTTP e para o idioma resolvido (RF-63). O `code` é o contrato dos clientes e não muda.
- Variáveis de ambiente só por schema Zod validado no boot (lista no PRD §7); ausência falha a inicialização, e segredo nunca vai para o código.
- Instantes sempre em UTC no banco e na API (ISO 8601), fusos IANA. Tempo e IDs vêm de `Clock`/`TradingCalendar` e do gerador de IDs injetáveis, nunca da hora real direto no use case. IDs são UUID v7, nunca sequenciais expostos.

## Tenant e papéis

- O tenant é o Trader (`Tenant` + `TenantMembership` `OWNER`); o Admin e o Suporte (`platformRole`) não pertencem a tenant algum.
- Toda entidade de domínio do diário carrega `tenantId`. **NUNCA** consulte dado de domínio sem ele.
- O `tenantId` vem **SEMPRE** da sessão, resolvido no início da requisição (`TenantContext`), **NUNCA** do body, query, path, nome de arquivo ou conteúdo de CSV. Aceitar `tenantId` como parâmetro livre é IDOR.
- **Defesa em profundidade, três camadas (§3.2):**
  1. **Aplicação:** `TenantGuard` resolve o `TenantContext`; todo método de repositório de domínio recebe o contexto e filtra por `tenantId`.
  2. **ORM:** extensão do Prisma injeta `tenantId` em `where`/`data` e **falha** (erro, não silêncio) em query tenant-scoped sem contexto.
  3. **Banco:** RLS nas tabelas de domínio com `SET LOCAL app.tenant_id` por transação; a role da aplicação não é dona das tabelas e não tem `BYPASSRLS`. FKs compostas `(tenantId, id)` impedem referência cruzada entre tenants.
- O Admin usa o `AdminGuard`, distinto do `TenantGuard`, no módulo `admin`, e só vê **metadados** de tenants, **NUNCA** conteúdo de diário. Nenhuma rota de Trader aceita `platformRole` para pular a checagem de tenant. Ações administrativas vão para o `AuditLog`, que a aplicação não pode alterar nem apagar.
- Recurso de outro tenant responde `404` (nunca `403`), com corpo idêntico ao de um inexistente.
- Estado do tenant (§3.4): `READ_ONLY` bloqueia escrita e importação com `402 SUBSCRIPTION_REQUIRED`, mas mantém leitura e exportação; `SUSPENDED` bloqueia login e encerra sessões sem apagar dado.
- Rota nova **SEMPRE** entra na matriz de isolamento (RF-85): sem sessão, papel indevido e recurso de outro tenant, com os Traders A e B.

## Infraestrutura

- **Filas:** BullMQ sobre Redis (`REDIS_URL`) para importação, recálculo de status de mesa, exportação, e-mails e webhooks. Job carrega o `tenantId` no payload assinado pelo produtor e restabelece o `TenantContext` antes de qualquer acesso a dado.
- **Cache:** chaves de dado de domínio no Redis **SEMPRE** prefixadas por `tenantId`.
- **Storage:** porta `FileStorage` com adaptador S3 (MinIO em dev). Arquivos ficam sob `tenants/<tenantId>/…` e são servidos só por URL assinada de curta duração, emitida depois da checagem de tenant. Upload validado pelo conteúdo, não pela extensão.
- **Importação de CSV:** parser tolerante a falha parcial; linha inválida é reportada sem descartar o lote, e a deduplicação usa o fingerprint único por `(tenantId, accountId)` (RF-37).
- **Autenticação:** Better-Auth em `/api/auth/*`, sessão por cookie para `apps/web` e `apps/web-admin` (domínios distintos), TOTP para o Admin.
- **Segurança:** `helmet`, CSP restritiva, CSRF nas rotas de cookie, rate limit por IP e por usuário em Redis, mais restrito em `/api/auth/*`, upload e importação (`429 RATE_LIMITED` com `Retry-After`, RF-81). Assinatura do webhook do Stripe sempre verificada.
- **Observabilidade:** logs Pino estruturados com `requestId` e `tenantId`, **NUNCA** conteúdo de nota, e-mail completo ou senha; OpenTelemetry; `GET /health` (liveness) e `GET /health/ready` (Postgres, Redis, storage) (RF-84).
