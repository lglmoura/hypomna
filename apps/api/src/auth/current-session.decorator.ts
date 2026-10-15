import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { auth } from '../lib/auth.js';

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

// Extrai a sessao anexada pelo SessionGuard — use em
// controllers protegidos por @UseGuards(SessionGuard) em vez de ler
// request.session manualmente.
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Session => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { session: Session }>();
    return request.session;
  },
);
