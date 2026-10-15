import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import { PrismaClient } from '../generated/prisma/client.js';
import { closeRedisClient, createCacheRedisClient } from './redis.js';

// auth.ts precisa ser um singleton carregado fora do container de DI do Nest
// (todo doc oficial do Better-Auth exporta `auth` assim), entao usa seu
// proprio PrismaClient em vez do PrismaService injetavel de src/db.
const authPrismaClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Mesmo prefixo "session:" do SessionCacheService (config-redis) — necessario para
// que a invalidacao no logout limpe a mesma chave que o SessionGuard le. Um erro
// aqui nunca deve impedir o logout de completar no Postgres.
const sessionCacheClient = createCacheRedisClient('session:');

// Este client vive no escopo do modulo (o betterAuth() abaixo precisa dele no
// databaseHooks), fora do container do Nest — entao nao tem onModuleDestroy
// proprio. O AuthModule chama isto no shutdown para nao deixar conexao aberta.
export async function closeAuthSessionCache(): Promise<void> {
  await closeRedisClient(sessionCacheClient);
}

// Origens confiaveis: os clientes web que autenticam por cookie (apps/web e apps/web-admin,
// PRD §4.1). web-marketing nao autentica ninguem e nao entra aqui.
const trustedOrigins = [
  process.env.WEB_BASE_URL,
  process.env.WEB_ADMIN_BASE_URL,
].filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  baseURL: process.env.API_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(authPrismaClient, { provider: 'postgresql' }),
  // RF-03: e-mail e senha e' o unico metodo de login (sem provedor social), para o Trader
  // (apps/web) e para Admin/Suporte (apps/web-admin).
  emailAndPassword: {
    enabled: true,
  },
  // Campo do User que o PRD §5 acrescenta ao modelo do Better-Auth. input: false — o client
  // nunca pode define-lo: sem isso um cadastro poderia enviar platformRole = ADMIN (CA-RF07-1).
  user: {
    additionalFields: {
      platformRole: { type: 'string', required: false, input: false },
    },
  },
  // Invalida o cache de sessao no mesmo fluxo do logout/revogacao — nunca so por TTL
  // passivo, para nao aceitar uma sessao ja revogada no Postgres (CA-RF05-2).
  databaseHooks: {
    session: {
      delete: {
        after: async (session) => {
          await sessionCacheClient.del(session.token);
        },
      },
    },
  },
});
