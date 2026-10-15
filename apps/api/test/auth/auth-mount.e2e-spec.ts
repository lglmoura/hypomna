import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../../src/app.module.js';
import { SessionGuard } from '../../src/auth/session.guard.js';
import { SessionCacheModule } from '../../src/lib/session-cache/session-cache.module.js';

// P0-29 (change config-projeto): Better-Auth must read the raw request body on /api/auth/*,
// while every other route keeps JSON parsing. Probe routes exist only in this test module.
@Controller('test-only')
class ProbeController {
  @Get('protected-probe')
  @UseGuards(SessionGuard)
  getProtected() {
    return { ok: true };
  }

  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: body };
  }
}

@Module({
  imports: [SessionCacheModule],
  controllers: [ProbeController],
})
class ProbeModule {}

const credentials = {
  name: 'Trader A',
  email: 'trader-a@hypomna.test',
  password: 'correct-horse-battery-staple',
};

const sessionCookieOf = (setCookie: string[] | string | undefined) =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .filter((cookie) => cookie.includes('session_token'))
    .join('; ');

describe('Better-Auth mount (e2e)', () => {
  let app: INestApplication<App>;
  const origin = process.env.WEB_BASE_URL ?? '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up and signs in by e-mail and password, returning a session cookie the SessionGuard accepts', async () => {
    const server = app.getHttpServer();

    const signUp = await request(server)
      .post('/api/auth/sign-up/email')
      .set('Origin', origin)
      .send(credentials)
      .timeout(10_000);
    expect(signUp.status).toBe(200);

    const signIn = await request(server)
      .post('/api/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: credentials.email, password: credentials.password })
      .timeout(10_000);
    expect(signIn.status).toBe(200);

    const cookie = sessionCookieOf(signIn.headers['set-cookie']);
    expect(cookie).not.toBe('');

    const session = await request(server)
      .get('/api/auth/get-session')
      .set('Cookie', cookie);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(credentials.email);

    const protectedRoute = await request(server)
      .get('/test-only/protected-probe')
      .set('Cookie', cookie);
    expect(protectedRoute.status).toBe(200);
  });

  it('keeps parsing JSON bodies on routes outside /api/auth', async () => {
    const response = await request(app.getHttpServer())
      .post('/test-only/echo')
      .send({ value: 'kept' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ received: { value: 'kept' } });
  });
});
