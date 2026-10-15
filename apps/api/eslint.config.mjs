import { config } from '@hypomna/eslint-config/base';
import globals from 'globals';

export default [
  ...config,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'src/generated/**'],
  },
];
