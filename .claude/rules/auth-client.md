---
paths:
  - "apps/web/**/*"
  - "apps/web-admin/**/*"
  - "apps/web-marketing/**/*"
---

# Verificação de Sessão no Cliente

Convenção dos clientes web do monorepo: `apps/web` (Trader) e `apps/web-admin` (Admin e Suporte), ambos com sessão por cookie do Better-Auth; `apps/web-marketing` não autentica ninguém. Ver PRD §1.4, §3.3, §3.4, §4.1 e §4.13.

## Todos os clientes autenticados

- **NUNCA** use middleware do Next.js (`middleware.ts`) para autenticação ou autorização.
- **SEMPRE** verifique a sessão na própria página: `getServerSession()` (que encaminha `headers()` para `authClient.getSession()`) em Server Components e `authClient.useSession()` em Client Components. Nunca centralizada em um único ponto de entrada.
- A checagem de sessão sempre bate na API (rota de sessão do Better-Auth). O cliente nunca decide autorização a partir de estado armazenado sem revalidar; quem autoriza de fato é a API (`TenantGuard`, `AdminGuard`).
- O cookie é `HttpOnly`, `Secure`, `SameSite=Lax` e cada app tem o seu domínio: **NUNCA** compartilhe sessão entre `apps/web` e `apps/web-admin` (RF-03, princípio 7).
- Login e cadastro só por e-mail e senha. Falha de login mostra mensagem genérica, sem revelar se o e-mail existe; recuperação de senha responde sempre igual (RF-03, RF-05). Bloqueio progressivo (`429 RATE_LIMITED`) mostra quando tentar de novo, a partir do `Retry-After` (RF-81).

## apps/web (Trader)

- Páginas do app redirecionam para o login quando não há sessão válida; login e cadastro redirecionam para o app quando já existe sessão válida.
- O cadastro cria o tenant na API (RF-01) com o idioma e o fuso detectados do navegador; vindo da landing, preserva o idioma e as UTMs (RF-79). E-mail não verificado não entra (RF-02).
- Tenant `SUSPENDED`: a API recusa a sessão (`401`) e o login mostra mensagem genérica. Tenant `READ_ONLY`: a sessão continua válida, e o bloqueio de escrita vem da API (`402 SUBSCRIPTION_REQUIRED`, `api.md`).
- Usuário com `platformRole` (Admin ou Suporte) não usa `apps/web`: nenhuma tela do Trader aceita o papel como atalho.

## apps/web-admin (Admin e Suporte)

- Toda página verifica sessão **e** `platformRole` (`ADMIN` ou `SUPPORT`) na própria página. Sem sessão, redireciona para o login do Admin; usuário autenticado sem o papel recebe `404`, não um redirect que denuncie a existência da área (CA-RF72-2).
- O login do Admin exige segundo fator (TOTP, RF-07). Não existe cadastro público de Admin ou Suporte.
- Ações com efeito (suspender, reativar, cortesia, catálogo, concessão de papel) só aparecem para `ADMIN`; o Suporte vê, não age (CA-RF74-2). A interface esconde a ação, mas a decisão é da API.

## apps/web-marketing

- Não autentica ninguém: **nunca** verifica sessão, não tem `authClient` e não guarda sessão (RF-79). Consome apenas `/public/*`. "Começar teste grátis" leva ao cadastro de `apps/web`.
