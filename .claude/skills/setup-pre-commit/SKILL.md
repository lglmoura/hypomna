---
name: setup-pre-commit
description: Set up Husky pre-commit hooks with ESLint, lint-staged (Prettier), type checking, and tests in the current repo. Use when user wants to add pre-commit hooks, set up Husky, install or configure ESLint, configure lint-staged, or add commit-time linting/formatting/typechecking/testing.
---

# Setup Pre-Commit Hooks

## What This Sets Up

- **ESLint** (flat config) with TypeScript support and Prettier interop
- **Husky** pre-commit hook
- **lint-staged** running ESLint + Prettier on staged files
- **Prettier** config (if missing)
- **type-check** (`check-types`/`typecheck`, whichever the repo already has) and **test** scripts in the pre-commit hook

## Steps

### 1. Detect package manager

Check for `package-lock.json` (npm), `pnpm-lock.yaml` (pnpm), `yarn.lock` (yarn), `bun.lockb` (bun). Use whichever is present. Default to pnpm if unclear.

Use that manager's own exec form for every command below (`pnpm exec <cmd>` / `pnpm dlx <cmd>`, `npx <cmd>`, `yarn <cmd>`, `bunx <cmd>`) instead of hardcoding `npx` — in a pnpm repo, prefer `pnpm exec`/`pnpm dlx` so tooling stays on the single package manager the project has standardized on.

### 2. Detect existing setup

Before installing anything, inspect the repo so the setup stays idempotent:

- Existing ESLint config: `eslint.config.{js,mjs,cjs,ts}`, `.eslintrc*`, or an `eslintConfig` key in `package.json`.
- Framework presets already in use (e.g. `eslint-config-next` in a Next.js app, `@nestjs` ESLint setup, or a shared `packages/eslint-config` in a monorepo).
- Whether the repo is a monorepo (`pnpm-workspace.yaml`, `turbo.json`, `workspaces` in `package.json`).

**Never overwrite an existing ESLint config.** If one exists, keep it and only add what is missing (Prettier interop, `lint` script, lint-staged wiring). In a monorepo, configure Husky/lint-staged at the root and let each app keep its own ESLint config.

### 3. Install dependencies

Install as devDependencies at the repo root (root of the workspace in a monorepo, `-w` / `--workspace-root` as needed):

```
husky lint-staged prettier eslint @eslint/js typescript-eslint eslint-config-prettier eslint-plugin-simple-import-sort globals
```

Skip `typescript-eslint` if the repo has no TypeScript. Skip packages that are already installed.

### 4. Initialize Husky

```bash
pnpm exec husky init
```

(use the detected package manager's exec form — `npx husky init`, `yarn husky init`, `bunx husky init` — if not pnpm)

This creates `.husky/` dir and adds `prepare: "husky"` to package.json.

### 5. Create `eslint.config.mjs` (only if no ESLint config exists)

ESLint v9 flat config. `eslint-config-prettier` goes **last** so it disables formatting rules that would fight Prettier:

```js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.next/**', '**/.turbo/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  prettier,
);
```

**Adapt**: drop the `tseslint` pieces (and the import) for a JavaScript-only repo. If the repo already has a config, instead just make sure `eslint-config-prettier` is applied last there, and add the `simple-import-sort` plugin/rules to it if missing.

### 6. Add a `lint` script

In `package.json` (root), if not already present:

```json
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
```

In a Turbo monorepo, use `"lint": "turbo run lint"` at the root and keep `eslint .` in each app.

### 7. Create `.husky/pre-commit`

Write this file (no shebang needed for Husky v9+):

```
pnpm exec lint-staged
pnpm run check-types
pnpm run test
```

**Adapt**: Replace `pnpm` with the detected package manager's run form. Check `package.json` for the actual type-check script name before writing this line — this repo's monorepo convention (Turbo tasks, every app's `package.json`) is `check-types`, not `typecheck`; use whichever of `check-types` / `typecheck` actually exists, and if neither exists (nor `test`), omit that line and tell the user. Linting is not repeated here — lint-staged already runs ESLint on the staged files.

### 8. Create `.lintstagedrc`

```json
{
  "*.{js,jsx,ts,tsx,mjs,cjs}": ["eslint --fix", "prettier --write"],
  "*": "prettier --ignore-unknown --write"
}
```

Order matters: ESLint autofixes first, then Prettier formats the result.

### 9. Create `.prettierrc` (if missing)

Only create if no Prettier config exists. Use these defaults:

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "es5",
  "semi": true,
  "arrowParens": "always"
}
```

**Adapt**: in a monorepo that already has a root `.prettierrc` from another bootstrap step (e.g. this project's `config-project` skill, which sets `singleQuote: true`, `trailingComma: "all"`, `printWidth: 120`, `bracketSpacing: true`), keep that existing file as-is — it already satisfies "only create if missing" — rather than introducing a second, conflicting style.

### 10. Verify

- [ ] `eslint.config.mjs` (or the pre-existing ESLint config) exists
- [ ] `eslint-config-prettier` is applied last in the ESLint config
- [ ] `lint` script in package.json
- [ ] `.husky/pre-commit` exists and is executable
- [ ] `.lintstagedrc` exists
- [ ] `prepare` script in package.json is `"husky"`
- [ ] `prettier` config exists
- [ ] Run `eslint .` (via the detected package manager's exec form, e.g. `pnpm exec eslint .`) — it should complete (report existing violations, not crash on config errors)
- [ ] Run `lint-staged` (e.g. `pnpm exec lint-staged`) to verify it works

If `eslint .` reports pre-existing violations across the repo, do **not** mass-fix them as part of this setup. Report the count to the user and let them decide.

### 11. Report and wait for the user

**Never commit automatically as part of this setup.** Stage the changed/created files if the user's workflow expects that, then stop and tell them the hooks are ready — list what was added/changed and suggest a commit message (`Add pre-commit hooks (husky + lint-staged + eslint + prettier)`) for them to review. Only commit if the user explicitly asks you to. This matches the project-wide rule already documented in the sibling `config-project` skill ("NUNCA faça commit sem a permissão explícita do usuário") and the general git safety policy: never commit without an explicit, in-conversation request.

## Notes

- Husky v9+ doesn't need shebangs in hook files
- ESLint v9 uses flat config (`eslint.config.mjs`); `.eslintrc*` only works on v8 or with a compat layer
- `eslint-config-prettier` disables rules, it doesn't add any — it must come last
- `prettier --ignore-unknown` skips files Prettier can't parse (images, etc.)
- lint-staged passes explicit file paths to `eslint`, so staged files outside the config's `ignores` are still linted
- The pre-commit runs lint-staged first (fast, staged-only), then the full type-check and tests
