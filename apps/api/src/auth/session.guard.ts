import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getSessionCookie } from 'better-auth/cookies';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';

import { auth } from '../lib/auth.js';
import { SessionCacheService } from '../lib/session-cache/session-cache.service.js';

// CA-RF04-1: nega acesso (401 UNAUTHORIZED) sem sessao valida. Cache-aside na frente
// do Postgres — le o token bruto do cookie de sessao (sem tocar o banco/Redis), usa esse
// token como chave do SessionCacheService; em cache miss, valida contra o Postgres via
// auth.api.getSession() e repovoa o cache. Nunca nega acesso so por cache frio.
//
// A credencial e' so o cookie de sessao (PRD §4.1: apps/web e apps/web-admin). A message
// traduzida do contrato de erro (RF-63) entra com o ExceptionFilter global.
//
// Este guard so autentica. O TenantGuard/TenantContext (RF-04, PRD §3.2) e o AdminGuard
// (PRD §3.3) dependem dos modelos de dominio que ainda nao existem — nao estao neste escopo.

// O token de sessao do Better-Auth chega assinado no cookie ("<token>.<assinatura>", ver
// signCookieValue de better-call, possivelmente com URL-encoding), enquanto o hook de invalidacao no logout
// (databaseHooks.session.delete.after em src/lib/auth.ts) so conhece o token cru gravado
// no Postgres. A chave de cache precisa ser o token cru dos dois lados — caso contrario o
// logout apagaria uma chave que ninguem escreveu e a sessao revogada continuaria valida no
// cache ate o TTL expirar.
function toCacheKey(credential: string): string {
  let decoded = credential;
  if (decoded.includes('%')) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // credencial malformada: segue com o valor original, o Postgres decide (401).
    }
  }
  const signatureStart = decoded.lastIndexOf('.');
  return signatureStart > 0 ? decoded.slice(0, signatureStart) : decoded;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessionCache: SessionCacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const headers = fromNodeHeaders(request.headers);

    const credential = getSessionCookie(headers);
    if (!credential) {
      throw new UnauthorizedException({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    const cacheKey = toCacheKey(credential);

    const cached = await this.sessionCache.get(cacheKey);
    if (cached) {
      (request as Request & { session: unknown }).session = JSON.parse(cached);
      return true;
    }

    const session = await auth.api.getSession({ headers });
    if (!session) {
      throw new UnauthorizedException({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    await this.sessionCache.set(cacheKey, JSON.stringify(session));
    (request as Request & { session: unknown }).session = session;
    return true;
  }
}
