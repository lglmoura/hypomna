import { ExecutionContext, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  DEFAULT_THROTTLER_NAME,
  RedisThrottlerStorage,
  SENSITIVE_THROTTLER_NAME,
} from './redis-throttler.storage.js';

// Prefixos das rotas com limite mais restrito (RF-81). Upload e importacao entram
// aqui junto com as specs que criam essas rotas.
const SENSITIVE_ROUTE_PREFIXES = ['/api/auth'];

const isSensitiveRoute = (context: ExecutionContext): boolean => {
  const request = context.switchToHttp().getRequest<Request>();
  const url = request.originalUrl ?? request.url;
  return SENSITIVE_ROUTE_PREFIXES.some(
    (prefix) =>
      url === prefix ||
      url.startsWith(`${prefix}/`) ||
      url.startsWith(`${prefix}?`),
  );
};

// Registra o storage Redis do throttler (RF-81), mas nao aplica um guard global:
// aplique @UseGuards(ThrottlerGuard) explicitamente nos controllers cobertos pela
// spec de RF-81. O 429 do throttler ainda precisa ser mapeado para o contrato de
// erro do PRD (code RATE_LIMITED, Retry-After, message traduzida) nessa spec.
//
// Dois throttlers nomeados, cada um com skipIf, para que a politica de falha do
// storage dependa da rota sem o storage conhecer URLs:
//   - "default": rotas comuns, pula as sensiveis;
//   - "sensitive": so as rotas sensiveis, com limite proprio mais restrito.
//
// forRootAsync + useFactory adia a construcao do client Redis (e a leitura de
// REDIS_URL) para a inicializacao do modulo, em vez do momento em que o decorator
// @Module e' avaliado — mesmo padrao do QueueModule.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [],
      useFactory: () => ({
        throttlers: [
          {
            name: DEFAULT_THROTTLER_NAME,
            ttl: 60000,
            limit: 60,
            skipIf: isSensitiveRoute,
          },
          {
            name: SENSITIVE_THROTTLER_NAME,
            ttl: 60000,
            limit: 10,
            skipIf: (context: ExecutionContext) => !isSensitiveRoute(context),
          },
        ],
        storage: new RedisThrottlerStorage(),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
