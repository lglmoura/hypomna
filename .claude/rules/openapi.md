---
paths:
  - "apps/api/**/*"
  - "packages/contracts/**/*"
---

# Documentação OpenAPI

Resumo operacional do RF-80 (PRD §4.15) e do contrato da §7: o documento OpenAPI 3.1 é gerado dos schemas Zod de `packages/contracts`, sai em `GET /openapi.json` e é publicado em `GET /docs` (rotas abertas, RF-04). Ele é a fonte do client Orval de `packages/api-client` e da matriz de isolamento (RF-85). Em caso de divergência, o PRD manda.

## Regras para rota nova

- **SEMPRE** declare request e response da rota com schemas de `packages/contracts`; **NUNCA** um tipo solto só no controller. O schema é o contrato e a fonte do OpenAPI.
- **SEMPRE** ponha uma tag por módulo no controller (o bounded context em PascalCase: `Accounts`, `Trades`, `Imports`, `Analytics`, `PropRules`…). Ela agrupa as rotas na documentação.
- **SEMPRE** dê a cada rota um `summary` e um `operationId`:
  - `operationId`: camelCase, verbo + recurso, único em toda a API (`createTradingAccount`, `importTradesCsv`). O Orval usa o valor como nome da função e do hook gerados, então ele é contrato: renomear quebra os clientes.
  - `summary`: frase curta em `pt-BR`, no infinitivo, com os termos do glossário (§11.1). Ex.: `'Importar trades de um arquivo CSV'`. Sem ponto final, sem `code`, sem id nem dado de tenant. Detalhe que não cabe no título vai em `description`.
- **SEMPRE** declare as respostas de sucesso e de erro, com o schema de erro `{ error, code, message, details? }` e os `code` possíveis da rota. Toda operação documenta o `Accept-Language` e o `Content-Language` (RF-63).
- Valores monetários aparecem no schema como string decimal, e instantes como `date-time` UTC; **NUNCA** `number` para dinheiro no contrato.
- Rotas abertas (`/health`, `/docs`, `/openapi.json`, `/public/*`, `/api/auth/*`, `/webhooks/*`) são declaradas como tal; o resto declara a exigência de sessão.
- Rota nova **SEMPRE** entra na matriz de isolamento (RF-85), que percorre o OpenAPI, e vem com o client Orval regenerado e commitado: o CI falha se o client divergir (CA-RF80-1).
