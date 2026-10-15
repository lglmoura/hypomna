import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { closeRedisClient, createCacheRedisClient } from '../redis.js';

// ThrottlerStorageRecord existe internamente em @nestjs/throttler mas nao e' reexportado
// pelo index publico do pacote (confirmado: import quebra a compilacao em 6.5.x) — deriva-se
// o tipo do proprio contrato de ThrottlerStorage.increment() em vez de importar por nome.
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// Nomes dos throttlers registrados em rate-limit.module.ts. O storage recebe o nome em
// increment(), e e' assim que ele distingue as rotas sensiveis (fail-closed) das demais.
export const DEFAULT_THROTTLER_NAME = 'default';
export const SENSITIVE_THROTTLER_NAME = 'sensitive';

// Store distribuido de rate limit (RF-81: por IP e por usuario, mais restrito em
// /api/auth/*, upload e importacao) — necessario porque apps/api roda em multiplas
// instancias e um contador em memoria nao seria compartilhado entre elas.
//
// Politica de degradacao com o Redis fora do ar (nao definida no PRD; confirmar na spec
// de RF-81 e levar ao PRD):
//   - rotas comuns: FAIL-OPEN — deixa passar, sem 503 global;
//   - rotas sensiveis: FAIL-CLOSED — recusa com 503, para o login nunca ficar sem o
//     bloqueio progressivo contra forca bruta.
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: Redis;

  constructor() {
    this.client = createCacheRedisClient('throttle:');
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const storageKey = `${throttlerName}:${key}`;
      const blockKey = `${throttlerName}:block:${key}`;

      const blockTtl = await this.client.pttl(blockKey);
      if (blockTtl > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: Math.ceil(blockTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockTtl / 1000),
        };
      }

      const totalHits = await this.client.incr(storageKey);
      if (totalHits === 1) {
        await this.client.pexpire(storageKey, ttl);
      }
      const timeToExpire = await this.client.pttl(storageKey);

      if (totalHits > limit) {
        await this.client.set(blockKey, '1', 'PX', blockDuration);
        return {
          totalHits,
          timeToExpire: Math.ceil(Math.max(timeToExpire, 0) / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockDuration / 1000),
        };
      }

      return {
        totalHits,
        timeToExpire: Math.ceil(Math.max(timeToExpire, 0) / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      if (throttlerName === SENSITIVE_THROTTLER_NAME) {
        this.logger.error(
          `Rate limit check failed for a sensitive route, failing closed: ${(error as Error).message}`,
        );
        throw new ServiceUnavailableException({
          error: 'Service Unavailable',
          code: 'RATE_LIMIT_UNAVAILABLE',
        });
      }

      this.logger.warn(
        `Rate limit check failed, failing open: ${(error as Error).message}`,
      );
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  // Sem fechar o client no shutdown, o ioredis deixa reconexao pendente e o
  // processo morre com "Connection is closed" como rejeicao nao tratada — o que
  // fazia o suite e2e falhar de forma intermitente mesmo com o teste passando.
  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }
}
