## Purpose

Estabelece a fundação de autenticação do HYPOMNA (PRD §4.1, §6.2): Better-Auth na API, guarda de sessão e sessão por cookie nos clientes web autenticados, sem implementar os RFs de identidade da Fase 1.

## ADDED Requirements

### Requirement: Autenticação montada em /api/auth/*

`apps/api` MUST expor a autenticação em `/api/auth/*` com login somente por e-mail e senha, sem nenhum provedor social.

#### Scenario: Provedor social inexistente
- **WHEN** um login por provedor social é tentado em `/api/auth/*`
- **THEN** a API não oferece esse método

### Requirement: Rota protegida sem sessão responde 401

Uma rota protegida pela guarda de sessão MUST responder `401` com corpo `{ error, code: "UNAUTHORIZED" }` quando chamada sem sessão válida. A `message` traduzida do contrato de erro da PRD §4 entra com o filtro global de exceções (RF-63), fora desta change.

#### Scenario: Chamada sem cookie de sessão
- **WHEN** uma rota protegida é chamada sem cookie de sessão
- **THEN** a resposta é `401` com `code` `UNAUTHORIZED`

### Requirement: Papel de plataforma não gravável por fluxo público

O campo `platformRole` do `User` MUST NOT ser aceito como entrada em nenhum fluxo público de autenticação (CA-RF07-1). O teste do cenário pertence à spec do RF-07.

#### Scenario: Papel enviado no corpo de um fluxo público
- **WHEN** um fluxo público de autenticação recebe `platformRole` no corpo
- **THEN** o valor é ignorado e o usuário não recebe papel de plataforma

### Requirement: Invalidação de cache no logout

O logout MUST invalidar a entrada da sessão no cache de sessão.

#### Scenario: Sessão usada após logout
- **WHEN** uma sessão é encerrada e o mesmo cookie é reutilizado numa rota protegida
- **THEN** a resposta é `401`

### Requirement: Sessão por cookie só nos clientes autenticados

`apps/web` e `apps/web-admin` MUST usar sessão por cookie `HttpOnly`, `Secure` e `SameSite=Lax`, com a sessão verificada na própria página e nunca por middleware ou verificação centralizada. `apps/web-marketing` MUST NOT conter client de autenticação. O isolamento de sessão entre `apps/web` e `apps/web-admin` (CA-RF03-2) MUST ser decidido em ADR antes da spec de identidade.

#### Scenario: App de marketing sem autenticação
- **WHEN** `apps/web-marketing` é inspecionado
- **THEN** não há dependência nem client de autenticação

#### Scenario: Nenhum middleware de sessão
- **WHEN** `apps/web` e `apps/web-admin` são inspecionados
- **THEN** nenhum deles tem middleware do Next.js que verifica sessão

### Requirement: CORS com credenciais restrito aos clientes web

A API MUST aceitar requisições com credenciais somente das origens configuradas para `apps/web`, `apps/web-admin` e `apps/web-marketing`.

#### Scenario: Origem desconhecida
- **WHEN** uma requisição com credenciais chega de origem fora da lista
- **THEN** a API não devolve os cabeçalhos de CORS que a autorizam

### Requirement: Fora do escopo registrado como pendência

Cadastro com tenant (RF-01, RF-68), `TenantGuard`/`TenantContext` (RF-04), `AdminGuard` (§3.3), verificação de e-mail (RF-02), recuperação e troca de senha (RF-05, RF-06), TOTP do Admin (RF-07), rate limit de autenticação (RF-81) e o ADR de isolamento de sessão (CA-RF03-2) MUST constar como pendências desta change, cada um com spec própria em `.docs/specs/identity/`. O plugin de organização do Better-Auth MUST NOT ser usado: o tenant é o `Tenant` do domínio (PRD §3.1).

#### Scenario: Pendências listadas
- **WHEN** o `tasks.md` da change é lido
- **THEN** cada pendência acima aparece como task própria
