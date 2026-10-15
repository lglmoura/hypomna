#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSkillConfig, resolveNamespace } from '../../utils/resolve-skill-config.mjs';
import { createSkillRunLogger } from '../../utils/skill-run-log.mjs';
import { createSkillRunOps } from '../../utils/skill-run-ops.mjs';

let activeRunLogger = null;
let activeRunOps = null;

const DEFAULT_PRETTIER_CONFIG = {
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  printWidth: 120,
  arrowParens: 'always',
  bracketSpacing: true,
};

// Mesmo padrao da skill `setup-pre-commit` (ver `../setup-pre-commit/SKILL.md`, passo 8):
// ESLint corrige primeiro, Prettier formata o resultado depois. Antes disso o lint-staged
// so rodava Prettier, deixando o requisito do PRD (docs/PRD.md, secao 7: "ESLint + Prettier
// + simple-import-sort") sem enforcement nenhum no commit, mesmo com ESLint instalado e
// configuravel via `packages/eslint-config` do create-turbo.
const DEFAULT_LINT_STAGED_CONFIG = {
  '*.{js,jsx,ts,tsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*': 'prettier --ignore-unknown --write',
};

// Gates da PRD §7.1: o pre-commit e rapido (so formatacao e lint dos arquivos staged) e as checagens
// pesadas — tipos e testes com cobertura, via Turbo em todos os apps — rodam no pre-push e no CI.
const HUSKY_PRE_COMMIT_CONTENT = ['pnpm exec lint-staged', ''].join('\n');
const HUSKY_PRE_PUSH_CONTENT = ['pnpm run check-types', 'pnpm run test:cov', ''].join('\n');

// Baseline de TypeScript exigido pela skill em todos os apps do monorepo.
const TYPESCRIPT_BASELINE = {
  $schema: 'https://json.schemastore.org/tsconfig',
  compilerOptions: {
    module: 'nodenext',
    moduleResolution: 'nodenext',
    target: 'es2024',
    skipLibCheck: true,
    strict: true,
    outDir: './dist',
  },
  include: ['src'],
};

// Opcoes do baseline aplicaveis apenas a apps Node (backend): apps com bundler proprio
// (Next.js nos apps web) resolvem modulos por conta propria e nao emitem
// para `outDir`, entao nesses apps a skill aplica somente o subconjunto compativel
// (`target`, `skipLibCheck`, `strict`).
const TYPESCRIPT_BASELINE_NODE_ONLY_OPTIONS = ['module', 'moduleResolution', 'outDir'];

// Flags da familia `strict` que, quando declaradas como `false`, anulam o `strict: true`
// do baseline; a skill remove essas negacoes para que o modo estrito valha de fato.
const TYPESCRIPT_STRICT_FAMILY_OPTIONS = [
  'alwaysStrict',
  'noImplicitAny',
  'noImplicitThis',
  'strictBindCallApply',
  'strictBuiltinIteratorReturn',
  'strictFunctionTypes',
  'strictNullChecks',
  'strictPropertyInitialization',
  'useUnknownInCatchVariables',
];

// Zod e instalado em todos os apps (web e backend) sempre na major 4.
const ZOD_DEPENDENCY_NAME = 'zod';
const ZOD_DEPENDENCY_SPEC = 'zod@^4';

// Caminhos (relativos ao app) dos modulos gerados pela skill.
const CLIENT_ENV_MODULE_RELATIVE_PATH = 'src/lib/env.ts';
const BACKEND_ENV_MODULE_RELATIVE_PATH = 'src/config/env.ts';
const BACKEND_ZOD_PIPE_RELATIVE_PATH = 'src/common/pipes/zod-validation.pipe.ts';
const BACKEND_ENV_MODULE_IMPORT = "import './config/env.js';";

// Ferramental de testes — definido na PRD §7.1 (Estrategia de Testes, SDD + TDD + BDD):
// Vitest em apps/api e nos apps Next (mesmo runner, TS/ESM nativo, substitui o Jest que o
// `nest new` instala por padrao). Coverage via provider v8 em todos. Cenarios BDD em pt-BR
// com `@amiceli/vitest-cucumber` em apps/api e nos apps Next (ver ensureBddDependency).
const API_TEST_DEPENDENCIES = [
  'vitest',
  '@vitest/coverage-v8',
  'unplugin-swc',
  '@swc/core',
  'supertest',
  '@types/supertest',
];
const WEB_TEST_DEPENDENCIES = [
  'vitest',
  '@vitest/coverage-v8',
  '@vitejs/plugin-react',
  'jsdom',
  '@testing-library/react',
  '@testing-library/jest-dom',
  '@testing-library/user-event',
];

// Dependencias do scaffold padrao de testes do `nest new` (Jest), removidas quando presentes
// para nao conviver com o Vitest instalado por esta skill (runner definido na PRD §7.1).
const API_JEST_DEPENDENCIES_TO_REMOVE = ['jest', 'ts-jest', '@types/jest', 'jest-mock'];

const VITEST_CONFIG_RELATIVE_PATH = 'vitest.config.ts';
const VITEST_SETUP_RELATIVE_PATH = 'vitest.setup.ts';
const API_VITEST_E2E_CONFIG_RELATIVE_PATH = 'vitest.e2e.config.ts';
const CLIENT_ENV_TEST_RELATIVE_PATH = 'src/lib/env.test.ts';
const BACKEND_ENV_TEST_RELATIVE_PATH = 'src/config/env.spec.ts';

// Runtime exigido pelo PRD (.docs/PRD.md, §6.1: "Node.js LTS vigente (24.x), TypeScript
// strict, ESM"). Fixado via `engines.node` no package.json raiz + `engine-strict=true` no
// `.npmrc` raiz (pnpm falha o install se a versao do Node nao bater), nao apenas
// documentado — ver `patchRootPackageJson` e `ensureRootNpmrcEngineStrict`.
const REQUIRED_NODE_ENGINE_RANGE = '>=24';
const NPMRC_ENGINE_STRICT_LINE = 'engine-strict=true';

// Pacotes internos do PRD §6.1, criados como esqueleto (sem build proprio, exports mapeados
// direto para `.ts`, mesma convencao do `packages/ui` do create-turbo). A skill so cria o
// esqueleto: o conteudo de cada pacote nasce das specs de feature aprovadas (SDD, PRD §6.3),
// nunca deste bootstrap. `runtime` decide o tsconfig: `node` estende o base (nodenext, porque
// `apps/api` consome o pacote) e `react` estende o react-library (consumido so pelos apps Next).
const INTERNAL_PACKAGE_INDEX_RELATIVE_PATH = 'src/index.ts';
const INTERNAL_PACKAGES = [
  { name: 'domain', runtime: 'node', dependencies: [], peerDependencies: {} },
  { name: 'contracts', runtime: 'node', dependencies: [ZOD_DEPENDENCY_SPEC], peerDependencies: {} },
  { name: 'i18n', runtime: 'node', dependencies: [], peerDependencies: {} },
  { name: 'test-utils', runtime: 'node', dependencies: [], peerDependencies: {} },
  { name: 'api-client', runtime: 'react', dependencies: [], peerDependencies: { react: '*' } },
  { name: 'ui', runtime: 'react', dependencies: [], peerDependencies: { react: '*', 'react-dom': '*' } },
];

function buildClientEnvModule({ apiUrlEnvVar }) {
  return `import { z } from 'zod';

const envSchema = z.object({
  ${apiUrlEnvVar}: z.url(),
});

export type Env = z.infer<typeof envSchema>;

// Next.js substitui as variaveis NEXT_PUBLIC_* em tempo de build, entao cada chave precisa ser referenciada explicitamente para
// continuar disponivel no client/app.
const parsed = envSchema.safeParse({
  ${apiUrlEnvVar}: process.env.${apiUrlEnvVar},
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => \`\${issue.path.join('.') || '(root)'}: \${issue.message}\`).join('\\n');

  throw new Error(\`Invalid environment variables:\\n\${issues}\`);
}

export const env: Env = parsed.data;
`;
}

function buildBackendEnvModule({ portEnvVar, port }) {
  return `import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ${portEnvVar}: z.coerce.number().int().positive().default(${port}),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => \`\${issue.path.join('.') || '(root)'}: \${issue.message}\`).join('\\n');

  throw new Error(\`Invalid environment variables:\\n\${issues}\`);
}

export const env: Env = parsed.data;
`;
}

function buildBackendZodPipe() {
  return `// Reexporta o ZodValidationPipe de \`nestjs-zod\` para manter o caminho de import
// ja convencionado neste backend (\`src/common/pipes/zod-validation.pipe.ts\`).
// Uso: \`@UsePipes(new ZodValidationPipe(createUserSchema))\` ou \`app.useGlobalPipes(new ZodValidationPipe())\`
// com DTOs criados via \`createZodDto\` de \`nestjs-zod\`.
export { ZodValidationPipe } from 'nestjs-zod';
`;
}

// Testes reais (nao placeholder) para os modulos de env ja gerados pelo passo Zod desta
// mesma skill — cobrem a regra do PRD §7 ("todas validadas por schema Zod na inicializacao;
// ausencia falha o boot") via reimport dinamico do modulo apos alterar
// `process.env`, ja que o schema lanca no import (nao ha `envSchema` exportado para testar
// isoladamente).

function buildClientEnvVitestModule({ apiUrlEnvVar }) {
  return `import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_VAR = '${apiUrlEnvVar}';
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
  it('parses a valid ${apiUrlEnvVar}', async () => {
    process.env[ENV_VAR] = 'https://api.example.com';
    vi.resetModules();

    const { env } = await import('./env');

    expect(env[ENV_VAR]).toBe('https://api.example.com');
  });

  it('throws when ${apiUrlEnvVar} is missing', async () => {
    delete process.env[ENV_VAR];
    vi.resetModules();

    await expect(import('./env')).rejects.toThrow(/Invalid environment variables/);
  });
});
`;
}

function buildBackendEnvTestModule() {
  return `import { afterEach, describe, expect, it, vi } from 'vitest';

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'BETTER_AUTH_SECRET'];
const ORIGINAL_VALUES = Object.fromEntries(REQUIRED_ENV_VARS.map((key) => [key, process.env[key]]));

function restoreOriginalEnv() {
  for (const key of REQUIRED_ENV_VARS) {
    const originalValue = ORIGINAL_VALUES[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
}

afterEach(() => {
  restoreOriginalEnv();
  vi.resetModules();
});

describe('env', () => {
  it('parses valid required variables and applies defaults', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    process.env.BETTER_AUTH_SECRET = 'a-secret-with-enough-length';
    vi.resetModules();

    const { env } = await import('./env.js');

    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/app');
    expect(env.BETTER_AUTH_SECRET).toBe('a-secret-with-enough-length');
  });

  it('throws when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    process.env.BETTER_AUTH_SECRET = 'a-secret-with-enough-length';
    vi.resetModules();

    await expect(import('./env.js')).rejects.toThrow(/Invalid environment variables/);
  });

  it('throws when BETTER_AUTH_SECRET is missing', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/app';
    delete process.env.BETTER_AUTH_SECRET;
    vi.resetModules();

    await expect(import('./env.js')).rejects.toThrow(/Invalid environment variables/);
  });
});
`;
}

function buildApiVitestConfig() {
  return `import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Runner de testes da PRD §7.1 — substitui o Jest que o
// \`nest new\` instala por padrao. O plugin swc fornece o suporte a decorators/metadata
// que o NestJS (e o Prisma/nestjs-zod) exigem e que o esbuild do Vitest nao entende sozinho.
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
    include: ['src/**/*.spec.ts'],
    exclude: ['test/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.module.ts', 'src/**/*.spec.ts'],
    },
  },
});
`;
}

function buildApiVitestE2eConfig() {
  return `import swc from 'unplugin-swc';
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
  },
});
`;
}

function buildWebVitestConfig() {
  return `import react from '@vitejs/plugin-react';
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
`;
}

function buildWebVitestSetup() {
  return `import '@testing-library/jest-dom/vitest';
`;
}

function usage() {
  console.log(`Usage:
  node .claude/skills/config-project/scripts/project-init.mjs [--app <kind>:<path>:<port>[:<auth>]]... [--backend-path apps/api] [--backend-port 4000] [--backend-port-env-var PORT] [--scope @namespace] [--skip-global-nest]

Client apps come from "apps" in .claude/skills/.env/skills.config.json (PRD §1.4/§6.1: web, web-admin,
web-marketing). Passing --app replaces that list; it is repeatable.
  kind  next
  auth  cookie | none (default: cookie)

Examples:
  node .claude/skills/config-project/scripts/project-init.mjs
  node .claude/skills/config-project/scripts/project-init.mjs --backend-path services/backend
  node .claude/skills/config-project/scripts/project-init.mjs --app next:apps/web:3100:cookie --app next:apps/web-marketing:3102:none
  node .claude/skills/config-project/scripts/project-init.mjs --scope @namespace
  node .claude/skills/config-project/scripts/project-init.mjs --skip-global-nest`);
}

function normalizeRelativeDir(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`Invalid value for --${fieldName}.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing value for --${fieldName}`);
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error(`Invalid value for --${fieldName}: must be a relative path.`);
  }

  const normalized = path.normalize(trimmed).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid value for --${fieldName}: cannot point outside repository root.`);
  }

  return normalized;
}

function normalizePathLeaf(value, fieldName) {
  const leaf = path.basename(value);
  if (!/^[a-z][a-z0-9-]*$/.test(leaf)) {
    throw new Error(`Invalid value for --${fieldName}: last segment "${leaf}" must match /^[a-z][a-z0-9-]*$/.`);
  }
}

function normalizeProjectPath(value, fieldName) {
  const normalized = normalizeRelativeDir(value, fieldName);
  normalizePathLeaf(normalized, fieldName);
  return normalized;
}

function normalizePort(value, fieldName) {
  if (!value) throw new Error(`Missing value for --${fieldName}`);
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid value for --${fieldName}: "${value}" must be an integer between 1 and 65535.`);
  }

  return parsed;
}

