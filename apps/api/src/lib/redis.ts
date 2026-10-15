import { Logger } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

// Redis nunca e' fonte de verdade neste produto. Instancia unica em REDIS_URL
// (PRD 6.2/7), noeviction por causa do BullMQ: fila (importacao, recalculo de
// status de mesa, exportacao, e-mails e webhooks), rate limit (RF-81) e cache
// de sessao. Toda chave de cache precisa de TTL proprio, e toda chave de dado de
// dominio e' prefixada pelo tenantId (PRD 3.2).

const logger = new Logger('Redis');

function parseRedisUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    db:
      url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
  };
}

function requireRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required to create a Redis connection');
  }
  return redisUrl;
}

// Com o Redis fora do ar, o Node tenta IPv6 e IPv4 em paralelo e o ioredis
// repassa um AggregateError cujo .message e' vazio — o detalhe real fica em
// .errors. Ler so error.message produzia um log truncado, sem causa nenhuma.
function describeRedisError(error: Error): string {
  if (error instanceof AggregateError) {
    const causes = error.errors
      .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
      .filter(Boolean);

    if (causes.length > 0) {
      return causes.join('; ');
    }
  }

  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || String(error);
}

// Client de cache, usado pelo cache de sessao e pelo rate limiter (RF-81). Um
// maxRetriesPerRequest baixo evita que uma queda do Redis prenda o caminho da
// requisicao — quem consome este client captura o erro e degrada: cache de
// sessao -> Postgres; rate limit -> ver redis-throttler.storage.ts.
export function createCacheRedisClient(keyPrefix: string): Redis {
  const options: RedisOptions = {
    ...parseRedisUrl(requireRedisUrl()),
    keyPrefix,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  };

  const client = new Redis(options);

  // O ioredis reemite 'error' a cada tentativa de reconexao (varias por segundo
  // enquanto o Redis esta fora), entao logar todas afoga o log — 81 linhas em
  // 20s com dois clients — e esconde problema real. Aqui so a transicao de
  // estado e' registrada: o primeiro erro depois de uma conexao saudavel, e a
  // recuperacao quando o Redis volta.
  let degraded = false;

  client.on('error', (error) => {
    if (degraded) return;
    degraded = true;
    logger.warn(
      `Redis cache unavailable (prefix "${keyPrefix}"): ${describeRedisError(error)}`,
    );
  });

  client.on('ready', () => {
    if (!degraded) return;
    degraded = false;
    logger.log(`Redis cache reconnected (prefix "${keyPrefix}")`);
  });

  return client;
}

// Fecha um client no shutdown. quit() rejeita quando a conexao ja caiu (Redis
// fora do ar, ou socket encerrado no meio de uma reconexao), e essa rejeicao
// chegava a' tona como "Connection is closed" nao tratado — derrubando o
// processo de teste mesmo com todos os testes passando. Encerrar e' best-effort:
// o processo esta terminando de qualquer forma, entao o fallback e' o disconnect
// sincrono, que nao espera resposta do servidor.
export async function closeRedisClient(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

// Opcoes de conexao para o BullMQ. O proprio BullMQ gerencia retry/backoff da
// fila e exige maxRetriesPerRequest: null / enableReadyCheck: false — nao
// reaproveitar createCacheRedisClient() para filas.
export function createQueueConnectionOptions(): RedisOptions {
  return {
    ...parseRedisUrl(requireRedisUrl()),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
