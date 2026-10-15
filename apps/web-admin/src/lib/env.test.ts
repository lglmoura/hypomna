import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_VAR = 'NEXT_PUBLIC_API_URL';
const ORIGINAL_VALUE = process.env[ENV_VAR];

afterEach(() => {
  if (ORIGINAL_VALUE === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = ORIGINAL_VALUE;
  }
  vi.resetModules();
});

describe('env', () => {
  it('parses a valid NEXT_PUBLIC_API_URL', async () => {
    process.env[ENV_VAR] = 'https://api.example.com';
    vi.resetModules();

    const { env } = await import('./env');

    expect(env[ENV_VAR]).toBe('https://api.example.com');
  });

  it('throws when NEXT_PUBLIC_API_URL is missing', async () => {
    delete process.env[ENV_VAR];
    vi.resetModules();

    await expect(import('./env')).rejects.toThrow(/Invalid environment variables/);
  });

  it('throws identifying NEXT_PUBLIC_API_URL when it is not a URL', async () => {
    process.env[ENV_VAR] = 'not-a-url';
    vi.resetModules();

    await expect(import('./env')).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });
});