function normalizeEnvVarName(value, fieldName) {
  if (!value) throw new Error(`Missing value for --${fieldName}`);
  const trimmed = value.trim();

  if (!/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid value for --${fieldName}: "${trimmed}" must match /^[A-Z][A-Z0-9_]*$/.`);
  }

  return trimmed;
}

const APP_KINDS = ['next'];
const APP_AUTH_MODES = ['cookie', 'none'];

// --app <kind>:<path>:<port>[:<auth>] — mesmo formato de um item de `apps` em skills.config.json.
function parseAppSpec(value) {
  const [kind, appPath, port, auth] = String(value ?? '').split(':');

  if (!APP_KINDS.includes(kind)) {
    throw new Error(
      `Invalid value for --app: kind "${kind}" must be one of ${APP_KINDS.join(', ')} (expected <kind>:<path>:<port>[:<auth>]).`,
    );
  }

  const normalizedPath = normalizeProjectPath(appPath, 'app');
  const normalizedPort = normalizePort(port, 'app');
  const resolvedAuth = auth ?? 'cookie';
  if (!APP_AUTH_MODES.includes(resolvedAuth)) {
    throw new Error(`Invalid value for --app: auth "${resolvedAuth}" must be one of ${APP_AUTH_MODES.join(', ')}.`);
  }

  return {
    name: path.basename(normalizedPath),
    kind,
    path: normalizedPath,
    port: normalizedPort,
    // Next.js so inlina em build time variaveis NEXT_PUBLIC_*.
    apiUrlEnvVar: 'NEXT_PUBLIC_API_URL',
    auth: resolvedAuth,
  };
}

function parseArgs(argv, defaults) {
  let apps = defaults.apps;
  let backendPath = defaults.backendAppPath ?? 'apps/api';
  let backendPort = defaults.backendPort ?? 4000;
  let backendPortEnvVar = defaults.backendPortEnvVar ?? 'PORT';
  let scope = '';
  let skipGlobalNest = false;
  let customApps = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }

    if (arg === '--skip-global-nest') {
      skipGlobalNest = true;
      continue;
    }

    if (arg === '--app') {
      customApps = customApps ?? [];
      customApps.push(parseAppSpec(argv[i + 1]));
      i += 1;
      continue;
    }

    if (arg === '--backend-path') {
      backendPath = normalizeProjectPath(argv[i + 1], 'backend-path');
      i += 1;
      continue;
    }

    if (arg === '--backend-port') {
      backendPort = normalizePort(argv[i + 1], 'backend-port');
      i += 1;
      continue;
    }

    if (arg === '--backend-port-env-var') {
      backendPortEnvVar = normalizeEnvVarName(argv[i + 1], 'backend-port-env-var');
      i += 1;
      continue;
    }

    if (arg === '--scope') {
      const value = argv[i + 1];
      if (!value) throw new Error('Missing value for --scope');
      scope = value;
      i += 1;
      continue;
    }

    throw new Error(
      `Unknown option: ${arg}. Client apps are defined by "apps" in skills.config.json or by --app <kind>:<path>:<port>.`,
    );
  }

  if (customApps) {
    apps = customApps;
  }

  const seenPaths = new Set([backendPath]);
  const seenPorts = new Set();
  for (const app of apps) {
    if (seenPaths.has(app.path)) {
      throw new Error(`App paths must all be different (and different from the backend): ${app.path}`);
    }
    if (seenPorts.has(app.port)) {
      throw new Error(`App ports must all be different: ${app.port} (${app.path})`);
    }
    seenPaths.add(app.path);
    seenPorts.add(app.port);
  }

  return {
    apps,
    backendPath,
    backendPort,
    backendPortEnvVar,
    scope,
    skipGlobalNest,
  };
}

function runCommand(cmd, args, cwd) {
  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }

  return activeRunOps.runCommand(cmd, args, cwd);
}

function commandExists(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  if (!activeRunOps) {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return;
  }

  await activeRunOps.writeJsonFile(filePath, data, {
    note: path.basename(filePath),
    markRiskOnOverwrite: true,
  });
}

function ensureArrayValue(arr, value) {
  if (!Array.isArray(arr)) return [value];
  return arr.includes(value) ? arr : [...arr, value];
}

function ensureWorkspacePatterns(workspaces) {
  if (Array.isArray(workspaces)) {
    return ensureArrayValue(
      ensureArrayValue(ensureArrayValue(ensureArrayValue(workspaces, 'apps/*'), 'modules/*'), 'packages/*'),
      'packages/config/*',
    );
  }

  if (workspaces && typeof workspaces === 'object' && Array.isArray(workspaces.packages)) {
    return {
      ...workspaces,
      packages: ensureArrayValue(
        ensureArrayValue(ensureArrayValue(ensureArrayValue(workspaces.packages, 'apps/*'), 'modules/*'), 'packages/*'),
        'packages/config/*',
      ),
    };
  }

  return ['apps/*', 'modules/*', 'packages/*', 'packages/config/*'];
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function mergeTreeWithoutOverwrite(srcPath, destPath, relativePath = '') {
  const copied = [];
  const skipped = [];
  const sourceStat = await fs.stat(srcPath);
  const destinationExists = await pathExists(destPath);

  if (!destinationExists) {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.cp(srcPath, destPath, { recursive: sourceStat.isDirectory() });
    if (relativePath) copied.push(relativePath);
    return { copied, skipped };
  }

  const destinationStat = await fs.stat(destPath);
  if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
    const entries = await fs.readdir(srcPath);
    for (const entry of entries) {
      if (entry === '.git') continue;
      const childRelativePath = relativePath ? path.join(relativePath, entry) : entry;
      const childResult = await mergeTreeWithoutOverwrite(
        path.join(srcPath, entry),
        path.join(destPath, entry),
        childRelativePath,
      );
      copied.push(...childResult.copied);
      skipped.push(...childResult.skipped);
    }
    return { copied, skipped };
  }

  if (relativePath) skipped.push(relativePath);
  return { copied, skipped };
}

const TURBO_TEMPLATE_PATHS_NEVER_COPIED = ['apps', 'packages/ui'];

async function scaffoldTurboStructureWithCreateTurbo(rootDir) {
  const hasRootGit = await pathExists(path.join(rootDir, '.git'));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'config-project-'));
  const tempProjectName = 'turbo-template';
  const tempProjectDir = path.join(tempRoot, tempProjectName);
  const args = ['--yes', 'create-turbo@latest', tempProjectName, '--package-manager', 'pnpm', '--skip-install'];
  if (hasRootGit) {
    args.push('--no-git');
  }

  try {
    await runCommand('npx', args, tempRoot);

    // No Hypomna `apps/web` (Trader) e `packages/ui` (design system) fazem parte da topologia do
    // PRD §6.1, com os mesmos nomes dos projetos de exemplo do create-turbo. Copiar o exemplo e
    // apaga-lo depois e' o caminho que ja destruiu um app real (incidente de 2026-09-04); por isso
    // os exemplos nunca saem do diretorio temporario e os apps reais nascem do create-next-app.
    for (const templateOnlyPath of TURBO_TEMPLATE_PATHS_NEVER_COPIED) {
      await fs.rm(path.join(tempProjectDir, templateOnlyPath), { recursive: true, force: true });
    }

    const mergeResult = await mergeTreeWithoutOverwrite(tempProjectDir, rootDir);
    return {
      hasRootGit,
      copiedPaths: mergeResult.copied,
      skippedPaths: mergeResult.skipped,
    };
  } finally {
    if (activeRunOps) {
      await activeRunOps.removePath(tempRoot, {
        recursive: true,
        force: true,
        markRisk: false,
        note: 'cleanup temp scaffold',
      });
    } else {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function ensureTurboRoot(rootDir, scope) {
  const packagePath = path.join(rootDir, 'package.json');
  const turboPath = path.join(rootDir, 'turbo.json');
  const repoName = `${scope || '@namespace'}/workspace`;
  const requiredTurboPaths = [
    '.gitignore',
    // Nome real do arquivo que o create-turbo gera para pnpm (era ".pnpmrc" antes desta
    // correcao — como esse arquivo nunca existia, `missingTurboPaths` sempre o incluia e
    // `shouldScaffoldFromTurbo` ficava permanentemente `true`, disparando `npx
    // create-turbo@latest` a cada execucao mesmo com o monorepo ja bootstrapado).
    '.npmrc',
    'packages/eslint-config/package.json',
    'packages/typescript-config/package.json',
  ];
  const missingTurboPaths = [];
  for (const relativePath of requiredTurboPaths) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      missingTurboPaths.push(relativePath);
    }
  }
  const turboPathExists = await pathExists(turboPath);
  const shouldScaffoldFromTurbo = !turboPathExists || missingTurboPaths.length > 0;
  let scaffoldResult = null;
  if (shouldScaffoldFromTurbo) {
    scaffoldResult = await scaffoldTurboStructureWithCreateTurbo(rootDir);
  }

  let rootPkg = {};
  let pkgExists = false;
  if (await pathExists(packagePath)) {
    rootPkg = await readJson(packagePath);
    pkgExists = true;
  }

  const nextPkg = {
    ...rootPkg,
    name: typeof rootPkg.name === 'string' && rootPkg.name.trim() ? rootPkg.name : repoName,
    private: true,
    scripts: {
      ...(rootPkg.scripts ?? {}),
    },
    workspaces: ensureWorkspacePatterns(rootPkg.workspaces),
  };
  nextPkg.scripts.dev = nextPkg.scripts.dev ?? 'turbo run dev';
  nextPkg.scripts.build = nextPkg.scripts.build ?? 'turbo run build';
  nextPkg.scripts.lint = nextPkg.scripts.lint ?? 'turbo run lint';
  nextPkg.scripts.test = 'turbo run test';
  nextPkg.scripts['test:cov'] = 'turbo run test:cov';
  nextPkg.packageManager = nextPkg.packageManager ?? 'pnpm@latest';

  const turboExists = await pathExists(turboPath);
  if (!turboExists) {
    await writeJson(turboPath, {
      $schema: 'https://turbo.build/schema.json',
      tasks: {
        build: {
          dependsOn: ['^build'],
          outputs: ['.next/**', 'dist/**'],
        },
        lint: {
          dependsOn: ['^lint'],
        },
        test: {
          dependsOn: ['^test'],
          cache: false,
        },
        'test:cov': {
          cache: false,
          outputs: ['coverage/**'],
        },
        dev: {
          cache: false,
          persistent: true,
        },
      },
    });
  }

  const pkgChanged = JSON.stringify(rootPkg) !== JSON.stringify(nextPkg);
  if (!pkgExists || pkgChanged) {
    await writeJson(packagePath, nextPkg);
  }

  return {
    createdTurbo: !turboExists,
    createdPackageJson: !pkgExists,
    scaffoldedWithCreateTurbo: shouldScaffoldFromTurbo,
    missingTurboPathsBefore: missingTurboPaths,
    copiedScaffoldPaths: scaffoldResult ? scaffoldResult.copiedPaths : [],
    skippedScaffoldPaths: scaffoldResult ? scaffoldResult.skippedPaths : [],
  };
}

function hasDependency(pkg, depName) {
  const groups = [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies];

  return groups.some((group) => group && typeof group === 'object' && depName in group);
}

async function ensureDependency({ packageJsonPath, depName, installCommand, installArgs, cwd }) {
  if (!(await pathExists(packageJsonPath))) {
    throw new Error(`Missing package.json: ${packageJsonPath}`);
  }

  const pkg = await readJson(packageJsonPath);
  if (hasDependency(pkg, depName)) {
    return false;
  }

  console.log(`Installing dependency "${depName}" in ${cwd}...`);
  await runCommand(installCommand, installArgs, cwd);
  return true;
}

// Variante de `ensureDependency` para varias dependencias de uma vez (um unico `pnpm add`),
// usada pelo passo de ferramental de testes (Vitest/Jest, runner definido na PRD §7.1) para nao disparar uma
// instalacao separada por pacote.
async function ensureDevDependencies({ packageJsonPath, depNames, cwd }) {
  if (!(await pathExists(packageJsonPath))) {
    return { installedNames: [], skipped: true, reason: 'package.json ausente' };
  }

  const pkg = await readJson(packageJsonPath);
  const missing = depNames.filter((depName) => !hasDependency(pkg, depName));

  if (missing.length === 0) {
    return { installedNames: [], skipped: false };
  }

  console.log(`Installing dependencies [${missing.join(', ')}] in ${cwd}...`);
  await runCommand('pnpm', ['add', '-D', ...missing], cwd);
  return { installedNames: missing, skipped: false };
}

// `@amiceli/vitest-cucumber` (BDD executavel, PRD §7.1) declara `vitest` como peerDependency com a
// major exata: a 7.x pede vitest ^4 e a 8.x pede vitest ^5. Por isso a versao e escolhida pela major
// do vitest que o app ja tem (instalado antes, por ensureDevDependencies) — `pnpm add` sem versao
// pegaria a 8.x e quebraria um app que ficou no Vitest 4.
const BDD_DEPENDENCY = '@amiceli/vitest-cucumber';

function resolveBddSpec(vitestRange) {
  const major = Number(/(\d+)/.exec(vitestRange ?? '')?.[1]);
  return major === 4 ? `${BDD_DEPENDENCY}@^7` : `${BDD_DEPENDENCY}@^8`;
}

async function ensureBddDependency({ packageJsonPath, cwd }) {
  if (!(await pathExists(packageJsonPath))) {
    return { installedNames: [], skipped: true, reason: 'package.json ausente' };
  }

  const pkg = await readJson(packageJsonPath);
  if (hasDependency(pkg, BDD_DEPENDENCY)) {
    return { installedNames: [], skipped: false };
  }

  const spec = resolveBddSpec(pkg.devDependencies?.vitest ?? pkg.dependencies?.vitest);
  console.log(`Installing dependency "${spec}" in ${cwd}...`);
  await runCommand('pnpm', ['add', '-D', spec], cwd);
  return { installedNames: [spec], skipped: false };
}

