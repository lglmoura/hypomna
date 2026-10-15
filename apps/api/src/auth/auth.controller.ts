import { All, Controller, Req, Res } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';

import { auth } from '../lib/auth.js';

// Monta o handler do Better-Auth em /api/auth/* — rota aberta por definicao (RF-04:
// /health, /docs, /openapi.json, /public/*, /api/auth/* e /webhooks/*). Nunca aplicar
// SessionGuard aqui; o rate limit mais restrito do RF-81 entra pela spec de RF-81.
@Controller('api/auth')
export class AuthController {
  private readonly handler = toNodeHandler(auth);

  @All('*')
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    return this.handler(req, res);
  }
}
