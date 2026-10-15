import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { closeRedisClient, createCacheRedisClient } from '../redis.js';

// Cache-aside na frente do Postgres/Better-Auth. Nunca e' fonte de
// verdade: cache miss ou erro do Redis sempre cai para o Postgres em quem chama
// — este service nunca lanca excecao.
@Injectable()
export class SessionCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly client: Redis;
  private readonly ttlSeconds: number;

  constructor() {
    this.client = createCacheRedisClient('session:');
    this.ttlSeconds = Number(process.env.SESSION_CACHE_TTL_SECONDS ?? 300);
  }

  async get(sessionToken: string): Promise<string | null> {
    try {
      return await this.client.get(sessionToken);
    } catch (error) {
      this.logger.warn(
        `Session cache read failed, falling back to Postgres: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set(sessionToken: string, sessionPayload: string): Promise<void> {
    try {
      await this.client.set(
        sessionToken,
        sessionPayload,
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `Session cache write failed (non-fatal): ${(error as Error).message}`,
      );
    }
  }

  // Chamado no logout, na troca e redefinicao de senha (RF-05, RF-06) e na
  // suspensao do tenant (RF-74) para que uma sessao revogada nunca seja aceita a
  // partir do cache depois que o registro no Postgres ja foi invalidado.
  async invalidate(sessionToken: string): Promise<void> {
    try {
      await this.client.del(sessionToken);
    } catch (error) {
      this.logger.warn(
        `Session cache invalidation failed (non-fatal): ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }
}