// Remove dependencias de testes conflitantes (ex.: Jest gerado por padrao pelo `nest new`,
// substituido por Vitest — PRD §7.1). Nao-fatal: uma falha aqui e reportada e ignorada, pois
// nao compromete o Vitest ja instalado/configurado pelo restante do passo.
async function ensureDependenciesRemoved({ packageJsonPath, depNames, cwd }) {
  if (!(await pathExists(packageJsonPath))) {
    return { removedNames: [], skipped: true, reason: 'package.json ausente' };
  }

  const pkg = await readJson(packageJsonPath);
  const present = depNames.filter((depName) => hasDependency(pkg, depName));

  if (present.length === 0) {
    return { removedNames: [], skipped: false };
  }

  console.log(`Removing dependencies [${present.join(', ')}] in ${cwd}...`);
  try {
    await runCommand('pnpm', ['remove', ...present], cwd);
    return { removedNames: present, skipped: false };
  } catch (error) {
    console.warn(`Failed to remove dependencies [${present.join(', ')}] in ${cwd}: ${error.message}`);
    return { removedNames: [], skipped: false, failed: true, reason: error.message };
  }
}

async function readPackageName(packageJsonPath) {
  if (!(await pathExists(packageJsonPath))) return '';
  const pkg = await readJson(packageJsonPath);
  return typeof pkg.name === 'string' ? pkg.name : '';
}

async function ensurePackageName(packageJsonPath, expectedName) {
  if (!(await pathExists(packageJsonPath))) {
    return false;
  }

  const pkg = await readJson(packageJsonPath);
  if (pkg.name === expectedName) {
    return false;
  }

  pkg.name = expectedName;
  await writeJson(packageJsonPath, pkg);
  return true;
}

function buildScopedPackageName(scope, packageName) {
  if (typeof packageName === 'string' && packageName.includes('/')) {
    const [, leaf = ''] = packageName.split('/');
    if (leaf) return `${scope}/${leaf}`;
  }
  return `${scope}/${packageName}`;
}

function rewriteMappedDependencyGroup(group, renameMap) {
  if (!group || typeof group !== 'object') return { changed: false, value: group };
  let changed = false;
  const next = {};

  for (const [depName, depVersion] of Object.entries(group)) {
    const mappedName = renameMap.get(depName) ?? depName;
    if (mappedName !== depName) changed = true;
    next[mappedName] = depVersion;
  }

  return { changed, value: next };
}

async function listWorkspacePackageJsonPaths(rootDir) {
  const roots = ['apps', 'modules', 'packages'];
  const results = [];

  for (const root of roots) {
    const rootPath = path.join(rootDir, root);
    if (!(await pathExists(rootPath))) continue;

    const topLevel = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of topLevel) {
      if (!entry.isDirectory()) continue;
      const packageJsonPath = path.join(rootPath, entry.name, 'package.json');
      if (await pathExists(packageJsonPath)) {
        results.push(packageJsonPath);
      }
    }
  }

  return results;
}

// pnpm 11 bloqueia postinstall de dependencia nao aprovada e aborta o install com
// ERR_PNPM_IGNORED_BUILDS, gravando no pnpm-workspace.yaml entradas com o texto literal
// "set this to true or false" para o humano resolver. Num bootstrap automatizado isso trava
// o fluxo: esta funcao pre-aprova os pacotes com build nativo desta stack e resolve qualquer
// placeholder pendente para `true`.
const WORKSPACE_ALLOWED_BUILD_PACKAGES = [
  '@swc/core',
  '@parcel/watcher',
  '@nestjs/core',
  '@sentry/cli',
  'esbuild',
  'sharp',
  'unrs-resolver',
  'bufferutil',
  'utf-8-validate',
  'fsevents',
  'protobufjs',
  // Trazidos pelas skills seguintes (config-prisma: prisma; config-redis: bullmq -> msgpackr-extract).
  'prisma',
  '@prisma/engines',
  'msgpackr-extract',
];

function quoteYamlKey(name) {
  return /^[a-z][a-z0-9-]*$/i.test(name) ? name : `'${name}'`;
}

async function ensureWorkspaceAllowedBuilds({ rootDir }) {
  const workspacePath = path.join(rootDir, 'pnpm-workspace.yaml');
  if (!(await pathExists(workspacePath))) return { updated: false, added: [], resolvedPlaceholders: 0 };

  const original = await fs.readFile(workspacePath, 'utf8');
  let content = original;

  // 1) Placeholders deixados pelo pnpm viram `true`.
  const placeholderPattern = /^(\s*)(.+?):\s*set this to true or false\s*$/gm;
  const resolvedPlaceholders = (content.match(placeholderPattern) || []).length;
  content = content.replace(placeholderPattern, '$1$2: true');

  // 2) Garante o bloco allowBuilds com os pacotes conhecidos desta stack.
  const missing = WORKSPACE_ALLOWED_BUILD_PACKAGES.filter(
    (name) => !new RegExp(`^\\s*'?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?\\s*:`, 'm').test(content),
  );

  if (missing.length > 0) {
    const entries = missing.map((name) => `  ${quoteYamlKey(name)}: true`).join('\n');
    if (/^allowBuilds:\s*$/m.test(content)) {
      content = content.replace(/^allowBuilds:\s*$/m, `allowBuilds:\n${entries}`);
    } else {
      content = `${content.replace(/\n*$/, '')}\nallowBuilds:\n${entries}\n`;
    }
  }

  if (content === original) {
    return { updated: false, added: [], resolvedPlaceholders: 0 };
  }

  await activeRunOps.writeTextFile(workspacePath, content, {
    note: 'pnpm-workspace.yaml (allowBuilds)',
    markRiskOnOverwrite: true,
  });

  return { updated: true, added: missing, resolvedPlaceholders };
}

async function applyNamespaceToWorkspacePackages({ rootDir, scope }) {
  const packageJsonPaths = await listWorkspacePackageJsonPaths(rootDir);
  const packageFiles = [];
  const renameMap = new Map();

  for (const packageJsonPath of packageJsonPaths) {
    const pkg = await readJson(packageJsonPath);
    const currentName =
      typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name : path.basename(path.dirname(packageJsonPath));
    const scopedName = buildScopedPackageName(scope, currentName);

    packageFiles.push({
      path: packageJsonPath,
      pkg,
      currentName,
      scopedName,
    });

    renameMap.set(currentName, scopedName);
  }

  const changedPackageNames = [];
  const changedPackageJsonPaths = [];

  for (const packageFile of packageFiles) {
    const { path: packageJsonPath, pkg, currentName, scopedName } = packageFile;
    let changed = false;

    if (pkg.name !== scopedName) {
      pkg.name = scopedName;
      changed = true;
      changedPackageNames.push(scopedName);
    }

    const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

    for (const groupName of groups) {
      const rewriteResult = rewriteMappedDependencyGroup(pkg[groupName], renameMap);
      if (rewriteResult.changed) {
        pkg[groupName] = rewriteResult.value;
        changed = true;
      }
    }

    if (changed) {
      await writeJson(packageJsonPath, pkg);
      changedPackageJsonPaths.push(packageJsonPath);
    }
  }

  // Renomear so o package.json deixa o workspace inconsistente: o tsconfig do template
  // do Turbo estende "@repo/typescript-config/base.json" e o eslint.config importa
  // "@repo/eslint-config/next" — referencias que continuariam apontando para o escopo
  // antigo e quebrariam check-types/lint depois do rename.
  const changedReferenceFiles = await rewriteWorkspacePackageReferences({ rootDir, renameMap });

  return {
    changedPackageNames,
    changedPackageJsonPaths,
    changedReferenceFiles,
    packageCount: packageFiles.length,
  };
}

// Substitui referencias textuais aos pacotes renomeados (tsconfig "extends", imports de
// config e de codigo). O casamento exige que o nome antigo seja seguido de aspas ou "/",
// para nunca acertar um prefixo de outro pacote.
async function rewriteWorkspacePackageReferences({ rootDir, renameMap }) {
  // SO nomes ja escopados ("@repo/ui" -> "@probe/ui"). Nomes curtos de app ("web", "api",
  // "mobile") NAO entram: substituicao textual deles acerta string comum de codigo — um teste
  // de bootstrap do zero pegou `Platform.OS === 'web'` virando `'@probe/web'` no app mobile.
  // O lado do manifesto desses nomes ja e tratado pela reescrita de dependencias acima.
  const pairs = [...renameMap.entries()].filter(([from, to]) => from !== to && from.startsWith('@'));
  if (pairs.length === 0) return [];

  const IGNORED = new Set(['node_modules', 'dist', '.next', '.expo', 'build', 'coverage', '.turbo', '.git']);
  const EXTENSIONS = new Set(['.json', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const changed = [];

  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name)) continue;
        await walk(entryPath, depth + 1);
        continue;
      }
      if (entry.name === 'package.json') continue;
      if (!EXTENSIONS.has(path.extname(entry.name))) continue;

      let content;
      try {
        content = await fs.readFile(entryPath, 'utf8');
      } catch {
        continue;
      }

      let next = content;
      for (const [from, to] of pairs) {
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        next = next.replace(new RegExp(`${escaped}(?=["'/])`, 'g'), to);
      }

      if (next !== content) {
        await activeRunOps.writeTextFile(entryPath, next, {
          note: `namespace em ${path.relative(rootDir, entryPath)}`,
          markRiskOnOverwrite: true,
        });
        changed.push(entryPath);
      }
    }
  }

  for (const parent of ['apps', 'packages']) {
    for (const dir of await listChildDirectories(path.join(rootDir, parent))) {
      await walk(dir, 0);
    }
  }

  return changed;
}

async function isNestAppDirectory(backendDir) {
  const packageJsonPath = path.join(backendDir, 'package.json');
  const mainPath = path.join(backendDir, 'src', 'main.ts');
  if (!(await pathExists(packageJsonPath))) return false;
  if (!(await pathExists(mainPath))) return false;

  const pkg = await readJson(packageJsonPath);
  return hasDependency(pkg, '@nestjs/core');
}

async function isNextAppDirectory(frontendDir) {
  const packageJsonPath = path.join(frontendDir, 'package.json');
  if (!(await pathExists(packageJsonPath))) return false;
  const pkg = await readJson(packageJsonPath);
  return hasDependency(pkg, 'next');
}

async function isDirectoryEmpty(targetPath) {
  if (!(await pathExists(targetPath))) return true;
  const entries = await fs.readdir(targetPath);
  return entries.length === 0;
}

function hasDependencySuffix(group, suffix) {
  if (!group || typeof group !== 'object') return false;
  return Object.keys(group).some((depName) => depName.endsWith(suffix));
}

function isLikelyTurboDefaultAppPackage(pkg, appLeaf) {
  if (!pkg || typeof pkg !== 'object') return false;
  if (!pkg.scripts || typeof pkg.scripts !== 'object') return false;
  if (!('check-types' in pkg.scripts)) return false;

  const hasUiDependency = hasDependencySuffix(pkg.dependencies, '/ui');
  const hasEslintConfig = hasDependencySuffix(pkg.devDependencies, '/eslint-config');
  const hasTsConfig = hasDependencySuffix(pkg.devDependencies, '/typescript-config');
  if (!hasUiDependency || !hasEslintConfig || !hasTsConfig) return false;

  const name = typeof pkg.name === 'string' ? pkg.name : '';
  return name.endsWith(`/${appLeaf}`) || appLeaf === 'docs' || appLeaf === 'web';
}

function isLikelyTurboDefaultUiPackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  if (!pkg.scripts || typeof pkg.scripts !== 'object') return false;
  if (!pkg.devDependencies || typeof pkg.devDependencies !== 'object') return false;
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object') return false;

  const name = typeof pkg.name === 'string' ? pkg.name : '';
  const hasUiName = name.endsWith('/ui');
  const hasCheckTypesScript = 'check-types' in pkg.scripts;
  const hasGenerateComponentScript =
    typeof pkg.scripts['generate:component'] === 'string' &&
    pkg.scripts['generate:component'].includes('turbo gen react-component');
  const hasReactDeps = 'react' in pkg.dependencies && 'react-dom' in pkg.dependencies;
  const hasEslintConfig = hasDependencySuffix(pkg.devDependencies, '/eslint-config');
  const hasTsConfig = hasDependencySuffix(pkg.devDependencies, '/typescript-config');

  return (
    hasUiName && hasCheckTypesScript && hasGenerateComponentScript && hasReactDeps && hasEslintConfig && hasTsConfig
  );
}

async function removeDefaultTurboApps({ rootDir, nextAppPaths, backendPath }) {
  const candidates = ['apps/docs', 'apps/web'];
  const removed = [];

  for (const candidate of candidates) {
    if (candidate === backendPath) continue;

    const candidateDir = path.join(rootDir, candidate);
    const packageJsonPath = path.join(candidateDir, 'package.json');
    if (!(await pathExists(packageJsonPath))) continue;

    // Guarda de seguranca critica (incidente de 2026-09-04): nunca remover um candidato que
    // ja e uma instancia real e valida do app configurado para este caminho — a heuristica de
    // "template padrao do Turbo" abaixo (nome do pacote + dependencias de config compartilhada)
    // pode combinar falsamente com um app real que apenas reusa os mesmos pacotes
    // compartilhados (`@escopo/eslint-config`, `@escopo/typescript-config`), e um apps/web ja
    // configurado (namespace, Zod, etc.) foi apagado e recriado do zero por causa disso. Este
    // check direto (depende de `next`, o tracinho definidor de um app Next.js real) tem
    // precedencia sobre a heuristica: se o candidato ja e o app real, a heuristica nem roda.
    if (nextAppPaths.includes(candidate) && (await isNextAppDirectory(candidateDir))) continue;

    const pkg = await readJson(packageJsonPath);
    const appLeaf = path.basename(candidate);
    const isDefaultTemplate = isLikelyTurboDefaultAppPackage(pkg, appLeaf);
    if (!isDefaultTemplate) continue;

    if (nextAppPaths.includes(candidate)) {
      console.log(`Removing Turbo default app at ${candidate} before creating configured frontend.`);
    } else {
      console.log(`Removing unused Turbo default app at ${candidate}.`);
    }

    if (!activeRunOps) {
      throw new Error('Run operations are not initialized.');
    }
    await activeRunOps.removePath(candidateDir, {
      recursive: true,
      force: true,
      markRisk: true,
      note: 'remove default turbo app',
    });
    removed.push(candidate);
  }

  return removed;
}

