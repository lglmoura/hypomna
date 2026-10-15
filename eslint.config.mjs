import { config } from '@hypomna/eslint-config/base';
import globals from 'globals';

export default [
  {
    ignores: ['apps/**', '.claude/**', '.docs/**', 'openspec/**', '**/node_modules/**', '**/dist/**', '**/coverage/**'],
  },
  ...config,
  {
    files: ['scripts/**/*.mjs', 'packages/eslint-config/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
