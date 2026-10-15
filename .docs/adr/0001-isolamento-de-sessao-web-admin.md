# ADR 0001 — Isolamento de sessão entre `apps/web` e `apps/web-admin`

- **Status:** Aceito
- **Data:** 2026-10-15
- **Decisão de:** Luiz Gustavo Lourenço Moura
- **Requisitos:** CA-RF03-2, RF-03, RF-07; PRD §1.5 (princípio 7), §4.1, §6.2
- **Origem:** change OpenSpec `config-projeto`, task 5.14; pendência P0-25 (`.docs/pendencias/fase-0.md`)

## Contexto

O PRD exige que `apps/web` (Trader) e `apps/web-admin` (Admin e Suporte) usem sessão por cookie `HttpOnly`, `Secure` e `SameSite=Lax`, "em domínios distintos (sessões nunca compartilhadas)" (RF-03), e que um Trader autenticado em `apps/web` não esteja autenticado em `apps/web-admin` (CA-RF03-2).

O bootstrap deixou uma única instância do Better-Auth em `apps/api`, montada em `/api/auth/*`. Os dois apps chamam a API direto, com `credentials`, pela URL de `NEXT_PUBLIC_API_URL`. O cookie de sessão nasce no domínio da API e, para o navegador, é o mesmo cookie nos dois apps: a sessão de um vale no outro, e o CA-RF03-2 não é atendido. Além disso, o cookie fica cross-site em relação ao app, o que depende de CORS com credenciais e de cookie de terceiro.

## Decisão

**Cada app Next expõe a API na própria origem, por rewrite same-origin, e o cookie de sessão nasce no domínio do app.**

1. `apps/web` e `apps/web-admin` declaram um rewrite de `/api/:path*` para o `apps/api`. O navegador só fala com a origem do próprio app (`app.<domínio>` e `admin.<domínio>`; os nomes definitivos dependem da questão 10.1 do PRD).
2. Os auth-clients e o client da API usam caminho relativo (`/api/...`), nunca a URL da API. A URL do backend passa a ser configuração **só do servidor** do app Next, usada pelo rewrite.
3. O cookie de sessão é host-only, sem atributo `Domain`, e **nunca** usa `crossSubDomainCookies`. Domínios distintos bastam para o navegador isolar as duas sessões.
4. Uma única instância do Better-Auth atende os dois hosts, com `baseURL` dinâmico restrito aos hosts dos dois apps (`allowedHosts`) e `trustedOrigins` com exatamente essas duas origens.
5. **Defesa em profundidade: audiência da sessão.** Ao criar a sessão, a API grava a qual app ela pertence (`web` ou `web-admin`), derivado do host encaminhado pelo rewrite. A guarda de sessão rejeita com `401 UNAUTHORIZED` uma sessão usada a partir de outro app. Assim, um token copiado de um app para o outro não autentica.
6. O login pelo host do `web-admin` só aceita usuário com `platformRole` (`ADMIN` ou `SUPPORT`) e exige TOTP (RF-07). A autorização continua na API: `AdminGuard` no módulo `admin`, distinto do `TenantGuard`.

## Alternativas consideradas

- **Duas instâncias do Better-Auth** (`/api/auth/*` para o Trader e `/api/admin-auth/*` para o Admin, com `cookiePrefix` próprio). Descartada. Os cookies continuariam no domínio da API, cross-site e dependentes de CORS com credenciais. As duas instâncias compartilhariam a tabela `session` e ainda precisariam da marcação de audiência para rejeitar a sessão da outra. E o `auth.ts` é regenerado pela skill `config-auth`, o que torna duas instâncias mais caras de manter.
- **Uma instância com cookie no domínio da API e `cookiePrefix` diferente por app.** Descartada. O `cookiePrefix` é configuração estática da instância, e o isolamento dependeria só do nome do cookie, não do navegador.
- **`crossSubDomainCookies` num domínio pai comum.** Descartada. É o oposto do pedido: compartilha a sessão entre os subdomínios.

## Consequências

- **Positivas:** o isolamento vem do próprio navegador, por domínios distintos. O cookie é first-party, então `SameSite=Lax` funciona como esperado e não há dependência de cookie de terceiro (ITP do Safari, bloqueios do Chrome). O CORS com credenciais deixa de ser necessário para os dois apps.
- **Custos:**
  - Todo tráfego dos apps para a API passa pelo servidor Next de cada app (um salto a mais).
  - A API precisa confiar no host encaminhado só quando ele vem do proxy dos apps, para a audiência da sessão não ser forjável.
  - O campo de audiência entra no modelo de sessão, com migration.
- **Mudanças no que o bootstrap gerou** (feitas na spec de identidade, não nesta change):
  - `NEXT_PUBLIC_API_URL` deixa de ser usado pelo navegador nos dois apps: o rewrite usa uma variável só de servidor.
  - O `baseURL` dos auth-clients passa a ser relativo.
  - `trustedOrigins` e CORS são revistos (ver P0-27).
  - `apps/web-marketing` não muda: não autentica ninguém.
- **A verificar na implementação:**
  - Como o rewrite do Next encaminha o host original (cabeçalhos `x-forwarded-host` e `x-forwarded-proto`).
  - Como o Better-Auth resolve o `baseURL` dinâmico atrás desse proxy.
  - O nome final dos cookies em produção (prefixo `__Secure-`).
  - A correção do body parser no Nest (P0-29), que bloqueia qualquer login real.

## Verificação

A decisão só está implementada quando estes testes existem e passam, escritos antes do código (`.claude/rules/testing.md`):

- **CA-RF03-2** (aceite): Trader autenticado em `apps/web` abre `apps/web-admin` e não está autenticado ali.
- **e2e da API:** a sessão criada pelo host do `web` é recusada com `401 UNAUTHORIZED` quando apresentada pelo host do `web-admin`, e vice-versa.
- **e2e da API:** login pelo host do `web-admin` de usuário sem `platformRole` é recusado.
- O cookie de sessão sai sem atributo `Domain` e com `HttpOnly`, `Secure` e `SameSite=Lax`.

A implementação pertence à spec de identidade da Fase 1 (`.docs/specs/identity/`), junto com o RF-03 e o RF-07.