// Lista subdiretorios diretos, tolerando o diretorio pai inexistente (um monorepo pode
// nao ter packages/ ainda quando esta funcao roda).
async function listChildDirectories(parentDir) {
  if (!(await pathExists(parentDir))) return [];
  const entries = await fs.readdir(parentDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(parentDir, entry.name));
}

// Procura, no codigo-fonte de um workspace, imports/requires de algum dos pacotes dados.
// Varre so o que interessa (src/, app/, raiz do app) e ignora node_modules/build.
async function findFilesImporting(workspaceDir, packageNames) {
  const IGNORED = new Set(['node_modules', 'dist', '.next', '.expo', 'build', 'coverage']);
  const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
  const matches = [];

  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(entryPath, depth + 1);
        continue;
      }
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;

      let content;
      try {
        content = await fs.readFile(entryPath, 'utf8');
      } catch {
        continue;
      }
      if (packageNames.some((name) => content.includes(`'${name}`) || content.includes(`"${name}`))) {
        matches.push(entryPath);
      }
    }
  }

  await walk(workspaceDir, 0);
  return matches;
}

// Nomes dos pacotes default do Turbo efetivamente removidos nesta execucao — usados por
// repairRemovedWorkspaceDependencies() para limpar referencias que ficariam penduradas.
const removedDefaultPackageNames = [];

// O guard de seguranca de removeDefaultTurboApps (incidente de 2026-09-04) preserva um
// apps/web que ja e um app Next.js valido — inclusive quando esse apps/web ainda e o do
// template do Turbo, que declara "@repo/ui": "workspace:*". Como packages/ui e removido
// logo abaixo, a dependencia fica apontando para um pacote inexistente e QUALQUER
// "pnpm install" no workspace passa a falhar. Esta funcao fecha essa lacuna sem tocar no
// guard: remove a dependencia orfa dos package.json e avisa sobre imports remanescentes.
async function repairRemovedWorkspaceDependencies({ rootDir, logger }) {
  if (removedDefaultPackageNames.length === 0) return [];

  const repaired = [];
  const workspaceDirs = [
    ...(await listChildDirectories(path.join(rootDir, 'apps'))),
    ...(await listChildDirectories(path.join(rootDir, 'packages'))),
  ];

  for (const dir of workspaceDirs) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (!(await pathExists(packageJsonPath))) continue;

    const pkg = await readJson(packageJsonPath);
    let changed = false;

    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const removedName of removedDefaultPackageNames) {
        if (deps[removedName] === undefined) continue;
        delete deps[removedName];
        changed = true;
      }
    }

    if (!changed) continue;

    await writeJson(packageJsonPath, pkg);
    repaired.push(path.relative(rootDir, packageJsonPath));

    // O import em si nao e' removido automaticamente: apagar JSX por heuristica arriscaria
    // mutilar codigo do usuario. O install volta a funcionar; o import pendente vira aviso.
    const danglingImports = await findFilesImporting(dir, removedDefaultPackageNames);
    if (danglingImports.length > 0) {
      logger.risk(
        `Dependencia orfa ${removedDefaultPackageNames.join(', ')} removida de ${path.relative(rootDir, packageJsonPath)}, mas estes arquivos ainda a importam e precisam de ajuste manual: ${danglingImports
          .map((file) => path.relative(rootDir, file))
          .join(', ')}`,
      );
    }
  }

  return repaired;
}

async function removeDefaultTurboPackages({ rootDir }) {
  const candidate = 'packages/ui';
  const candidateDir = path.join(rootDir, candidate);
  const packageJsonPath = path.join(candidateDir, 'package.json');
  if (!(await pathExists(packageJsonPath))) return [];

  const pkg = await readJson(packageJsonPath);
  if (!isLikelyTurboDefaultUiPackage(pkg)) return [];

  removedDefaultPackageNames.push(pkg.name);
  console.log(`Removing unused Turbo default package at ${candidate}.`);
  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.removePath(candidateDir, {
    recursive: true,
    force: true,
    markRisk: true,
    note: 'remove default turbo package',
  });
  return [candidate];
}

// Ver nota no snapshot `preflightAppState` em main(): aborta alto e claro em vez de deixar o
// script prosseguir para `ensureNextApp`/`ensureBackendApp`, que tratariam a
// ausencia como "app ainda nao existe" e recriariam do zero, destruindo o trabalho anterior.
async function assertAppNotUnexpectedlyLost({ label, wasValidBefore, dir, isValidNowFn }) {
  if (!wasValidBefore) return;

  const stillValid = (await pathExists(dir)) && (await isValidNowFn(dir));
  if (stillValid) return;

  throw new Error(
    `Safety check failed: ${label} was a valid, already-configured app before this run and is no longer detected as one (dir: ${dir}). ` +
      'Aborting before creating/recreating any app to avoid silently destroying existing work. ' +
      'Investigate what removed or corrupted it (check .log/skills.log for [FILE_DELETE]/[RISK] entries from this run) before rerunning this skill.',
  );
}

async function ensureNextApp({ rootDir, appPath, appName, appParentDir, label }) {
  const appDir = path.join(rootDir, appPath);
  const appExists = await pathExists(appDir);
  const isNextApp = appExists && (await isNextAppDirectory(appDir));

  if (isNextApp) {
    return false;
  }

  if (appExists && !(await isDirectoryEmpty(appDir))) {
    throw new Error(`${label} directory already exists and is not a Next.js app: ${appPath}. Refusing to overwrite.`);
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.ensureDir(appParentDir, {
    note: `preparacao de diretorio ${label.toLowerCase()}`,
  });
  console.log(`Creating Next.js app (${label}): ${appName}`);
  await runCommand('npx', ['create-next-app@latest', appName, '--yes', '--use-pnpm', '--src-dir'], appParentDir);
  return true;
}

async function ensureBackendApp({ rootDir, backendPath, backendName, backendParentDir, skipGlobalNest }) {
  const backendDir = path.join(rootDir, backendPath);
  const backendExists = await pathExists(backendDir);
  const isNestApp = backendExists && (await isNestAppDirectory(backendDir));

  if (isNestApp) {
    return false;
  }

  if (backendExists && !(await isDirectoryEmpty(backendDir))) {
    throw new Error(`Backend directory already exists and is not a NestJS app: ${backendPath}. Refusing to overwrite.`);
  }

  if (!skipGlobalNest) {
    const hasNest = await commandExists('nest');
    if (!hasNest) {
      console.log('Installing @nestjs/cli globally...');
      await runCommand('pnpm', ['add', '-g', '@nestjs/cli'], rootDir);
    }
  }

  const nestCreateArgs = ['new', backendName, '--skip-git', '--package-manager', 'pnpm'];

  const hasNestCli = await commandExists('nest');
  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.ensureDir(backendParentDir, {
    note: 'preparacao de diretorio backend',
  });
  if (hasNestCli) {
    console.log(`Creating NestJS app with nest CLI: ${backendName}`);
    await runCommand('nest', nestCreateArgs, backendParentDir);
  } else {
    console.log(`Creating NestJS app with npx: ${backendName}`);
    await runCommand('npx', ['--yes', '@nestjs/cli@latest', ...nestCreateArgs], backendParentDir);
  }

  return true;
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `keepExistingKeys`: chaves cujo valor ja gravado nunca e' trocado (so entram quando ausentes).
// Sem isso, reexecutar a skill devolvia o placeholder ao BETTER_AUTH_SECRET real e desfazia um
// DATABASE_URL ajustado (ex.: a role de aplicacao sem BYPASSRLS da spec RF-00-schema).
function upsertEnvContent(content, entries, keepExistingKeys = []) {
  const lines = content.split(/\r?\n/);
  const outputLines = [...lines];

  for (const [key, value] of Object.entries(entries)) {
    const keyMatcher = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
    const existingIndex = outputLines.findIndex((line) => keyMatcher.test(line));
    const targetLine = `${key}=${value}`;

    if (existingIndex >= 0 && keepExistingKeys.includes(key)) continue;
    if (existingIndex >= 0) {
      outputLines[existingIndex] = targetLine;
    } else {
      outputLines.push(targetLine);
    }
  }

  return `${outputLines.join('\n').replace(/\n+$/g, '')}\n`;
}

async function upsertEnvFile(filePath, entries, keepExistingKeys = []) {
  const previous = (await pathExists(filePath)) ? await fs.readFile(filePath, 'utf8') : '';
  const next = upsertEnvContent(previous, entries, keepExistingKeys);

  if (previous === next) {
    return false;
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.writeTextFile(filePath, next, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: path.basename(filePath),
  });
  return true;
}

// Usuario, senha e banco locais derivados do namespace (`@hypomna` -> `hypomna`), para que o
// docker-compose.yml que a config-prisma gera a partir deste DATABASE_URL ja nasca com o nome do
// projeto. Credencial so de desenvolvimento local.
function buildLocalDatabaseUrl(scope) {
  const name = (scope || '@namespace').replace(/^@/, '').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  return `"postgresql://${name}:${name}@localhost:5432/${name}?schema=public"`;
}

const BACKEND_ENV_KEYS_KEPT_ON_RERUN = ['DATABASE_URL', 'BETTER_AUTH_SECRET'];

async function writeEnvFiles({ rootDir, scope, apps, backendPath, backendPort, backendPortEnvVar }) {
  const backendDir = path.join(rootDir, backendPath);
  const backendEntries = {
    [backendPortEnvVar]: String(backendPort),
    DATABASE_URL: buildLocalDatabaseUrl(scope),
    BETTER_AUTH_SECRET: '"YOUR_SECRET_HERE"',
  };

  const changedFiles = [];

  // Um par .env/.env.example por cliente: URL da API (NEXT_PUBLIC_*) e a porta do dev server do app.
  for (const app of apps) {
    const appEntries = {
      [app.apiUrlEnvVar]: `http://localhost:${backendPort}`,
      PORT: String(app.port),
    };
    const appDir = path.join(rootDir, app.path);

    if (await upsertEnvFile(path.join(appDir, '.env.example'), appEntries)) {
      changedFiles.push(path.join(app.path, '.env.example'));
    }
    if (await upsertEnvFile(path.join(appDir, '.env'), appEntries)) {
      changedFiles.push(path.join(app.path, '.env'));
    }
  }

  if (await upsertEnvFile(path.join(backendDir, '.env.example'), backendEntries, BACKEND_ENV_KEYS_KEPT_ON_RERUN)) {
    changedFiles.push(path.join(backendPath, '.env.example'));
  }
  if (await upsertEnvFile(path.join(backendDir, '.env'), backendEntries, BACKEND_ENV_KEYS_KEPT_ON_RERUN)) {
    changedFiles.push(path.join(backendPath, '.env'));
  }

  return changedFiles;
}

async function patchRootPackageJson(rootDir, scope) {
  const packagePath = path.join(rootDir, 'package.json');
  const pkg = await readJson(packagePath);
  const repoName = `${scope || '@namespace'}/workspace`;

  if (!pkg.name || pkg.name === 'turbo-template') {
    pkg.name = repoName;
  }

  pkg.scripts = pkg.scripts ?? {};
  pkg.scripts.test = 'turbo run test';
  pkg.scripts['test:cov'] = 'turbo run test:cov';
  // Rastreabilidade PRD↔teste (RF-86, PRD §7.1); o script vem de assets/test-trace.mjs (ensureTestTraceScript).
  pkg.scripts['test:trace'] = pkg.scripts['test:trace'] ?? 'node scripts/test-trace.mjs';
  pkg.scripts.format = pkg.scripts.format ?? 'prettier --write "**/*.{ts,tsx,md}"';
  pkg.scripts['check-types'] = pkg.scripts['check-types'] ?? 'turbo run check-types';
  pkg.scripts.prepare = pkg.scripts.prepare ?? 'husky';

  pkg.devDependencies = pkg.devDependencies ?? {};
  if (!pkg.devDependencies['ts-node']) {
    pkg.devDependencies['ts-node'] = '^10.9.2';
  }

  pkg.engines = pkg.engines ?? {};
  if (!pkg.engines.node) {
    pkg.engines.node = REQUIRED_NODE_ENGINE_RANGE;
  }

  await writeJson(packagePath, pkg);
}

async function ensureRootNpmrcEngineStrict(rootDir) {
  const npmrcPath = path.join(rootDir, '.npmrc');
  const npmrcExists = await pathExists(npmrcPath);
  const previousContent = npmrcExists ? await fs.readFile(npmrcPath, 'utf8') : '';

  const alreadyStrict = previousContent.split('\n').some((line) => line.trim() === NPMRC_ENGINE_STRICT_LINE);
  if (alreadyStrict) {
    return { updated: false, created: false };
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }

  const trimmedContent = previousContent.replace(/\n+$/, '');
  const nextContent = trimmedContent
    ? `${trimmedContent}\n${NPMRC_ENGINE_STRICT_LINE}\n`
    : `${NPMRC_ENGINE_STRICT_LINE}\n`;

  await activeRunOps.writeTextFile(npmrcPath, nextContent, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: '.npmrc (engine-strict, PRD §7 Runtime)',
  });

  return { updated: true, created: !npmrcExists };
}

async function ensureRootPrettierConfig(rootDir) {
  const prettierConfigPath = path.join(rootDir, '.prettierrc');
  const expectedContent = `${JSON.stringify(DEFAULT_PRETTIER_CONFIG, null, 2)}\n`;
  const fileExists = await pathExists(prettierConfigPath);
  const previousContent = fileExists ? await fs.readFile(prettierConfigPath, 'utf8') : '';

  if (previousContent === expectedContent) {
    return { updated: false, created: false };
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.writeTextFile(prettierConfigPath, expectedContent, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: '.prettierrc',
  });
  return { updated: true, created: !fileExists };
}

async function patchBackendPackageJson({ rootDir, backendPath }) {
  const packagePath = path.join(rootDir, backendPath, 'package.json');
  if (!(await pathExists(packagePath))) {
    return { updated: false, skipped: true };
  }

  const pkg = await readJson(packagePath);
  const original = JSON.stringify(pkg);

  pkg.scripts = pkg.scripts ?? {};
  if (!pkg.scripts.dev) {
    pkg.scripts.dev = pkg.scripts['start:dev'] ?? 'nest start --watch';
  }
  if (!pkg.scripts['check-types']) {
    pkg.scripts['check-types'] = 'tsc --noEmit -p tsconfig.json';
  }

  const next = JSON.stringify(pkg);
  if (next === original) {
    return { updated: false, skipped: false };
  }

  await writeJson(packagePath, pkg);
  return { updated: true, skipped: false };
}

async function ensureCheckTypesScript({ rootDir, appPath }) {
  const packagePath = path.join(rootDir, appPath, 'package.json');
  if (!(await pathExists(packagePath))) {
    return { updated: false, skipped: true };
  }

  const pkg = await readJson(packagePath);
  pkg.scripts = pkg.scripts ?? {};
  if (pkg.scripts['check-types']) {
    return { updated: false, skipped: false };
  }

  pkg.scripts['check-types'] = 'tsc --noEmit';
  await writeJson(packagePath, pkg);
  return { updated: true, skipped: false };
}

function stripJsonComments(raw) {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 1;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    out += char;
  }

  return out.replace(/,(\s*[}\]])/g, '$1');
}

