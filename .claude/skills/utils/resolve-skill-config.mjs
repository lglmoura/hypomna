import { promises as fs } from 'node:fs';
import path from 'node:path';

// Antes: ['.claude/skills/.env', '.claude/skills/.env', '.cloud/skills/.env', '.env'] — o
// primeiro candidato aparecia duas vezes e ".cloud/skills/.env" (typo de ".claude" ou
// ".agents") nunca existe de verdade, entao ".agents/skills/.env" — o caminho que o SKILL.md
// do config-project documenta como local alternativo de instalacao — nunca era checado.
const SKILL_CONFIG_DIR_CANDIDATES = ['.claude/skills/.env', '.agents/skills/.env', '.env'];
const REPO_CONFIG_FILE = 'skills.config.json';
const LOCAL_CONFIG_FILE = 'skills.config.local.json';

// Topologia de apps definida pelo PRD (§1.4, §6.1): um backend (`apps/api`) e tres clientes
// Next.js, cada um atendendo exatamente um papel. `auth` diz como o cliente autentica (PRD §4.1,
// §6.2): sessao por cookie em dominio proprio (web e web-admin, nunca compartilhada) ou nenhuma
// (web-marketing, que nao autentica ninguem). Nao ha app mobile na v1 (PRD §1.6).
const DEFAULT_APPS = [
  { kind: 'next', path: 'apps/web', port: 3000, auth: 'cookie' },
  { kind: 'next', path: 'apps/web-admin', port: 3001, auth: 'cookie' },
  { kind: 'next', path: 'apps/web-marketing', port: 3002, auth: 'none' },
];

const APP_KINDS = ['next'];
const APP_AUTH_MODES = ['cookie', 'none'];
const DEFAULT_API_URL_ENV_VAR_BY_KIND = {
  // Next.js so inlina em build time variaveis com prefixo NEXT_PUBLIC_.
  next: 'NEXT_PUBLIC_API_URL',
};

const DEFAULT_CONFIG = {
  namespace: '',
  sharedModulePath: 'packages/shared',
  backendAppPath: 'apps/api',
  backendPort: 4000,
  backendPortEnvVar: 'PORT',
  apps: DEFAULT_APPS,
};

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeScope(scope) {
  if (typeof scope !== 'string') return '';
  const trimmed = scope.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function normalizeRelativePath(value, fallback, fieldName) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  if (path.isAbsolute(trimmed)) {
    throw new Error(`Invalid skill config: "${trimmed}" must be a relative path for ${fieldName}.`);
  }

  const normalized = path.normalize(trimmed).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid skill config: ${fieldName} cannot point outside repository root ("${trimmed}").`);
  }

  if (normalized === '.') {
    throw new Error(`Invalid skill config: ${fieldName} cannot point to repository root.`);
  }

  return normalized;
}

function validatePathLeaf(pathValue, fieldName) {
  const leaf = path.basename(pathValue);
  if (!/^[a-z][a-z0-9-]*$/.test(leaf)) {
    throw new Error(`Invalid skill config: ${fieldName} last segment "${leaf}" must match /^[a-z][a-z0-9-]*$/.`);
  }
}

function normalizePort(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid skill config: ${fieldName} must be an integer between 1 and 65535 ("${value}").`);
  }

  return parsed;
}

function normalizeEnvVarName(value, fallback, fieldName) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  if (!/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid skill config: ${fieldName} must match /^[A-Z][A-Z0-9_]*$/ ("${trimmed}").`);
  }

  return trimmed;
}

function derivePathFromLegacy(mergedDefaults, dirKey, nameKey, fallbackPath) {
  const dirValue = mergedDefaults[dirKey];
  const nameValue = mergedDefaults[nameKey];

  if (typeof dirValue === 'string' && typeof nameValue === 'string') {
    const dir = dirValue.trim();
    const name = nameValue.trim();
    if (dir && name) return `${dir}/${name}`;
  }

  return fallbackPath;
}

function pickConfiguredString(configs, key) {
  for (const config of configs) {
    if (!isRecord(config)) continue;
    const value = config[key];
    if (typeof value !== 'string') continue;
    if (!value.trim()) continue;
    return value;
  }
  return '';
}

function normalizeApps(value) {
  const input = Array.isArray(value) && value.length > 0 ? value : DEFAULT_CONFIG.apps;
  const seenPaths = new Set();
  const seenPorts = new Set();

  return input.map((entry, index) => {
    const field = `apps[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`Invalid skill config: ${field} must be an object.`);
    }

    const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
    if (!APP_KINDS.includes(kind)) {
      throw new Error(`Invalid skill config: ${field}.kind must be one of ${APP_KINDS.join(', ')} ("${entry.kind}").`);
    }

    const appPath = normalizeRelativePath(entry.path, '', `${field}.path`);
    if (!appPath) {
      throw new Error(`Invalid skill config: ${field}.path is required.`);
    }
    validatePathLeaf(appPath, `${field}.path`);

    const port = normalizePort(entry.port, undefined, `${field}.port`);
    if (port === undefined) {
      throw new Error(`Invalid skill config: ${field}.port is required.`);
    }

    const auth = entry.auth === undefined ? 'cookie' : entry.auth;
    if (!APP_AUTH_MODES.includes(auth)) {
      throw new Error(`Invalid skill config: ${field}.auth must be one of ${APP_AUTH_MODES.join(', ')} ("${auth}").`);
    }

    const apiUrlEnvVar = normalizeEnvVarName(
      entry.apiUrlEnvVar,
      DEFAULT_API_URL_ENV_VAR_BY_KIND[kind],
      `${field}.apiUrlEnvVar`,
    );

    if (seenPaths.has(appPath)) {
      throw new Error(`Invalid skill config: duplicated app path "${appPath}".`);
    }
    if (seenPorts.has(port)) {
      throw new Error(`Invalid skill config: duplicated app port ${port} (${appPath}).`);
    }
    seenPaths.add(appPath);
    seenPorts.add(port);

    return { name: path.basename(appPath), kind, path: appPath, port, apiUrlEnvVar, auth };
  });
}

