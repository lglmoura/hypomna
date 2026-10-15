import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Config de aceite e API separada da unitaria (vitest.config.ts): roda contra uma instancia real
// do Nest (Supertest), nao contra mocks — PRD §7.1, niveis "Integracao de use case" e "API e
// aceite (BDD)". Os cenarios .feature (pt-BR) ficam em test/features/<modulo>/RF-<nn>.feature,
// com os passos em RF-<nn>.steps.e2e-spec.ts ao lado (casa com o include abaixo). Postgres,
// Redis e MinIO reais via Testcontainers, em banco isolado por execucao (PRD §7.1), nunca o
// docker-compose.yml de desenvolvimento (config-prisma/config-redis).
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: [
      './test/support/postgres-container.global-setup.ts',
      './test/support/redis-container.global-setup.ts',
    ],
    setupFiles: ['./test/support/e2e-env.setup.ts'],
  },
});
