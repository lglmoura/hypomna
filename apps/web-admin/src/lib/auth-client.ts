import { createAuthClient } from 'better-auth/react';

// authClient.useSession() em Client Components; authClient.getSession() em
// Server Components (via getServerSession(), ao lado deste arquivo) — ver
// .claude/rules/auth-client.md. Nunca usar middleware para verificacao de
// sessao em web-admin. Sessao por cookie (PRD §4.1, RF-03).
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});
