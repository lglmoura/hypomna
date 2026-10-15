import { headers } from 'next/headers';

import { authClient } from './auth-client';

// web e apps/api sao apps separados (origens diferentes) — um Server
// Component nao tem acesso automatico ao cookie de sessao como teria um
// Better-Auth co-localizado no mesmo Next.js app, entao os headers da
// requisicao recebida precisam ser encaminhados explicitamente.
export async function getServerSession() {
  const { data } = await authClient.getSession({
    fetchOptions: { headers: await headers() },
  });
  return data;
}