async function readTsconfig(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(stripJsonComments(raw));
}

function baselineCompilerOptionsFor(kind) {
  return Object.fromEntries(
    Object.entries(TYPESCRIPT_BASELINE.compilerOptions).filter(
      ([key]) => kind === 'node' || !TYPESCRIPT_BASELINE_NODE_ONLY_OPTIONS.includes(key),
    ),
  );
}

async function ensureTypeScriptBaseline({ rootDir, appPath, kind }) {
  const file = `${appPath}/tsconfig.json`;
  const tsconfigPath = path.join(rootDir, appPath, 'tsconfig.json');
  const expectedOptions = baselineCompilerOptionsFor(kind);

  if (!(await pathExists(tsconfigPath))) {
    if (kind !== 'node') {
      return { file, updated: false, created: false, skipped: true, reason: 'tsconfig.json ausente', changes: [] };
    }

    await writeJson(tsconfigPath, JSON.parse(JSON.stringify(TYPESCRIPT_BASELINE)));
    return {
      file,
      updated: true,
      created: true,
      skipped: false,
      changes: Object.keys(expectedOptions),
    };
  }

  let tsconfig;
  try {
    tsconfig = await readTsconfig(tsconfigPath);
  } catch {
    return { file, updated: false, created: false, skipped: true, reason: 'tsconfig.json ilegivel', changes: [] };
  }

  if (!tsconfig || typeof tsconfig !== 'object' || Array.isArray(tsconfig)) {
    return { file, updated: false, created: false, skipped: true, reason: 'tsconfig.json invalido', changes: [] };
  }

  const changes = [];
  tsconfig.compilerOptions = tsconfig.compilerOptions ?? {};

  for (const [key, value] of Object.entries(expectedOptions)) {
    if (tsconfig.compilerOptions[key] !== value) {
      tsconfig.compilerOptions[key] = value;
      changes.push(`compilerOptions.${key}`);
    }
  }

  for (const key of TYPESCRIPT_STRICT_FAMILY_OPTIONS) {
    if (tsconfig.compilerOptions[key] === false) {
      delete tsconfig.compilerOptions[key];
      changes.push(`compilerOptions.${key} (removido)`);
    }
  }

  if (kind === 'node') {
    if (tsconfig.$schema !== TYPESCRIPT_BASELINE.$schema) {
      tsconfig.$schema = TYPESCRIPT_BASELINE.$schema;
      changes.push('$schema');
    }

    for (const entry of TYPESCRIPT_BASELINE.include) {
      const include = ensureArrayValue(tsconfig.include, entry);
      if (include !== tsconfig.include) {
        tsconfig.include = include;
        changes.push(`include:${entry}`);
      }
    }
  }

  if (changes.length === 0) {
    return { file, updated: false, created: false, skipped: false, changes };
  }

  if (kind === 'node') {
    const { $schema, ...rest } = tsconfig;
    tsconfig = { $schema, ...rest };
  }

  await writeJson(tsconfigPath, tsconfig);
  return { file, updated: true, created: false, skipped: false, changes };
}

function runCommandStatus(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function verifyTypeScript({ rootDir }) {
  const exitCode = await runCommandStatus('pnpm', ['run', 'check-types'], rootDir);
  return { ok: exitCode === 0, exitCode };
}

async function ensureGeneratedSourceFile({ rootDir, appPath, relativePath, content, note }) {
  const file = `${appPath}/${relativePath}`;
  const appDir = path.join(rootDir, appPath);

  if (!(await pathExists(appDir))) {
    return { file, created: false, skipped: true, reason: 'app nao encontrado' };
  }

  const filePath = path.join(appDir, relativePath);
  if (await pathExists(filePath)) {
    return { file, created: false, skipped: false };
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }

  await activeRunOps.ensureDir(path.dirname(filePath), { note: `preparacao de diretorio para ${note}` });
  await activeRunOps.writeTextFile(filePath, content, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note,
  });

  return { file, created: true, skipped: false };
}

async function ensureZodDependency({ rootDir, appPath }) {
  const packageJsonPath = path.join(rootDir, appPath, 'package.json');
  if (!(await pathExists(packageJsonPath))) {
    return { installed: false, skipped: true, reason: 'package.json ausente' };
  }

  const installed = await ensureDependency({
    packageJsonPath,
    depName: ZOD_DEPENDENCY_NAME,
    installCommand: 'pnpm',
    installArgs: ['add', ZOD_DEPENDENCY_SPEC],
    cwd: path.join(rootDir, appPath),
  });

  return { installed, skipped: false };
}

async function ensureClientZodSetup({ rootDir, appPath, apiUrlEnvVar }) {
  const dependency = await ensureZodDependency({ rootDir, appPath });
  const envModule = await ensureGeneratedSourceFile({
    rootDir,
    appPath,
    relativePath: CLIENT_ENV_MODULE_RELATIVE_PATH,
    content: buildClientEnvModule({ apiUrlEnvVar }),
    note: `${appPath} env schema (zod)`,
  });

  return { dependency, files: [envModule] };
}

async function ensureNestjsZodDependency({ rootDir, backendPath }) {
  const packageJsonPath = path.join(rootDir, backendPath, 'package.json');
  if (!(await pathExists(packageJsonPath))) {
    return { installed: false, skipped: true, reason: 'package.json ausente' };
  }

  const installed = await ensureDependency({
    packageJsonPath,
    depName: 'nestjs-zod',
    installCommand: 'pnpm',
    installArgs: ['add', 'nestjs-zod'],
    cwd: path.join(rootDir, backendPath),
  });

  return { installed, skipped: false };
}

async function ensureBackendZodSetup({ rootDir, backendPath, backendPortEnvVar, backendPort }) {
  const dependency = await ensureZodDependency({ rootDir, appPath: backendPath });
  await ensureNestjsZodDependency({ rootDir, backendPath });
  const envModule = await ensureGeneratedSourceFile({
    rootDir,
    appPath: backendPath,
    relativePath: BACKEND_ENV_MODULE_RELATIVE_PATH,
    content: buildBackendEnvModule({ portEnvVar: backendPortEnvVar, port: backendPort }),
    note: `${backendPath} env schema (zod)`,
  });
  const validationPipe = await ensureGeneratedSourceFile({
    rootDir,
    appPath: backendPath,
    relativePath: BACKEND_ZOD_PIPE_RELATIVE_PATH,
    content: buildBackendZodPipe(),
    note: `${backendPath} ZodValidationPipe`,
  });

  return { dependency, files: [envModule, validationPipe] };
}

