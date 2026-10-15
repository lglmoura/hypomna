import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Runner de testes da PRD §7.1 — mesmo runner de apps/api. Cenarios BDD (.feature, pt-BR) em
// test/features, com os passos em *.steps.test.ts(x) ao lado.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