function getDefaults(value) {
  if (!isRecord(value)) return {};
  if (isRecord(value.defaults)) return value.defaults;
  return value;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Invalid JSON file at ${filePath}: ${error.message}`);
  }
}

async function directoryExists(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function resolveConfigDir(rootDir) {
  for (const relativeDir of SKILL_CONFIG_DIR_CANDIDATES) {
    const candidate = path.join(rootDir, relativeDir);
    if (await directoryExists(candidate)) {
      return { configDir: candidate, relativeDir };
    }
  }

  const fallbackRelative = SKILL_CONFIG_DIR_CANDIDATES[0];
  return {
    configDir: path.join(rootDir, fallbackRelative),
    relativeDir: fallbackRelative,
  };
}

export async function loadSkillConfig(rootDir) {
  const { configDir, relativeDir } = await resolveConfigDir(rootDir);
  const repoConfigPath = path.join(configDir, REPO_CONFIG_FILE);
  const localConfigPath = path.join(configDir, LOCAL_CONFIG_FILE);

  const [repoConfigRaw, localConfigRaw] = await Promise.all([
    readJsonIfExists(repoConfigPath),
    readJsonIfExists(localConfigPath),
  ]);

  const repoDefaults = getDefaults(repoConfigRaw);
  const localDefaults = getDefaults(localConfigRaw);
  const mergedDefaults = { ...DEFAULT_CONFIG, ...repoDefaults, ...localDefaults };
  const explicitSharedModulePath = pickConfiguredString([localDefaults, repoDefaults], 'sharedModulePath');
  const explicitBackendAppPath = pickConfiguredString([localDefaults, repoDefaults], 'backendAppPath');
  const sharedModulePathInput =
    explicitSharedModulePath ||
    derivePathFromLegacy(mergedDefaults, 'packagesDir', 'sharedModule', DEFAULT_CONFIG.sharedModulePath);
  const backendAppPathInput =
    explicitBackendAppPath ||
    derivePathFromLegacy(mergedDefaults, 'appsDir', 'backendAppName', DEFAULT_CONFIG.backendAppPath);

  const sharedModulePath = normalizeRelativePath(
    sharedModulePathInput,
    DEFAULT_CONFIG.sharedModulePath,
    'sharedModulePath',
  );
  const backendAppPath = normalizeRelativePath(backendAppPathInput, DEFAULT_CONFIG.backendAppPath, 'backendAppPath');

  validatePathLeaf(sharedModulePath, 'sharedModulePath');
  validatePathLeaf(backendAppPath, 'backendAppPath');

  const apps = normalizeApps(localDefaults.apps ?? repoDefaults.apps);
  if (apps.some((app) => app.path === backendAppPath)) {
    throw new Error('Invalid skill config: backendAppPath must differ from every entry of apps.');
  }

  return {
    defaults: {
      namespace: typeof mergedDefaults.namespace === 'string' ? mergedDefaults.namespace : DEFAULT_CONFIG.namespace,
      sharedModulePath,
      backendAppPath,
      backendPort: normalizePort(mergedDefaults.backendPort, DEFAULT_CONFIG.backendPort, 'backendPort'),
      backendPortEnvVar: normalizeEnvVarName(
        mergedDefaults.backendPortEnvVar,
        DEFAULT_CONFIG.backendPortEnvVar,
        'backendPortEnvVar',
      ),
      apps,
    },
    configPaths: {
      relativeDir,
      repoConfigPath,
      localConfigPath,
    },
    raw: {
      repo: repoConfigRaw,
      local: localConfigRaw,
    },
  };
}

export async function resolveSkillPaths(rootDir) {
  const config = await loadSkillConfig(rootDir);
  const sharedModulePathRelative = config.defaults.sharedModulePath;
  const sharedDir = path.join(rootDir, sharedModulePathRelative);
  const sharedModule = path.basename(sharedModulePathRelative);
  const packagesDirRelativeRaw = path.dirname(sharedModulePathRelative);
  const packagesDirRelative = packagesDirRelativeRaw === '.' ? '' : packagesDirRelativeRaw;
  const packagesDir = packagesDirRelative ? path.join(rootDir, packagesDirRelative) : rootDir;
  const sharedPackageJsonPath = path.join(sharedDir, 'package.json');

  return {
    packagesDir,
    packagesDirRelative,
    sharedModule,
    sharedModulePathRelative,
    sharedDir,
    sharedPackageJsonPath,
    config,
  };
}

export async function resolveNamespace({ rootDir, cliScope = '', fallbackScope = '' }) {
  const cli = normalizeScope(cliScope);
  if (cli) {
    return { scope: cli, source: 'cli' };
  }

  const env = normalizeScope(process.env.PROJECT_NAMESPACE || process.env.SKILLS_NAMESPACE || '');
  if (env) {
    return { scope: env, source: 'env' };
  }

  const config = await loadSkillConfig(rootDir);
  const configScope = normalizeScope(config.defaults.namespace);
  if (configScope) {
    const source = config.raw.local ? 'local-config' : 'repo-config';
    return { scope: configScope, source };
  }

  const fallback = normalizeScope(fallbackScope);
  if (fallback) {
    return { scope: fallback, source: 'fallback' };
  }

  return { scope: '@namespace', source: 'default' };
}

export { normalizeScope };