function buildInternalPackageJson(scope, spec) {
  const namespace = scope || '@namespace';
  const pkg = {
    name: `${namespace}/${spec.name}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    main: `./${INTERNAL_PACKAGE_INDEX_RELATIVE_PATH}`,
    types: `./${INTERNAL_PACKAGE_INDEX_RELATIVE_PATH}`,
    exports: {
      '.': `./${INTERNAL_PACKAGE_INDEX_RELATIVE_PATH}`,
    },
    scripts: {
      'check-types': 'tsc --noEmit',
    },
    dependencies: {},
    devDependencies: {},
  };
  if (Object.keys(spec.peerDependencies).length > 0) {
    pkg.peerDependencies = { ...spec.peerDependencies };
  }
  return pkg;
}

function buildInternalPackageTsconfig(scope, spec) {
  const namespace = scope || '@namespace';
  const baseConfig = spec.runtime === 'react' ? 'react-library.json' : 'base.json';
  return {
    $schema: 'https://json.schemastore.org/tsconfig',
    extends: `${namespace}/typescript-config/${baseConfig}`,
    compilerOptions: {
      noEmit: true,
    },
    include: ['src'],
  };
}

// Cria o pacote uma unica vez (skip se ja existir) e so entao instala as dependencias via
// `pnpm add` (nunca escritas direto no JSON), para que lockfile e node_modules do workspace
// fiquem consistentes com o package.json.
async function ensureInternalPackage({ rootDir, scope, spec }) {
  const packagePath = `packages/${spec.name}`;
  const packageDir = path.join(rootDir, packagePath);
  const packageJsonPath = path.join(packageDir, 'package.json');

  if (await pathExists(packageJsonPath)) {
    return { packagePath, created: false, skipped: true, reason: 'pacote ja existe', installedDependencies: [] };
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }

  await activeRunOps.ensureDir(path.join(packageDir, 'src'), {
    note: `preparacao do pacote ${packagePath}`,
  });

  await writeJson(packageJsonPath, buildInternalPackageJson(scope, spec));
  await writeJson(path.join(packageDir, 'tsconfig.json'), buildInternalPackageTsconfig(scope, spec));
  await ensureGeneratedSourceFile({
    rootDir,
    appPath: packagePath,
    relativePath: INTERNAL_PACKAGE_INDEX_RELATIVE_PATH,
    content: 'export {};\n',
    note: `${packagePath} esqueleto`,
  });

  const typescriptConfigDepName = `${scope || '@namespace'}/typescript-config`;
  const dependencySpecs = [
    ...spec.dependencies.map((depSpec) => ({ depSpec, dev: false })),
    { depSpec: 'typescript', dev: true },
    { depSpec: `${typescriptConfigDepName}@workspace:*`, dev: true },
    ...(spec.runtime === 'react' ? [{ depSpec: '@types/react', dev: true }] : []),
  ];

  const installedDependencies = [];
  for (const { depSpec, dev } of dependencySpecs) {
    const depName = depSpec.replace(/(?<=.)@[^@/]*$/, '');
    const installed = await ensureDependency({
      packageJsonPath,
      depName,
      installCommand: 'pnpm',
      installArgs: dev ? ['add', '-D', depSpec] : ['add', depSpec],
      cwd: packageDir,
    });
    if (installed) installedDependencies.push(depName);
  }

  return { packagePath, created: true, skipped: false, installedDependencies };
}

// Alinha (nao apenas complementa) os scripts de teste ao baseline da PRD §7.1 — analogo ao
// que `ensureTypeScriptBaseline` faz com `compilerOptions`: sobrescreve valores previos
// (ex.: os scripts baseados em Jest que o `nest new` gera) porque a mudanca de runner e uma
// decisao de arquitetura explicita, nao um complemento de algo ausente.
async function patchAppTestScripts({ rootDir, appPath, scripts, removeJestBlock = false }) {
  const packagePath = path.join(rootDir, appPath, 'package.json');
  if (!(await pathExists(packagePath))) {
    return { updated: false, skipped: true, changedKeys: [], jestBlockRemoved: false };
  }

  const pkg = await readJson(packagePath);
  pkg.scripts = pkg.scripts ?? {};
  const changedKeys = [];

  for (const [key, value] of Object.entries(scripts)) {
    if (pkg.scripts[key] !== value) {
      pkg.scripts[key] = value;
      changedKeys.push(key);
    }
  }

  let jestBlockRemoved = false;
  if (removeJestBlock && pkg.jest !== undefined) {
    delete pkg.jest;
    jestBlockRemoved = true;
  }

  if (changedKeys.length === 0 && !jestBlockRemoved) {
    return { updated: false, skipped: false, changedKeys: [], jestBlockRemoved: false };
  }

  await writeJson(packagePath, pkg);
  return { updated: true, skipped: false, changedKeys, jestBlockRemoved };
}

async function ensureApiTestTooling({ rootDir, backendPath }) {
  const packageJsonPath = path.join(rootDir, backendPath, 'package.json');
  const cwd = path.join(rootDir, backendPath);

  const dependency = await ensureDevDependencies({ packageJsonPath, depNames: API_TEST_DEPENDENCIES, cwd });
  const bdd = await ensureBddDependency({ packageJsonPath, cwd });
  dependency.installedNames = [...dependency.installedNames, ...bdd.installedNames];
  const removedJest = await ensureDependenciesRemoved({
    packageJsonPath,
    depNames: API_JEST_DEPENDENCIES_TO_REMOVE,
    cwd,
  });

  const vitestConfig = await ensureGeneratedSourceFile({
    rootDir,
    appPath: backendPath,
    relativePath: VITEST_CONFIG_RELATIVE_PATH,
    content: buildApiVitestConfig(),
    note: `${backendPath} vitest config (unitario)`,
  });
  const vitestE2eConfig = await ensureGeneratedSourceFile({
    rootDir,
    appPath: backendPath,
    relativePath: API_VITEST_E2E_CONFIG_RELATIVE_PATH,
    content: buildApiVitestE2eConfig(),
    note: `${backendPath} vitest config (e2e)`,
  });
  const envTest = await ensureGeneratedSourceFile({
    rootDir,
    appPath: backendPath,
    relativePath: BACKEND_ENV_TEST_RELATIVE_PATH,
    content: buildBackendEnvTestModule(),
    note: `${backendPath} teste do schema de env (vitest)`,
  });

  const scriptsResult = await patchAppTestScripts({
    rootDir,
    appPath: backendPath,
    scripts: {
      test: 'vitest run',
      'test:watch': 'vitest',
      'test:cov': 'vitest run --coverage',
      'test:e2e': 'vitest run --config vitest.e2e.config.ts',
    },
    removeJestBlock: true,
  });

  return {
    dependency,
    removedJest,
    files: [vitestConfig, vitestE2eConfig, envTest],
    scriptsResult,
  };
}

async function ensureWebTestTooling({ rootDir, appPath, apiUrlEnvVar }) {
  const packageJsonPath = path.join(rootDir, appPath, 'package.json');
  const cwd = path.join(rootDir, appPath);

  const dependency = await ensureDevDependencies({ packageJsonPath, depNames: WEB_TEST_DEPENDENCIES, cwd });
  const bdd = await ensureBddDependency({ packageJsonPath, cwd });
  dependency.installedNames = [...dependency.installedNames, ...bdd.installedNames];

  const vitestConfig = await ensureGeneratedSourceFile({
    rootDir,
    appPath,
    relativePath: VITEST_CONFIG_RELATIVE_PATH,
    content: buildWebVitestConfig(),
    note: `${appPath} vitest config`,
  });
  const vitestSetup = await ensureGeneratedSourceFile({
    rootDir,
    appPath,
    relativePath: VITEST_SETUP_RELATIVE_PATH,
    content: buildWebVitestSetup(),
    note: `${appPath} vitest setup (@testing-library/jest-dom)`,
  });
  const envTest = await ensureGeneratedSourceFile({
    rootDir,
    appPath,
    relativePath: CLIENT_ENV_TEST_RELATIVE_PATH,
    content: buildClientEnvVitestModule({ apiUrlEnvVar }),
    note: `${appPath} teste do schema de env (vitest)`,
  });

  const scriptsResult = await patchAppTestScripts({
    rootDir,
    appPath,
    scripts: {
      test: 'vitest run',
      'test:watch': 'vitest',
      'test:cov': 'vitest run --coverage',
    },
  });

  return {
    dependency,
    files: [vitestConfig, vitestSetup, envTest],
    scriptsResult,
  };
}

async function patchTurboJson(rootDir) {
  const turboPath = path.join(rootDir, 'turbo.json');
  const turbo = await readJson(turboPath);

  turbo.tasks = turbo.tasks ?? {};
  turbo.tasks.build = turbo.tasks.build ?? {};
  turbo.tasks.build.outputs = ensureArrayValue(turbo.tasks.build.outputs, 'dist/**');

  turbo.tasks.test = {
    ...(turbo.tasks.test ?? {}),
    cache: false,
    outputs: ensureArrayValue(turbo.tasks.test?.outputs, 'coverage/**'),
  };

  // O pre-push (PRD §7.1) roda `pnpm run test:cov`, entao a task precisa existir no Turbo.
  turbo.tasks['test:cov'] = {
    ...(turbo.tasks['test:cov'] ?? {}),
    cache: false,
    outputs: ensureArrayValue(turbo.tasks['test:cov']?.outputs, 'coverage/**'),
  };

  turbo.tasks['check-types'] = {
    ...(turbo.tasks['check-types'] ?? {}),
    dependsOn: ensureArrayValue(turbo.tasks['check-types']?.dependsOn, '^check-types'),
  };

  await writeJson(turboPath, turbo);
}

// Copia assets/test-trace.mjs para <raiz>/scripts/test-trace.mjs (comando `pnpm test:trace`, RF-86,
// PRD §7.1). So cria quando ausente: uma versao ja copiada e ajustada pelo projeto nunca e reescrita.
const TEST_TRACE_ASSET_PATH = fileURLToPath(new URL('../assets/test-trace.mjs', import.meta.url));
const TEST_TRACE_RELATIVE_PATH = 'scripts/test-trace.mjs';

async function ensureTestTraceScript({ rootDir }) {
  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }

  const targetPath = path.join(rootDir, TEST_TRACE_RELATIVE_PATH);
  if (await pathExists(targetPath)) {
    return { file: TEST_TRACE_RELATIVE_PATH, created: false };
  }

  const content = await fs.readFile(TEST_TRACE_ASSET_PATH, 'utf8');
  await activeRunOps.ensureDir(path.dirname(targetPath), {
    note: 'preparacao de diretorio para scripts/test-trace.mjs',
  });
  await activeRunOps.writeTextFile(targetPath, content, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: 'scripts/test-trace.mjs (rastreabilidade PRD-teste, RF-86)',
  });
  await fs.chmod(targetPath, 0o755);

  return { file: TEST_TRACE_RELATIVE_PATH, created: true };
}

async function ensurePreCommitHooks({ rootDir }) {
  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }

  const huskyDir = path.join(rootDir, '.husky');
  const preCommitPath = path.join(huskyDir, 'pre-commit');
  const prePushPath = path.join(huskyDir, 'pre-push');
  const lintStagedPath = path.join(rootDir, '.lintstagedrc');

  await activeRunOps.ensureDir(huskyDir, { note: 'preparacao de diretorio husky' });

  const preCommitResult = await activeRunOps.writeTextFile(preCommitPath, HUSKY_PRE_COMMIT_CONTENT, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: '.husky/pre-commit',
  });
  if (preCommitResult.changed) {
    await fs.chmod(preCommitPath, 0o755);
  }

  const prePushResult = await activeRunOps.writeTextFile(prePushPath, HUSKY_PRE_PUSH_CONTENT, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: '.husky/pre-push',
  });
  if (prePushResult.changed) {
    await fs.chmod(prePushPath, 0o755);
  }

  const expectedLintStaged = `${JSON.stringify(DEFAULT_LINT_STAGED_CONFIG, null, 2)}\n`;
  const previousLintStaged = (await pathExists(lintStagedPath)) ? await fs.readFile(lintStagedPath, 'utf8') : '';
  let lintStagedResult = { changed: false };
  if (previousLintStaged !== expectedLintStaged) {
    lintStagedResult = await activeRunOps.writeTextFile(lintStagedPath, expectedLintStaged, {
      ensureNewline: false,
      markRiskOnOverwrite: true,
      note: '.lintstagedrc',
    });
  }

  // Idempotente: aponta core.hooksPath para .husky (mesmo efeito do lifecycle "prepare" do husky).
  await runCommand('pnpm', ['exec', 'husky'], rootDir);

  return {
    preCommitChanged: preCommitResult.changed,
    prePushChanged: prePushResult.changed,
    lintStagedChanged: lintStagedResult.changed,
  };
}

async function patchBackendMain({ rootDir, backendPath, backendPort, backendPortEnvVar, hasEnvModule = false }) {
  const mainPath = path.join(rootDir, backendPath, 'src', 'main.ts');
  if (!(await pathExists(mainPath))) {
    return { updated: false, skipped: true };
  }

  let content = await fs.readFile(mainPath, 'utf8');
  const original = content;

  if (content.includes('import "dotenv/config";')) {
    content = content.replace('import "dotenv/config";', "import 'dotenv/config';");
  }

  if (!content.includes("import 'dotenv/config';")) {
    content = `import 'dotenv/config';\n${content}`;
  }

  if (hasEnvModule && !content.includes(BACKEND_ENV_MODULE_IMPORT)) {
    content = content.replace("import 'dotenv/config';\n", `import 'dotenv/config';\n${BACKEND_ENV_MODULE_IMPORT}\n`);
  }

  if (!content.includes('app.enableCors();')) {
    content = content.replace(
      /const app = await NestFactory\.create\(AppModule\);\s*/,
      'const app = await NestFactory.create(AppModule);\n  app.enableCors();\n',
    );
  }

  const portVariableName = `process.env.${backendPortEnvVar}`;
  const desiredPortLine = `const port = Number(${portVariableName} ?? ${backendPort});`;
  const portAssignmentRegex = /const\s+port\s*=\s*[^;]+;/;
  const listenCallRegex = /await app\.listen\(([^;]+)\);/;

  if (portAssignmentRegex.test(content)) {
    content = content.replace(portAssignmentRegex, desiredPortLine);
    content = content.replace(listenCallRegex, 'await app.listen(port);');
  } else if (listenCallRegex.test(content)) {
    content = content.replace(listenCallRegex, `${desiredPortLine}\n  await app.listen(port);`);
  }

  if (content === original) {
    return { updated: false, skipped: false };
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.writeTextFile(mainPath, content, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: 'backend main.ts',
  });
  return { updated: true, skipped: false };
}

function findMatchingToken(content, startIndex, openToken, closeToken) {
  let depth = 0;
  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];

    if (char === openToken) {
      depth += 1;
      continue;
    }

    if (char === closeToken) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function hasWildcardPatternForProtocol(patternContent, protocol) {
  const protocolMatcher = new RegExp(`protocol\\s*:\\s*["']${escapeRegExp(protocol)}["']`);
  const hostnameMatcher = /hostname\s*:\s*["']\*\*["']/;
  return protocolMatcher.test(patternContent) && hostnameMatcher.test(patternContent);
}

function buildRemotePatternItem(protocol, indent) {
  return [`${indent}{`, `${indent}  protocol: "${protocol}",`, `${indent}  hostname: "**",`, `${indent}}`].join('\n');
}

function ensureNextRemotePatterns(content) {
  const nextConfigDeclaration = /const\s+nextConfig(?:\s*:\s*NextConfig)?\s*=\s*\{/m;
  const declarationMatch = nextConfigDeclaration.exec(content);

  if (!declarationMatch || declarationMatch.index === undefined) {
    return { updated: false, nextContent: content, reason: 'unsupported-structure' };
  }

  const declarationStart = declarationMatch.index;
  const configObjectStart = declarationStart + declarationMatch[0].lastIndexOf('{');
  const configObjectEnd = findMatchingToken(content, configObjectStart, '{', '}');

  if (configObjectEnd < 0) {
    return { updated: false, nextContent: content, reason: 'unbalanced-config' };
  }

  const configBody = content.slice(configObjectStart + 1, configObjectEnd);
  const imagesBlockRegex = /\bimages\s*:\s*\{/m;
  const imagesMatch = imagesBlockRegex.exec(configBody);

  if (!imagesMatch) {
    const remotePatternsBlock = [
      '  images: {',
      '    remotePatterns: [',
      buildRemotePatternItem('https', '      ') + ',',
      buildRemotePatternItem('http', '      '),
      '    ],',
      '  },',
    ].join('\n');

    const injected = `${content.slice(
      0,
      configObjectStart + 1,
    )}\n${remotePatternsBlock}${content.slice(configObjectStart + 1)}`;
    return { updated: true, nextContent: injected, reason: 'inserted-images-block' };
  }

  const imagesAbsoluteStart = configObjectStart + 1 + imagesMatch.index + imagesMatch[0].lastIndexOf('{');
  const imagesAbsoluteEnd = findMatchingToken(content, imagesAbsoluteStart, '{', '}');

  if (imagesAbsoluteEnd < 0) {
    return { updated: false, nextContent: content, reason: 'unbalanced-images' };
  }

  const imagesBody = content.slice(imagesAbsoluteStart + 1, imagesAbsoluteEnd);
  const remotePatternsRegex = /\bremotePatterns\s*:\s*\[/m;
  const remotePatternsMatch = remotePatternsRegex.exec(imagesBody);

  if (!remotePatternsMatch) {
    const remotePatternsBlock = [
      '    remotePatterns: [',
      buildRemotePatternItem('https', '      ') + ',',
      buildRemotePatternItem('http', '      '),
      '    ],',
    ].join('\n');

    const injected = `${content.slice(
      0,
      imagesAbsoluteStart + 1,
    )}\n${remotePatternsBlock}${content.slice(imagesAbsoluteStart + 1)}`;
    return {
      updated: true,
      nextContent: injected,
      reason: 'inserted-remote-patterns',
    };
  }

  const remotePatternsAbsoluteStart =
    imagesAbsoluteStart + 1 + remotePatternsMatch.index + remotePatternsMatch[0].lastIndexOf('[');
  const remotePatternsAbsoluteEnd = findMatchingToken(content, remotePatternsAbsoluteStart, '[', ']');

  if (remotePatternsAbsoluteEnd < 0) {
    return {
      updated: false,
      nextContent: content,
      reason: 'unbalanced-remote-patterns',
    };
  }

  const remotePatternsBody = content.slice(remotePatternsAbsoluteStart + 1, remotePatternsAbsoluteEnd);
  const hasHttps = hasWildcardPatternForProtocol(remotePatternsBody, 'https');
  const hasHttp = hasWildcardPatternForProtocol(remotePatternsBody, 'http');

  if (hasHttps && hasHttp) {
    return { updated: false, nextContent: content, reason: 'already-configured' };
  }

  const missingItems = [];
  if (!hasHttps) {
    missingItems.push(buildRemotePatternItem('https', '      '));
  }
  if (!hasHttp) {
    missingItems.push(buildRemotePatternItem('http', '      '));
  }

  const trimmedPatternsBody = remotePatternsBody.trim();
  const prependComma = trimmedPatternsBody.length > 0 && !trimmedPatternsBody.endsWith(',');
  const addition = `${prependComma ? ',' : ''}\n${missingItems.join(',\n')}\n    `;

  const injected = `${content.slice(
    0,
    remotePatternsAbsoluteEnd,
  )}${addition}${content.slice(remotePatternsAbsoluteEnd)}`;
  return {
    updated: true,
    nextContent: injected,
    reason: 'appended-missing-patterns',
  };
}

async function patchNextAppRemoteImages({ rootDir, appPath }) {
  const appDir = path.join(rootDir, appPath);
  const candidates = ['next.config.ts', 'next.config.mjs', 'next.config.js'];
  let configPath = '';

  for (const candidate of candidates) {
    const absolutePath = path.join(appDir, candidate);
    if (await pathExists(absolutePath)) {
      configPath = absolutePath;
      break;
    }
  }

  if (!configPath) {
    return { updated: false, skipped: true, reason: 'file-not-found', file: '' };
  }

  const content = await fs.readFile(configPath, 'utf8');
  const patchResult = ensureNextRemotePatterns(content);

  if (!patchResult.updated) {
    return {
      updated: false,
      skipped: false,
      reason: patchResult.reason,
      file: path.relative(rootDir, configPath).replace(/\\/g, '/'),
    };
  }

  if (!activeRunOps) {
    throw new Error('Run operations are not initialized.');
  }
  await activeRunOps.writeTextFile(configPath, patchResult.nextContent, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
    note: path.basename(configPath),
  });
  return {
    updated: true,
    skipped: false,
    reason: patchResult.reason,
    file: path.relative(rootDir, configPath).replace(/\\/g, '/'),
  };
}

async function main() {
  // Always apply bootstrap to the current working directory where the user invokes the skill.
  const rootDir = process.cwd();
  const logger = await createSkillRunLogger({
    rootDir,
    skillName: 'config-project',
    commandArgs: process.argv.slice(2),
    deferGitignoreEnsure: true,
    gitignoreCreateIfMissing: false,
  });

  try {
    activeRunLogger = logger;
    activeRunOps = createSkillRunOps({
      rootDir,
      logger,
      dryRun: false,
    });
    const skillConfig = await loadSkillConfig(rootDir);

    const {
      apps: clientApps,
      backendPath,
      backendPort,
      backendPortEnvVar,
      scope: scopeArg,
      skipGlobalNest,
    } = parseArgs(process.argv.slice(2), skillConfig.defaults);

    const { scope } = await resolveNamespace({
      rootDir,
      cliScope: scopeArg,
      fallbackScope: skillConfig.defaults.namespace,
    });

    const nextApps = clientApps.filter((app) => app.kind === 'next');
    const appDirOf = (app) => path.join(rootDir, app.path);
    const isValidAppDirectory = () => isNextAppDirectory;
    const backendDir = path.join(rootDir, backendPath);

    // Rede de seguranca (incidente de 2026-09-04): registra, antes de qualquer mutacao, se
    // cada app ja era uma instancia real e valida do seu tipo. O script tem varios pontos que
    // podem mexer em apps/docs/apps/web/packages/ui (limpeza de template padrao do Turbo,
    // merge do scaffold do create-turbo) e um deles apagou um apps/web ja configurado sem
    // nenhum log de causa clara. Em vez de confiar que cada um desses pontos individualmente
    // nunca vai ter um bug, este snapshot + a asserção logo antes de (re)criar os apps garante
    // que QUALQUER perda inesperada aborte o script alto e claro, em vez de silenciosamente
    // recriar (e destruir) um app que ja estava configurado.
    const preflightClientAppState = new Map();
    for (const app of clientApps) {
      preflightClientAppState.set(
        app.path,
        (await pathExists(appDirOf(app))) && (await isValidAppDirectory(app)(appDirOf(app))),
      );
    }
    const preflightBackendState = (await pathExists(backendDir)) && (await isNestAppDirectory(backendDir));

    const backendParentDir = path.dirname(backendDir);
    const backendName = path.basename(backendPath);
    const backendPackageName = `${scope}/${backendName}`;

    const appsSummary = clientApps.map((app) => `${app.path}:${app.port}`).join(', ');
    console.log(
      `Bootstrap config: scope="${scope}", apps=[${appsSummary}], backendPath="${backendPath}:${backendPort}"`,
    );
    logger.step(
      `Configuração resolvida: scope=${scope}, apps=[${appsSummary}], backend=${backendPath}:${backendPort}.`,
    );

    const turboResult = await ensureTurboRoot(rootDir, scope);
    if (turboResult.scaffoldedWithCreateTurbo) {
      const copiedCount = turboResult.copiedScaffoldPaths.length;
      console.log(`TurboRepo base reconciled using create-turbo (copied missing paths: ${copiedCount}).`);
      logger.step(`Base do TurboRepo reconciliada com create-turbo (itens copiados: ${copiedCount}).`);
    } else if (turboResult.createdTurbo || turboResult.createdPackageJson) {
      const createdItems = [];
      if (turboResult.createdPackageJson) createdItems.push('package.json');
      if (turboResult.createdTurbo) createdItems.push('turbo.json');
      console.log(`TurboRepo base created/updated: ${createdItems.join(', ')}`);
      logger.step(`Base do TurboRepo criada/atualizada: ${createdItems.join(', ')}.`);
    } else {
      console.log('TurboRepo already detected at current directory.');
      logger.step('Estrutura TurboRepo já existente no diretório atual.');
    }

    const removedDefaultApps = await removeDefaultTurboApps({
      rootDir,
      nextAppPaths: nextApps.map((app) => app.path),
      backendPath,
    });
    const removedDefaultPackages = await removeDefaultTurboPackages({ rootDir });
    const removedDefaultProjects = [...removedDefaultApps, ...removedDefaultPackages];
    if (removedDefaultProjects.length > 0) {
      console.log(`Removed default Turbo template projects before app bootstrap: ${removedDefaultProjects.join(', ')}`);
      logger.step(`Projetos padrão do Turbo removidos antes do bootstrap: ${removedDefaultProjects.join(', ')}.`);
    }

    // Fecha a lacuna deixada pelo guard de seguranca de removeDefaultTurboApps: um apps/web
    // do template preservado por ser "app Next.js valido" continua declarando o pacote de UI
    // que acabou de ser removido, e isso quebra qualquer pnpm install no workspace.
    // Antes de qualquer pnpm add/install: sem isso o pnpm 11 aborta com
    // ERR_PNPM_IGNORED_BUILDS no primeiro pacote com build nativo.
    const allowedBuilds = await ensureWorkspaceAllowedBuilds({ rootDir });
    if (allowedBuilds.updated) {
      const detail = [
        allowedBuilds.added.length > 0 ? `pré-aprovados: ${allowedBuilds.added.join(', ')}` : '',
        allowedBuilds.resolvedPlaceholders > 0
          ? `${allowedBuilds.resolvedPlaceholders} placeholder(s) resolvido(s)`
          : '',
      ]
        .filter(Boolean)
        .join('; ');
      console.log(`Updated pnpm-workspace.yaml allowBuilds (${detail}).`);
      logger.step(`pnpm-workspace.yaml allowBuilds atualizado (${detail}).`);
    }

    const repairedWorkspaceDeps = await repairRemovedWorkspaceDependencies({ rootDir, logger });
    if (repairedWorkspaceDeps.length > 0) {
      console.log(`Removed orphan workspace dependencies from: ${repairedWorkspaceDeps.join(', ')}`);
      logger.step(`Dependências órfãs removidas de: ${repairedWorkspaceDeps.join(', ')}.`);
    } else {
      console.log('No default Turbo template projects needed removal.');
      logger.step('Nenhum projeto padrão do Turbo precisou ser removido.');
    }

    for (const app of clientApps) {
      await assertAppNotUnexpectedlyLost({
        label: `${app.name} (${app.path})`,
        wasValidBefore: preflightClientAppState.get(app.path),
        dir: appDirOf(app),
        isValidNowFn: isValidAppDirectory(app),
      });
    }
    await assertAppNotUnexpectedlyLost({
      label: `Backend (${backendPath})`,
      wasValidBefore: preflightBackendState,
      dir: backendDir,
      isValidNowFn: isNestAppDirectory,
    });

    for (const app of clientApps) {
      const appParentDir = path.dirname(appDirOf(app));
      const created = await ensureNextApp({
        rootDir,
        appPath: app.path,
        appName: app.name,
        appParentDir,
        label: app.name,
      });
      console.log(
        created ? `App ${app.name} created at ${app.path}.` : `App ${app.name} already exists at ${app.path}.`,
      );
      logger.step(created ? `App ${app.name} criado em ${app.path}.` : `App ${app.name} já existia em ${app.path}.`);
    }

    const backendCreated = await ensureBackendApp({
      rootDir,
      backendPath,
      backendName,
      backendParentDir,
      skipGlobalNest,
    });
    console.log(
      backendCreated ? `Backend app created at ${backendPath}.` : `Backend app already exists at ${backendPath}.`,
    );
    logger.step(backendCreated ? `Backend criado em ${backendPath}.` : `Backend já existia em ${backendPath}.`);

    const backendPackagePath = path.join(backendDir, 'package.json');

    const workspaceNamespaceResult = await applyNamespaceToWorkspacePackages({
      rootDir,
      scope,
    });
    let namespaceChanged = workspaceNamespaceResult.changedPackageJsonPaths.length > 0;
    for (const app of clientApps) {
      if (await ensurePackageName(path.join(appDirOf(app), 'package.json'), `${scope}/${app.name}`)) {
        namespaceChanged = true;
      }
    }
    if (await ensurePackageName(backendPackagePath, backendPackageName)) {
      namespaceChanged = true;
    }

    if (namespaceChanged) {
      console.log(`Namespace synchronized (${workspaceNamespaceResult.packageCount} workspace packages).`);
      logger.step(`Namespace sincronizado em ${workspaceNamespaceResult.packageCount} pacotes do workspace.`);
    } else {
      console.log('Namespace already applied to workspace/apps/backend packages.');
      logger.step('Namespace já estava aplicado no workspace/apps/backend.');
    }

    // Criados DEPOIS do namespace de proposito: cada pacote roda "pnpm add
    // <scope>/typescript-config@workspace:*", que so resolve quando packages/typescript-config
    // ja foi renomeado para o escopo do projeto. Na ordem inversa o pnpm add falha.
    for (const spec of INTERNAL_PACKAGES) {
      const packageResult = await ensureInternalPackage({ rootDir, scope, spec });
      if (packageResult.skipped) {
        console.log(`Skipped ${packageResult.packagePath} (${packageResult.reason}).`);
        logger.step(`${packageResult.packagePath} ignorado (${packageResult.reason}).`);
        continue;
      }
      const installed = packageResult.installedDependencies.join(', ') || 'nenhuma';
      console.log(`Created ${packageResult.packagePath} (installed: ${installed}).`);
      logger.step(`${packageResult.packagePath} criado como esqueleto (PRD §6.1) com dependências: ${installed}.`);
    }

    const turboInstalled = await ensureDependency({
      packageJsonPath: path.join(rootDir, 'package.json'),
      depName: 'turbo',
      installCommand: 'pnpm',
      installArgs: ['add', '-D', '-w', 'turbo'],
      cwd: rootDir,
    });
    if (!turboInstalled) {
      console.log('Dependency already present at root: turbo');
      logger.step('Dependência turbo já presente na raiz.');
    } else {
      logger.step('Dependência turbo instalada na raiz.');
    }

    const tsNodeInstalled = await ensureDependency({
      packageJsonPath: path.join(rootDir, 'package.json'),
      depName: 'ts-node',
      installCommand: 'pnpm',
      installArgs: ['add', '-D', '-w', 'ts-node'],
      cwd: rootDir,
    });
    if (!tsNodeInstalled) {
      console.log('Dependency already present at root: ts-node');
      logger.step('Dependência ts-node já presente na raiz.');
    } else {
      logger.step('Dependência ts-node instalada na raiz.');
    }

    const prettierInstalled = await ensureDependency({
      packageJsonPath: path.join(rootDir, 'package.json'),
      depName: 'prettier',
      installCommand: 'pnpm',
      installArgs: ['add', '-D', '-w', 'prettier@^3.7.4'],
      cwd: rootDir,
    });
    if (!prettierInstalled) {
      console.log('Dependency already present at root: prettier');
      logger.step('Dependência prettier já presente na raiz.');
    } else {
      logger.step('Dependência prettier instalada na raiz.');
    }

    const dotenvInstalled = await ensureDependency({
      packageJsonPath: backendPackagePath,
      depName: 'dotenv',
      installCommand: 'pnpm',
      installArgs: ['add', 'dotenv'],
      cwd: backendDir,
    });
    if (!dotenvInstalled) {
      console.log(`Dependency already present in ${backendPath}: dotenv`);
      logger.step(`Dependência dotenv já presente em ${backendPath}.`);
    } else {
      logger.step(`Dependência dotenv instalada em ${backendPath}.`);
    }

    const huskyInstalled = await ensureDependency({
      packageJsonPath: path.join(rootDir, 'package.json'),
      depName: 'husky',
      installCommand: 'pnpm',
      installArgs: ['add', '-D', '-w', 'husky'],
      cwd: rootDir,
    });
    if (!huskyInstalled) {
      console.log('Dependency already present at root: husky');
      logger.step('Dependência husky já presente na raiz.');
    } else {
      logger.step('Dependência husky instalada na raiz.');
    }

    const lintStagedInstalled = await ensureDependency({
      packageJsonPath: path.join(rootDir, 'package.json'),
      depName: 'lint-staged',
      installCommand: 'pnpm',
      installArgs: ['add', '-D', '-w', 'lint-staged'],
      cwd: rootDir,
    });
    if (!lintStagedInstalled) {
      console.log('Dependency already present at root: lint-staged');
      logger.step('Dependência lint-staged já presente na raiz.');
    } else {
      logger.step('Dependência lint-staged instalada na raiz.');
    }

    // Necessario para o lint-staged rodar `eslint --fix` em arquivos staged de qualquer app
    // do workspace: `pnpm exec`/lint-staged resolve o binario a partir do node_modules/.bin
    // da RAIZ, que so existe se `eslint` for dependencia direta do package.json raiz (a
    // config em si continua vindo do `packages/eslint-config`/eslint.config de cada app).
    const eslintInstalled = await ensureDependency({
      packageJsonPath: path.join(rootDir, 'package.json'),
      depName: 'eslint',
      installCommand: 'pnpm',
      installArgs: ['add', '-D', '-w', 'eslint'],
      cwd: rootDir,
    });
    if (!eslintInstalled) {
      console.log('Dependency already present at root: eslint');
      logger.step('Dependência eslint já presente na raiz.');
    } else {
      logger.step('Dependência eslint instalada na raiz (necessária para o lint-staged rodar `eslint --fix`).');
    }

    await patchRootPackageJson(rootDir, scope);
    logger.step(
      `package.json da raiz atualizado incrementalmente (engines.node ${REQUIRED_NODE_ENGINE_RANGE} incluso).`,
    );

    const npmrcEngineStrictResult = await ensureRootNpmrcEngineStrict(rootDir);
    if (npmrcEngineStrictResult.updated) {
      console.log(
        npmrcEngineStrictResult.created
          ? 'Created .npmrc with engine-strict=true at repository root.'
          : 'Updated .npmrc with engine-strict=true at repository root.',
      );
      logger.step(
        npmrcEngineStrictResult.created
          ? '.npmrc criado na raiz com engine-strict=true (PRD §7 Runtime).'
          : '.npmrc atualizado na raiz com engine-strict=true (PRD §7 Runtime).',
      );
    } else {
      console.log('.npmrc already has engine-strict=true at repository root.');
      logger.step('.npmrc já tinha engine-strict=true na raiz.');
    }

    const prettierConfigResult = await ensureRootPrettierConfig(rootDir);
    if (prettierConfigResult.updated) {
      console.log(
        prettierConfigResult.created
          ? 'Created .prettierrc at repository root.'
          : 'Updated .prettierrc at repository root.',
      );
      logger.step(
        prettierConfigResult.created
          ? '.prettierrc criado na raiz do repositório.'
          : '.prettierrc atualizado na raiz do repositório.',
      );
    } else {
      console.log('.prettierrc already configured at repository root.');
      logger.step('.prettierrc já estava configurado na raiz do repositório.');
    }

    const backendPackagePatchResult = await patchBackendPackageJson({
      rootDir,
      backendPath,
    });
    if (backendPackagePatchResult.updated) {
      console.log(`Updated ${backendPath}/package.json`);
      logger.step(`${backendPath}/package.json atualizado.`);
    } else if (backendPackagePatchResult.skipped) {
      console.log(`Skipped ${backendPath}/package.json (file not found).`);
      logger.step(`${backendPath}/package.json ignorado (arquivo ausente).`);
    } else {
      console.log(`${backendPath}/package.json already configured.`);
      logger.step(`${backendPath}/package.json já estava configurado.`);
    }

    await patchTurboJson(rootDir);
    logger.step('turbo.json atualizado incrementalmente.');

    for (const app of nextApps) {
      const nextConfigPatchResult = await patchNextAppRemoteImages({
        rootDir,
        appPath: app.path,
      });
      if (nextConfigPatchResult.updated) {
        console.log(`Updated ${nextConfigPatchResult.file} (images.remotePatterns liberado para http/https).`);
        logger.step(`${nextConfigPatchResult.file} atualizado com images.remotePatterns para http/https.`);
      } else if (nextConfigPatchResult.skipped) {
        console.log(`Skipped Next config patch at ${app.path} (${nextConfigPatchResult.reason}).`);
        logger.step(`Configuração de imagens do Next ignorada em ${app.path} (${nextConfigPatchResult.reason}).`);
      } else {
        console.log(
          `${nextConfigPatchResult.file} already configured for remote images (${nextConfigPatchResult.reason}).`,
        );
        logger.step(`${nextConfigPatchResult.file} já estava configurado para imagens remotas.`);
      }
    }

    for (const app of clientApps) {
      const checkTypesResult = await ensureCheckTypesScript({ rootDir, appPath: app.path });
      if (checkTypesResult.updated) {
        logger.step(`${app.path}/package.json: script "check-types" adicionado.`);
      }
    }

    const typeScriptTargets = [
      ...clientApps.map((app) => ({ appPath: app.path, kind: app.kind })),
      { appPath: backendPath, kind: 'node' },
    ];
    for (const target of typeScriptTargets) {
      const tsResult = await ensureTypeScriptBaseline({
        rootDir,
        appPath: target.appPath,
        kind: target.kind,
      });

      if (tsResult.skipped) {
        console.log(`Skipped TypeScript baseline at ${tsResult.file} (${tsResult.reason}).`);
        logger.step(`Baseline de TypeScript ignorado em ${tsResult.file} (${tsResult.reason}).`);
        continue;
      }

      if (tsResult.created) {
        console.log(`Created ${tsResult.file} with the TypeScript baseline.`);
        logger.step(`${tsResult.file} criado com o baseline de TypeScript.`);
        continue;
      }

      if (tsResult.updated) {
        console.log(`Updated ${tsResult.file} (${tsResult.changes.join(', ')}).`);
        logger.step(`${tsResult.file} alinhado ao baseline de TypeScript (${tsResult.changes.join(', ')}).`);
        continue;
      }

      console.log(`${tsResult.file} already matches the TypeScript baseline.`);
      logger.step(`${tsResult.file} já estava alinhado ao baseline de TypeScript.`);
    }

    const zodTargets = [];
    for (const app of clientApps) {
      zodTargets.push({
        appPath: app.path,
        setup: await ensureClientZodSetup({ rootDir, appPath: app.path, apiUrlEnvVar: app.apiUrlEnvVar }),
      });
    }
    zodTargets.push({
      appPath: backendPath,
      setup: await ensureBackendZodSetup({ rootDir, backendPath, backendPortEnvVar, backendPort }),
    });
    for (const { appPath, setup } of zodTargets) {
      if (setup.dependency.skipped) {
        console.log(`Skipped zod setup at ${appPath} (${setup.dependency.reason}).`);
        logger.step(`Configuração do Zod ignorada em ${appPath} (${setup.dependency.reason}).`);
        continue;
      }

      if (setup.dependency.installed) {
        logger.step(`Dependência zod instalada em ${appPath}.`);
      } else {
        console.log(`Dependency already present in ${appPath}: zod`);
        logger.step(`Dependência zod já presente em ${appPath}.`);
      }

      for (const fileResult of setup.files) {
        if (fileResult.skipped) {
          console.log(`Skipped ${fileResult.file} (${fileResult.reason}).`);
          logger.step(`${fileResult.file} ignorado (${fileResult.reason}).`);
        } else if (fileResult.created) {
          console.log(`Created ${fileResult.file}`);
          logger.step(`${fileResult.file} criado (Zod).`);
        } else {
          console.log(`${fileResult.file} already exists (kept as is).`);
          logger.step(`${fileResult.file} já existia e foi preservado.`);
        }
      }
    }

    // Ferramental de testes (Vitest em apps/api e nos apps Next) — PRD §7.1.
    const testToolingSetups = [{ label: backendPath, result: await ensureApiTestTooling({ rootDir, backendPath }) }];
    for (const app of clientApps) {
      testToolingSetups.push({
        label: app.path,
        result: await ensureWebTestTooling({ rootDir, appPath: app.path, apiUrlEnvVar: app.apiUrlEnvVar }),
      });
    }
    for (const { label, result } of testToolingSetups) {
      if (result.dependency.skipped) {
        console.log(`Skipped test tooling dependencies at ${label} (${result.dependency.reason}).`);
        logger.step(`Ferramental de testes ignorado em ${label} (${result.dependency.reason}).`);
      } else if (result.dependency.installedNames.length > 0) {
        console.log(`Installed test tooling in ${label}: ${result.dependency.installedNames.join(', ')}`);
        logger.step(`Dependências de teste instaladas em ${label}: ${result.dependency.installedNames.join(', ')}.`);
      } else {
        console.log(`Test tooling dependencies already present in ${label}.`);
        logger.step(`Dependências de teste já presentes em ${label}.`);
      }

      if (result.removedJest?.removedNames?.length > 0) {
        console.log(`Removed default Jest scaffold from ${label}: ${result.removedJest.removedNames.join(', ')}`);
        logger.step(`Scaffold padrão do Jest removido de ${label}: ${result.removedJest.removedNames.join(', ')}.`);
      } else if (result.removedJest?.failed) {
        console.warn(`Could not remove default Jest scaffold from ${label}: ${result.removedJest.reason}`);
        logger.step(
          `Falha ao remover scaffold padrão do Jest de ${label} (${result.removedJest.reason}) — remover manualmente.`,
        );
      }

      for (const fileResult of result.files) {
        if (fileResult.skipped) {
          console.log(`Skipped ${fileResult.file} (${fileResult.reason}).`);
          logger.step(`${fileResult.file} ignorado (${fileResult.reason}).`);
        } else if (fileResult.created) {
          console.log(`Created ${fileResult.file}`);
          logger.step(`${fileResult.file} criado (ferramental de testes).`);
        } else {
          console.log(`${fileResult.file} already exists (kept as is).`);
          logger.step(`${fileResult.file} já existia e foi preservado.`);
        }
      }

      if (result.scriptsResult.changedKeys.length > 0 || result.scriptsResult.jestBlockRemoved) {
        const changes = [
          ...result.scriptsResult.changedKeys,
          ...(result.scriptsResult.jestBlockRemoved ? ['jest (removido)'] : []),
        ];
        console.log(`Updated ${label}/package.json test scripts: ${changes.join(', ')}`);
        logger.step(`Scripts de teste atualizados em ${label}/package.json: ${changes.join(', ')}.`);
      } else {
        console.log(`${label}/package.json test scripts already aligned.`);
        logger.step(`Scripts de teste de ${label}/package.json já alinhados.`);
      }
    }

    const backendEnvModuleReady = await pathExists(path.join(rootDir, backendPath, BACKEND_ENV_MODULE_RELATIVE_PATH));

    const mainPatchResult = await patchBackendMain({
      rootDir,
      backendPath,
      backendPort,
      backendPortEnvVar,
      hasEnvModule: backendEnvModuleReady,
    });
    if (mainPatchResult.updated) {
      console.log(`Updated ${backendPath}/src/main.ts`);
      logger.step(`${backendPath}/src/main.ts atualizado (dotenv/cors/porta).`);
    } else if (mainPatchResult.skipped) {
      console.log(`Skipped ${backendPath}/src/main.ts (file not found).`);
      logger.step(`${backendPath}/src/main.ts ignorado (arquivo ausente).`);
    } else {
      console.log(`${backendPath}/src/main.ts already configured.`);
      logger.step(`${backendPath}/src/main.ts já estava configurado.`);
    }

    const changedEnvFiles = await writeEnvFiles({
      rootDir,
      scope,
      apps: clientApps,
      backendPath,
      backendPort,
      backendPortEnvVar,
    });
    if (changedEnvFiles.length > 0) {
      console.log(`Updated env files: ${changedEnvFiles.join(', ')}`);
      logger.step(`Arquivos de ambiente atualizados: ${changedEnvFiles.join(', ')}.`);
    } else {
      console.log('Env files already configured.');
      logger.step('Arquivos de ambiente já estavam configurados.');
    }

    const preCommitResult = await ensurePreCommitHooks({ rootDir });
    if (preCommitResult.preCommitChanged || preCommitResult.prePushChanged || preCommitResult.lintStagedChanged) {
      console.log('Git hooks configured (pre-commit: lint-staged; pre-push: check-types + test:cov).');
      logger.step('Git hooks configurados (pre-commit: lint-staged; pre-push: check-types + test:cov).');
    } else {
      console.log('Pre-commit hooks already configured.');
      logger.step('Pre-commit hooks já estavam configurados.');
    }

    const testTraceResult = await ensureTestTraceScript({ rootDir });
    if (testTraceResult.created) {
      console.log(`Created ${testTraceResult.file} (pnpm test:trace)`);
      logger.step(`${testTraceResult.file} criado (pnpm test:trace, RF-86).`);
    } else {
      console.log(`${testTraceResult.file} already exists (kept as is).`);
      logger.step(`${testTraceResult.file} já existia e foi preservado.`);
    }

    console.log('TurboRepo initialization completed (idempotent mode).');
    logger.step('Inicialização do TurboRepo concluída em modo idempotente.');

    console.log('Formatting project with Prettier...');
    await runCommand('pnpm', ['run', 'format'], rootDir);
    logger.step('Projeto formatado com Prettier (pnpm run format).');

    console.log('Verifying TypeScript (pnpm run check-types)...');
    const typeCheckResult = await verifyTypeScript({ rootDir });
    if (typeCheckResult.ok) {
      console.log('TypeScript check passed (pnpm run check-types).');
      logger.step('Verificação de TypeScript aprovada (pnpm run check-types).');
    } else {
      console.warn(
        `TypeScript check failed with exit code ${typeCheckResult.exitCode}. Fix the reported type errors and run "pnpm run check-types" again.`,
      );
      logger.step(
        `Verificação de TypeScript falhou (pnpm run check-types, exit ${typeCheckResult.exitCode}); erros de tipo precisam ser corrigidos manualmente.`,
      );
    }

    await logger.success();
  } catch (error) {
    await logger.failure(error);
    throw error;
  } finally {
    activeRunLogger = null;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
