import { resolve } from 'node:path';

import boundaries from 'eslint-plugin-boundaries';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

const monorepoRoot = resolve(import.meta.dirname, '../..');

/**
 * Lint rules shared by every HYPOMNA workspace (PRD §7): import ordering,
 * no `else` after `return` and the layer boundaries plugin. The boundaries
 * elements are deliberately coarse (apps × packages); fine-grained policies
 * belong to the architecture spec.
 *
 * Parser-agnostic on purpose, so it can sit on top of eslint-config-next.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      boundaries,
    },
    settings: {
      'boundaries/root-path': monorepoRoot,
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*', capture: ['app'] },
        { type: 'package', pattern: 'packages/*', capture: ['package'] },
      ],
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
    },
  },
];
