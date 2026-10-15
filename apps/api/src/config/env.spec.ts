import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEnv } from './env-schema.js';

const VALID_SOURCE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/app?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_SECRET: 'a-secret-with-enough-length',
  API_BASE_URL: 'http://localhost:4000',
  WEB_BASE_URL: 'http://localhost:3000',
  WEB_ADMIN_BASE_URL: 'http://localhost:3001',
  WEB_MARKETING_BASE_URL: 'http://localhost:3002',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'app-local',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key',
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'no-reply@app.local',
};

const withoutKey = (key: keyof typeof VALID_SOURCE) =>
  Object.fromEntries(
    Object.entries(VALID_SOURCE).filter(([name]) => name !== key),
  );

const stubEnv = (source: Record<string, string>) =>
  Object.entries(source).forEach(([key, value]) => vi.stubEnv(key, value));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('parseEnv', () => {
  it('parses the required variables and applies defaults', () => {
    const env = parseEnv(VALID_SOURCE);

    expect(env.DATABASE_URL).toBe(VALID_SOURCE.DATABASE_URL);
    expect(env.S3_BUCKET).toBe('app-local');
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
  });

  it('defaults DEFAULT_LOCALE to pt-BR', () => {
    expect(parseEnv(VALID_SOURCE).DEFAULT_LOCALE).toBe('pt-BR');
  });

  it('defaults SUPPORTED_LOCALES to pt-BR, en and es', () => {
    expect(parseEnv(VALID_SOURCE).SUPPORTED_LOCALES).toEqual([
      'pt-BR',
      'en',
      'es',
    ]);
  });

  it('accepts the absence of the optional future-phase variables', () => {
    const env = parseEnv(VALID_SOURCE);

    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('fails identifying DATABASE_URL when it is missing', () => {
    expect(() => parseEnv(withoutKey('DATABASE_URL'))).toThrow(/DATABASE_URL/);
  });

  it('fails identifying S3_BUCKET when it is missing', () => {
    expect(() => parseEnv(withoutKey('S3_BUCKET'))).toThrow(/S3_BUCKET/);
  });

  it('fails identifying REDIS_URL when it has an invalid format', () => {
    expect(() => parseEnv({ ...VALID_SOURCE, REDIS_URL: 'not-a-url' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('fails identifying EMAIL_FROM when it is not an e-mail', () => {
    expect(() => parseEnv({ ...VALID_SOURCE, EMAIL_FROM: 'no-reply' })).toThrow(
      /EMAIL_FROM/,
    );
  });

  it('fails when a locale outside the catalogs is supported', () => {
    expect(() =>
      parseEnv({ ...VALID_SOURCE, SUPPORTED_LOCALES: 'pt-BR,fr' }),
    ).toThrow(/SUPPORTED_LOCALES/);
  });
});

describe('env', () => {
  it('exposes the parsed process.env on import', async () => {
    stubEnv(VALID_SOURCE);

    const { env } = await import('./env.js');

    expect(env.API_BASE_URL).toBe(VALID_SOURCE.API_BASE_URL);
  });

  it('fails the boot on import when a required variable is missing', async () => {
    stubEnv({ ...VALID_SOURCE, S3_BUCKET: '' });

    await expect(import('./env.js')).rejects.toThrow(/S3_BUCKET/);
  });
});
