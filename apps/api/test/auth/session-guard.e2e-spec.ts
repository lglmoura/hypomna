import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../../src/app.module.js';
import { SessionGuard } from '../../src/auth/session.guard.js';
import { SessionCacheModule } from '../../src/lib/session-cache/session-cache.module.js';

// No business route uses SessionGuard yet, so this probe route exists only in the test
// module, never in production (change config-projeto, spec identity/auth-foundation,
// "Rota protegida sem sessão responde 401").
@Controller('test-only/protected-probe')
class ProtectedProbeController {
  @Get()
  @UseGuards(SessionGuard)
  getProbe() {
    return { ok: true };
  }
}

@Module({
  imports: [SessionCacheModule],
  controllers: [ProtectedProbeController],
})
class ProtectedProbeModule {}

describe('SessionGuard (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, ProtectedProbeModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds 401 with code UNAUTHORIZED when a protected route is called without a session cookie', async () => {
    const response = await request(app.getHttpServer()).get(
      '/test-only/protected-probe',
    );

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
    });
  });
});
