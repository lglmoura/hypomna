#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const DEFAULT_IOREDIS_VERSION = '5.4.1';
const DEFAULT_THROTTLER_VERSION = '6.4.0';
const DEFAULT_NESTJS_BULLMQ_VERSION = '11.0.2';
const DEFAULT_BULLMQ_VERSION = '5.34.4';
// Fallback usado apenas se skills.config.json nao definir backendAppPath (nao deveria
// acontecer: loadSkillConfig sempre retorna um valor normalizado — ver utils/resolve-skill-config.mjs).
const BACKEND_WORKSPACE = 'apps/api';
// PRD §6.2 e §7 (variaveis iniciais): UMA instancia Redis 7+, em REDIS_URL, compartilhada
// por BullMQ, rate limit (RF-81) e cache de sessao. Como maxmemory-policy vale para a instancia
// inteira e o BullMQ exige noeviction, a instancia e' noeviction e toda chave de cache precisa
// de TTL proprio (sessao e contadores do rate limit ja nascem com expiracao).
const DEFAULT_REDIS = { host: 'localhost', port: '6379' };
const REDIS_URL_KEY = 'REDIS_URL';
// Variaveis da topologia de duas instancias (kynesa). Se aparecerem, o .env veio de outro projeto.
const FOREIGN_REDIS_URL_KEYS = ['REDIS_QUEUE_URL', 'REDIS_CACHE_URL'];

let createSkillRunLogger = null;
let createSkillRunOps = null;
let loadSkillConfig = null;

async function loadSkillLoggingUtils() {
  if (createSkillRunLogger && createSkillRunOps) return;

  const [loggerModule, opsModule] = await Promise.all([
    import('../../utils/skill-run-log.mjs'),
    import('../../utils/skill-run-ops.mjs'),
  ]);

  createSkillRunLogger = loggerModule.createSkillRunLogger;
  createSkillRunOps = opsModule.createSkillRunOps;
}

async function loadSkillConfigUtils() {
  if (loadSkillConfig) return;

  const configModule = await import('../../utils/resolve-skill-config.mjs');
  loadSkillConfig = configModule.loadSkillConfig;
}

function printHelp() {
  console.log(`Redis init

Usage:
  node .claude/skills/config-redis/scripts/init-redis-backend.js [options]

Options:
  --apply                 Apply file changes (default is dry-run)
  --dry-run               Simulate changes without writing
  --install                Run pnpm install for backend workspace after file changes
  --start-redis            Run docker compose up -d redis in the backend workspace (backendAppPath)
  --queue <name>            Scaffold a BullMQ queue + processor under src/queue/<name> (repeatable)
  --help                    Show this help
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    install: false,
    startRedis: false,
    queues: [],
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--apply') {
      args.apply = true;
      continue;
    }

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (arg === '--install') {
      args.install = true;
      continue;
    }

    if (arg === '--start-redis') {
      args.startRedis = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--queue') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --queue');
      }
      args.queues.push(normalizeAndValidateQueueName(value));
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.apply) {
    args.dryRun = true;
  }

  return args;
}

function normalizeQueueName(rawName) {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidQueueName(name) {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

function normalizeAndValidateQueueName(rawName) {
  const normalized = normalizeQueueName(rawName);
  if (!isValidQueueName(normalized)) {
    throw new Error(`Invalid queue name "${rawName}". Use lowercase letters, numbers and hyphens.`);
  }
  return normalized;
}

function toPascalCase(kebabName) {
  return kebabName
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

async function readBackendPackageJson(backendDir) {
  const backendPackageJsonPath = path.join(backendDir, 'package.json');
  const raw = await fsp.readFile(backendPackageJsonPath, 'utf8');
  return JSON.parse(raw);
}

function detectProjectRoot(startDir) {
  const rootPath = path.parse(startDir).root;
  let currentDir = path.resolve(startDir);

  while (true) {
    const hasGit = fs.existsSync(path.join(currentDir, '.git'));
    const hasTurbo = fs.existsSync(path.join(currentDir, 'turbo.json'));
    const hasWorkspace = fs.existsSync(path.join(currentDir, 'pnpm-workspace.yaml'));
    if (hasGit || hasTurbo || hasWorkspace) {
      return currentDir;
    }

    if (currentDir === rootPath) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  throw new Error('Could not find project root (looked for .git, turbo.json or pnpm-workspace.yaml).');
}

function upsertValue(target, key, value) {
  if (target[key] === value) {
    return false;
  }

  target[key] = value;
  return true;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function ensureTrailingLineBreak(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function normalizeEnvValue(rawValue) {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnvContent(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const value = line.slice(separatorIndex + 1);
    result[key] = normalizeEnvValue(value);
  }

  return result;
}

function serializeEnvContent(values) {
  const preferredOrder = [REDIS_URL_KEY];

  const keys = Object.keys(values);
  const remaining = keys.filter((key) => !preferredOrder.includes(key));
  const ordered = [...preferredOrder.filter((key) => key in values), ...remaining];

  const lines = ordered.map((key) => {
    const value = String(values[key]);
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${key}="${escaped}"`;
  });

  return `${lines.join('\n')}\n`;
}

async function readEnvFile(envFilePath) {
  try {
    const raw = await fsp.readFile(envFilePath, 'utf8');
    return parseEnvContent(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function parseRedisUrl(redisUrl, defaults) {
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname || defaults.host,
      port: parsed.port || defaults.port,
    };
  } catch {
    return { ...defaults };
  }
}

function buildRedisUrl(config) {
  return `redis://${config.host}:${config.port}`;
}

function resolveRedisInstance(source, key, defaults) {
  const url = source[key] || buildRedisUrl(defaults);
  return { ...parseRedisUrl(url, defaults), url };
}

async function resolveRedisConfig(backendDir) {
  const envPath = path.join(backendDir, '.env');
  const envExamplePath = path.join(backendDir, '.env.example');

  const envVars = await readEnvFile(envPath);
  const envExampleVars = await readEnvFile(envExamplePath);
  const source = envVars || envExampleVars || {};

  return {
    instance: resolveRedisInstance(source, REDIS_URL_KEY, DEFAULT_REDIS),
    foreignKeys: FOREIGN_REDIS_URL_KEYS.filter((key) => key in source),
    envPath,
    envExamplePath,
  };
}

async function writeFileIfChanged(filePath, content, ctx) {
  const normalized = ensureTrailingLineBreak(content);
  const result = await ctx.ops.writeTextFile(filePath, normalized, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
  });
  if (!result.changed) {
    return false;
  }

  ctx.changes.push(`${result.created ? 'create' : 'update'} ${toPosix(path.relative(ctx.rootDir, filePath))}`);

  return true;
}

async function ensureDir(dirPath, ctx) {
  const created = await ctx.ops.ensureDir(dirPath, {
    note: 'preparacao de infraestrutura redis',
  });
  if (!created) {
    return;
  }

  ctx.changes.push(`mkdir ${toPosix(path.relative(ctx.rootDir, dirPath))}`);
}

// Injeta um import de classe + entrada no array (ex.: "imports: [...]") de um
// arquivo TS existente, sem reescrever o resto do arquivo — mesma tecnica usada
// pela config-prisma para registrar o DbModule em app.module.ts, generalizada
// aqui para reaproveitar em app.module.ts (SessionCacheModule/RateLimitModule/
// QueueModule) e em queue.module.ts (um <Nome>QueueModule por fila via --queue).
async function ensureClassImportedInArray(filePath, { className, importPath, arrayKey }, ctx) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = await fsp.readFile(filePath, 'utf8');
  let updated = content;

  const escapedImportPath = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importLine = `import { ${className} } from '${importPath}';`;
  const hasImport = new RegExp(`from ['"]${escapedImportPath}['"]`).test(updated);

  if (!hasImport) {
    const importBlockMatch = updated.match(/^(import[^\n]*\n)+/m);
    if (importBlockMatch) {
      updated = `${importBlockMatch[0]}${importLine}\n${updated.slice(importBlockMatch[0].length)}`;
    } else {
      updated = `${importLine}\n${updated}`;
    }
  }

  const arrayRegex = new RegExp(`(${arrayKey}:\\s*\\[)([\\s\\S]*?)(\\],)`, 'm');
  const arrayMatch = updated.match(arrayRegex);

  if (arrayMatch && !new RegExp(`\\b${className}\\b`).test(arrayMatch[2])) {
    const inner = arrayMatch[2];
    const replacement = inner.trim().length === 0 ? `\n    ${className},\n  ` : `\n    ${className},${inner}`;
    updated = updated.replace(arrayRegex, `$1${replacement}$3`);
  }

  if (updated !== content) {
    await writeFileIfChanged(filePath, updated, ctx);
  }
}

// container_name deriva do namespace do skills.config.json ("@hypomna" -> "hypomna"),
// para o container nao nascer com um nome generico que precise de rename manual
// depois. Sem namespace configurado, mantem o prefixo historico "app".
function resolveProjectName(namespace) {
  const trimmed = typeof namespace === 'string' ? namespace.trim().replace(/^@/, '') : '';
  return /^[a-z][a-z0-9-]*$/.test(trimmed) ? trimmed : 'app';
}

function renderRedisComposeService(instance, projectName) {
  return `  redis:
    image: redis:7-alpine
    container_name: ${projectName}-redis
    restart: unless-stopped
    # Instancia unica (PRD §6.2/§7, REDIS_URL): o BullMQ exige noeviction — qualquer politica de
    # descarte pode apagar jobs pendentes — e appendonly mantem os jobs depois de um restart.
    # Cache de sessao e rate limit convivem aqui sempre com TTL proprio.
    command: ['redis-server', '--maxmemory-policy', 'noeviction', '--appendonly', 'yes']
    ports:
      - '${instance.port}:6379'
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
`;
}

function renderRedisVolumeEntry() {
  return `  redis_data:
    driver: local
`;
}

function renderStandaloneDockerCompose(redisConfig, projectName) {
  return `services:
${renderRedisComposeService(redisConfig.instance, projectName)}
volumes:
${renderRedisVolumeEntry()}`;
}

// docker-compose.yml e' criado/preservado pela config-prisma (com o servico postgres) e
// completado a mao com minio e mailpit. Esta funcao nunca reescreve o arquivo inteiro: so
// injeta o servico "redis" (e o volume "redis_data") se ainda nao existirem.
async function ensureDockerComposeHasRedis(backendDir, redisConfig, ctx, logger, rootDir, projectName) {
  const dockerComposePath = path.join(backendDir, 'docker-compose.yml');
  const relativeComposePath = toPosix(path.relative(rootDir, dockerComposePath));

  if (!fs.existsSync(dockerComposePath)) {
    await writeFileIfChanged(dockerComposePath, renderStandaloneDockerCompose(redisConfig, projectName), ctx);
    logger.risk(
      `docker-compose.yml criado apenas com o servico "redis" (postgres ausente) — rode a skill config-prisma para adicionar o servico postgres: ${relativeComposePath}`,
    );
    return;
  }

  const existingCompose = await fsp.readFile(dockerComposePath, 'utf8');

  if (/^\s{2}redis-(queue|cache):\s*$/m.test(existingCompose)) {
    logger.risk(
      `docker-compose.yml tem "redis-queue"/"redis-cache" (topologia de duas instancias, fora do PRD do Hypomna) — substitua-os pelo servico unico "redis"; o arquivo nao e alterado automaticamente para nao apagar dados: ${relativeComposePath}`,
    );
  }

  if (/^\s{2}redis:\s*$/m.test(existingCompose)) {
    logger.step(`docker-compose.yml ja possui o servico "redis" (preservado): ${relativeComposePath}`);
    return;
  }

  if (!/^services:\s*\n/m.test(existingCompose)) {
    throw new Error(
      `docker-compose.yml em ${relativeComposePath} nao tem uma secao "services:" reconhecivel — adicione o servico redis manualmente.`,
    );
  }

  let updated = existingCompose.replace(
    /^services:\s*\n/m,
    (match) => `${match}${renderRedisComposeService(redisConfig.instance, projectName)}`,
  );

  if (!/^\s{2}redis_data:/m.test(updated)) {
    if (/^volumes:\s*\n/m.test(updated)) {
      updated = updated.replace(/^volumes:\s*\n/m, (match) => `${match}${renderRedisVolumeEntry()}`);
    } else {
      updated = `${updated.replace(/\s*$/, '')}\n\nvolumes:\n${renderRedisVolumeEntry()}`;
    }
  }

  logger.risk(`docker-compose.yml existente sera atualizado para incluir o servico redis: ${relativeComposePath}`);
  await writeFileIfChanged(dockerComposePath, updated, ctx);
}

async function ensureBackendPackageJsonForRedis(backendDir, ctx) {
  const packageJsonPath = path.join(backendDir, 'package.json');
  const raw = await fsp.readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);

  const dependencies = parsed.dependencies || {};
  const scripts = parsed.scripts || {};
  parsed.dependencies = dependencies;
  parsed.scripts = scripts;

  upsertValue(dependencies, 'ioredis', dependencies.ioredis || `^${DEFAULT_IOREDIS_VERSION}`);
  upsertValue(dependencies, '@nestjs/throttler', dependencies['@nestjs/throttler'] || `^${DEFAULT_THROTTLER_VERSION}`);
  upsertValue(dependencies, '@nestjs/bullmq', dependencies['@nestjs/bullmq'] || `^${DEFAULT_NESTJS_BULLMQ_VERSION}`);
  upsertValue(dependencies, 'bullmq', dependencies.bullmq || `^${DEFAULT_BULLMQ_VERSION}`);

  upsertValue(scripts, 'redis:start', 'docker compose up -d redis');
  upsertValue(scripts, 'redis:stop', 'docker compose stop redis');
  upsertValue(scripts, 'redis:logs', 'docker compose logs -f redis');

  const nextRaw = `${JSON.stringify(parsed, null, 2)}\n`;
  if (nextRaw !== raw) {
    await writeFileIfChanged(packageJsonPath, nextRaw, ctx);
  }
}

async function ensureEnvFilesForRedis(backendDir, redisConfig, ctx) {
  const extraDefaults = {
    [REDIS_URL_KEY]: redisConfig.instance.url,
    SESSION_CACHE_TTL_SECONDS: '300',
    QUEUE_MAX_ATTEMPTS: '5',
    QUEUE_BACKOFF_DELAY_MS: '2000',
  };

  for (const envFilePath of [redisConfig.envExamplePath, redisConfig.envPath]) {
    const existing = (await readEnvFile(envFilePath)) || {};
    const nextValues = { ...existing };
    let changed = false;

    for (const [key, value] of Object.entries(extraDefaults)) {
      if (!(key in nextValues)) {
        nextValues[key] = value;
        changed = true;
      }
    }

    if (!changed) {
      continue;
    }

    const rendered = serializeEnvContent(nextValues);
    await writeFileIfChanged(envFilePath, rendered, ctx);
  }
}

function renderRedisLibFile() {
  return `import { Logger } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

// Redis nunca e' fonte de verdade neste produto. Instancia unica em REDIS_URL
// (PRD 6.2/7), noeviction por causa do BullMQ: fila (importacao, recalculo de
// status de mesa, exportacao, e-mails e webhooks), rate limit (RF-81) e cache
// de sessao. Toda chave de cache precisa de TTL proprio, e toda chave de dado de
// dominio e' prefixada pelo tenantId (PRD 3.2).

const logger = new Logger('Redis');

function parseRedisUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    db:
      url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
  };
}

function requireRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required to create a Redis connection');
  }
  return redisUrl;
}

// Com o Redis fora do ar, o Node tenta IPv6 e IPv4 em paralelo e o ioredis
// repassa um AggregateError cujo .message e' vazio — o detalhe real fica em
// .errors. Ler so error.message produzia um log truncado, sem causa nenhuma.
function describeRedisError(error: Error): string {
  if (error instanceof AggregateError) {
    const causes = error.errors
      .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
      .filter(Boolean);

    if (causes.length > 0) {
      return causes.join('; ');
    }
  }

  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || String(error);
}

// Client de cache, usado pelo cache de sessao e pelo rate limiter (RF-81). Um
// maxRetriesPerRequest baixo evita que uma queda do Redis prenda o caminho da
// requisicao — quem consome este client captura o erro e degrada: cache de
// sessao -> Postgres; rate limit -> ver redis-throttler.storage.ts.
export function createCacheRedisClient(keyPrefix: string): Redis {
  const options: RedisOptions = {
    ...parseRedisUrl(requireRedisUrl()),
    keyPrefix,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  };

  const client = new Redis(options);

  // O ioredis reemite 'error' a cada tentativa de reconexao (varias por segundo
  // enquanto o Redis esta fora), entao logar todas afoga o log — 81 linhas em
  // 20s com dois clients — e esconde problema real. Aqui so a transicao de
  // estado e' registrada: o primeiro erro depois de uma conexao saudavel, e a
  // recuperacao quando o Redis volta.
  let degraded = false;

  client.on('error', (error) => {
    if (degraded) return;
    degraded = true;
    logger.warn(
      \`Redis cache unavailable (prefix "\${keyPrefix}"): \${describeRedisError(error)}\`,
    );
  });

  client.on('ready', () => {
    if (!degraded) return;
    degraded = false;
    logger.log(\`Redis cache reconnected (prefix "\${keyPrefix}")\`);
  });

  return client;
}

// Fecha um client no shutdown. quit() rejeita quando a conexao ja caiu (Redis
// fora do ar, ou socket encerrado no meio de uma reconexao), e essa rejeicao
// chegava a' tona como "Connection is closed" nao tratado — derrubando o
// processo de teste mesmo com todos os testes passando. Encerrar e' best-effort:
// o processo esta terminando de qualquer forma, entao o fallback e' o disconnect
// sincrono, que nao espera resposta do servidor.
export async function closeRedisClient(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

// Opcoes de conexao para o BullMQ. O proprio BullMQ gerencia retry/backoff da
// fila e exige maxRetriesPerRequest: null / enableReadyCheck: false — nao
// reaproveitar createCacheRedisClient() para filas.
export function createQueueConnectionOptions(): RedisOptions {
  return {
    ...parseRedisUrl(requireRedisUrl()),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
`;
}

function renderSessionCacheService() {
  return `import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { closeRedisClient, createCacheRedisClient } from '../redis.js';

// Cache-aside na frente do Postgres/Better-Auth. Nunca e' fonte de
// verdade: cache miss ou erro do Redis sempre cai para o Postgres em quem chama
// — este service nunca lanca excecao.
@Injectable()
export class SessionCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly client: Redis;
  private readonly ttlSeconds: number;

  constructor() {
    this.client = createCacheRedisClient('session:');
    this.ttlSeconds = Number(process.env.SESSION_CACHE_TTL_SECONDS ?? 300);
  }

  async get(sessionToken: string): Promise<string | null> {
    try {
      return await this.client.get(sessionToken);
    } catch (error) {
      this.logger.warn(
        \`Session cache read failed, falling back to Postgres: \${(error as Error).message}\`,
      );
      return null;
    }
  }

  async set(sessionToken: string, sessionPayload: string): Promise<void> {
    try {
      await this.client.set(
        sessionToken,
        sessionPayload,
        'EX',
        this.ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        \`Session cache write failed (non-fatal): \${(error as Error).message}\`,
      );
    }
  }

  // Chamado no logout, na troca e redefinicao de senha (RF-05, RF-06) e na
  // suspensao do tenant (RF-74) para que uma sessao revogada nunca seja aceita a
  // partir do cache depois que o registro no Postgres ja foi invalidado.
  async invalidate(sessionToken: string): Promise<void> {
    try {
      await this.client.del(sessionToken);
    } catch (error) {
      this.logger.warn(
        \`Session cache invalidation failed (non-fatal): \${(error as Error).message}\`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }
}
`;
}

function renderSessionCacheModule() {
  return `import { Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.service.js';

@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
`;
}

function renderRedisThrottlerStorage() {
  return `import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { closeRedisClient, createCacheRedisClient } from '../redis.js';

// ThrottlerStorageRecord existe internamente em @nestjs/throttler mas nao e' reexportado
// pelo index publico do pacote (confirmado: import quebra a compilacao em 6.5.x) — deriva-se
// o tipo do proprio contrato de ThrottlerStorage.increment() em vez de importar por nome.
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// Nomes dos throttlers registrados em rate-limit.module.ts. O storage recebe o nome em
// increment(), e e' assim que ele distingue as rotas sensiveis (fail-closed) das demais.
export const DEFAULT_THROTTLER_NAME = 'default';
export const SENSITIVE_THROTTLER_NAME = 'sensitive';

// Store distribuido de rate limit (RF-81: por IP e por usuario, mais restrito em
// /api/auth/*, upload e importacao) — necessario porque apps/api roda em multiplas
// instancias e um contador em memoria nao seria compartilhado entre elas.
//
// Politica de degradacao com o Redis fora do ar (nao definida no PRD; confirmar na spec
// de RF-81 e levar ao PRD):
//   - rotas comuns: FAIL-OPEN — deixa passar, sem 503 global;
//   - rotas sensiveis: FAIL-CLOSED — recusa com 503, para o login nunca ficar sem o
//     bloqueio progressivo contra forca bruta.
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly client: Redis;

  constructor() {
    this.client = createCacheRedisClient('throttle:');
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const storageKey = \`\${throttlerName}:\${key}\`;
      const blockKey = \`\${throttlerName}:block:\${key}\`;

      const blockTtl = await this.client.pttl(blockKey);
      if (blockTtl > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: Math.ceil(blockTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockTtl / 1000),
        };
      }

      const totalHits = await this.client.incr(storageKey);
      if (totalHits === 1) {
        await this.client.pexpire(storageKey, ttl);
      }
      const timeToExpire = await this.client.pttl(storageKey);

      if (totalHits > limit) {
        await this.client.set(blockKey, '1', 'PX', blockDuration);
        return {
          totalHits,
          timeToExpire: Math.ceil(Math.max(timeToExpire, 0) / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockDuration / 1000),
        };
      }

      return {
        totalHits,
        timeToExpire: Math.ceil(Math.max(timeToExpire, 0) / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      if (throttlerName === SENSITIVE_THROTTLER_NAME) {
        this.logger.error(
          \`Rate limit check failed for a sensitive route, failing closed: \${(error as Error).message}\`,
        );
        throw new ServiceUnavailableException({
          error: 'Service Unavailable',
          code: 'RATE_LIMIT_UNAVAILABLE',
        });
      }

      this.logger.warn(
        \`Rate limit check failed, failing open: \${(error as Error).message}\`,
      );
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  // Sem fechar o client no shutdown, o ioredis deixa reconexao pendente e o
  // processo morre com "Connection is closed" como rejeicao nao tratada — o que
  // fazia o suite e2e falhar de forma intermitente mesmo com o teste passando.
  async onModuleDestroy(): Promise<void> {
    await closeRedisClient(this.client);
  }
}
`;
}

function renderRateLimitModule() {
  return `import { ExecutionContext, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  DEFAULT_THROTTLER_NAME,
  RedisThrottlerStorage,
  SENSITIVE_THROTTLER_NAME,
} from './redis-throttler.storage.js';

// Prefixos das rotas com limite mais restrito (RF-81). Upload e importacao entram
// aqui junto com as specs que criam essas rotas.
const SENSITIVE_ROUTE_PREFIXES = ['/api/auth'];

const isSensitiveRoute = (context: ExecutionContext): boolean => {
  const request = context.switchToHttp().getRequest<Request>();
  const url = request.originalUrl ?? request.url;
  return SENSITIVE_ROUTE_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(\`\${prefix}/\`) || url.startsWith(\`\${prefix}?\`),
  );
};

// Registra o storage Redis do throttler (RF-81), mas nao aplica um guard global:
// aplique @UseGuards(ThrottlerGuard) explicitamente nos controllers cobertos pela
// spec de RF-81. O 429 do throttler ainda precisa ser mapeado para o contrato de
// erro do PRD (code RATE_LIMITED, Retry-After, message traduzida) nessa spec.
//
// Dois throttlers nomeados, cada um com skipIf, para que a politica de falha do
// storage dependa da rota sem o storage conhecer URLs:
//   - "default": rotas comuns, pula as sensiveis;
//   - "sensitive": so as rotas sensiveis, com limite proprio mais restrito.
//
// forRootAsync + useFactory adia a construcao do client Redis (e a leitura de
// REDIS_URL) para a inicializacao do modulo, em vez do momento em que o decorator
// @Module e' avaliado — mesmo padrao do QueueModule.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [],
      useFactory: () => ({
        throttlers: [
          {
            name: DEFAULT_THROTTLER_NAME,
            ttl: 60000,
            limit: 60,
            skipIf: isSensitiveRoute,
          },
          {
            name: SENSITIVE_THROTTLER_NAME,
            ttl: 60000,
            limit: 10,
            skipIf: (context: ExecutionContext) => !isSensitiveRoute(context),
          },
        ],
        storage: new RedisThrottlerStorage(),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
`;
}

function renderQueueModule() {
  return `import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { createQueueConnectionOptions } from '../lib/redis.js';

// Fila de execucao assincrona (PRD 6.2): importacao, recalculo de status de
// mesa, exportacao, e-mails e webhooks rodam aqui como jobs, nunca de forma
// sincrona dentro de um handler HTTP. Todo job carrega o tenantId no payload
// assinado pelo produtor e restabelece o TenantContext antes de acessar dado
// (PRD 3.2). Jobs com falha sao reprocessados com backoff exponencial; falha
// permanente (apos QUEUE_MAX_ATTEMPTS) fica registrada para observabilidade
// (RF-84), nunca silenciosa.
//
// Filas concretas sao registradas por submodulos importados abaixo (um por
// "--queue <nome>" rodado nesta skill) — nao adicione registerQueue() direto
// aqui, para nao conflitar com a injecao automatica de imports desta skill.
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: createQueueConnectionOptions(),
        defaultJobOptions: {
          attempts: Number(process.env.QUEUE_MAX_ATTEMPTS ?? 5),
          backoff: {
            type: 'exponential',
            delay: Number(process.env.QUEUE_BACKOFF_DELAY_MS ?? 2000),
          },
          removeOnComplete: true,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
`;
}

function renderEnqueueJob() {
  return `import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';

const logger = new Logger('QueueProducer');

// Enfileiramento NUNCA fail-open: com a fila indisponivel, o handler do webhook do
// Stripe precisa responder erro para o Stripe reenviar o evento, e uma importacao
// precisa falhar visivel em vez de sumir. Por isso uma falha de enqueue vira 503 (nao
// null): engolir o erro faria o handler dar ack 200 e o evento se perderia sem rastro.
// A message traduzida do contrato de erro (RF-63) entra com o ExceptionFilter global.
//
// Queue<T, unknown, string, T, unknown, string> (nao Queue<T> sozinho): em bullmq, o
// generico NameType efetivamente usado por Queue e' o SEXTO parametro de tipo — o terceiro
// (DefaultNameType) so alimenta ExtractNameType<DataTypeOrJob, DefaultNameType>, que fica
// deferido/nao resolvido quando DataTypeOrJob e' o proprio T generico de enqueueJob (nao
// um tipo concreto), entao TypeScript nao consegue provar que 'string' e' atribuivel a esse
// tipo. So fixar o terceiro parametro NAO resolve — e' necessario fixar o sexto (NameType)
// tambem.
export async function enqueueJob<T>(
  queue: Queue<T, unknown, string, T, unknown, string>,
  name: string,
  data: T,
  opts?: JobsOptions,
) {
  try {
    return await queue.add(name, data, opts);
  } catch (error) {
    logger.error(
      \`Failed to enqueue job "\${name}" on queue "\${queue.name}": \${(error as Error).message}\`,
    );
    throw new ServiceUnavailableException({
      error: 'Service Unavailable',
      code: 'QUEUE_UNAVAILABLE',
    });
  }
}
`;
}

function renderQueueSubModule(queueName, className) {
  return `import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ${className}Processor } from './${queueName}.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: '${queueName}' })],
  providers: [${className}Processor],
  exports: [BullModule],
})
export class ${className}QueueModule {}
`;
}

function renderQueueProcessor(queueName, className) {
  return `import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

@Processor('${queueName}')
export class ${className}Processor extends WorkerHost {
  private readonly logger = new Logger(${className}Processor.name);

  async process(job: Job): Promise<void> {
    // TODO: implementar o workflow "${queueName}" a partir da spec que criou a fila,
    // restabelecendo o TenantContext do payload antes de qualquer acesso a dado (PRD 3.2).
    this.logger.log(\`Processing job \${job.id} on queue "${queueName}"\`);
  }

  // Falha permanente (apos QUEUE_MAX_ATTEMPTS) fica registrada para
  // observabilidade (RF-84), nunca silenciosa. Tentativa intermediaria, que
  // ainda sera reprocessada com backoff exponencial, entra como warning.
  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    const maxAttempts = job?.opts.attempts ?? Number(process.env.QUEUE_MAX_ATTEMPTS ?? 5);
    const attemptsMade = job?.attemptsMade ?? 0;
    const context = \`job \${job?.id ?? 'unknown'} on queue "${queueName}" (attempt \${attemptsMade}/\${maxAttempts}): \${error.message}\`;

    if (attemptsMade >= maxAttempts) {
      this.logger.error(\`Permanent failure for \${context}\`, error.stack);
      return;
    }

    this.logger.warn(\`Retryable failure for \${context}\`);
  }
}
`;
}

async function runInstall(rootDir, backendWorkspace, ops) {
  // 'pnpm install --workspace <name>' NAO existe como forma de escopar a um pacote: pnpm
  // trata 'install <nome>' como alias de 'add <nome>' e '--workspace' sozinho nao filtra
  // nada — confirmado rodando de verdade (workspace descartavel) que isso adiciona
  // <backendWorkspace> como dependencia do package.json da RAIZ, nao instala nada no
  // backend. A forma correta e '--filter <nome>' antes do subcomando (mesmo fix aplicado
  // em ../config-prisma/scripts/init-prisma-backend.js).
  const { ensurePnpmAllowBuilds } = await import('../../utils/ensure-pnpm-allow-builds.mjs');
  const allowBuilds = await ensurePnpmAllowBuilds({ rootDir, names: ['msgpackr-extract'], ops });
  if (allowBuilds.updated) {
    console.log('Updated pnpm-workspace.yaml allowBuilds (pnpm 11 exige aprovacao de builds nativos).');
  }
  await ops.runCommand('pnpm', ['--filter', backendWorkspace, 'install'], rootDir);
}

async function runStartRedis(backendDir, ops) {
  await ops.runCommand('docker', ['compose', 'up', '-d', 'redis'], backendDir);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  await loadSkillLoggingUtils();
  await loadSkillConfigUtils();

  const rootDir = detectProjectRoot(process.cwd());
  const skillConfig = await loadSkillConfig(rootDir);
  const backendAppPath = skillConfig.defaults.backendAppPath || BACKEND_WORKSPACE;
  const projectName = resolveProjectName(skillConfig.defaults.namespace);
  const backendDir = path.join(rootDir, backendAppPath);
  if (!fs.existsSync(path.join(backendDir, 'package.json'))) {
    throw new Error(
      `Backend workspace not found at "${backendAppPath}" (missing package.json). ` +
        'If the backend lives elsewhere, set "backendAppPath" in skills.config.json.',
    );
  }

  const logger = await createSkillRunLogger({
    rootDir,
    skillName: 'config-redis',
    commandArgs: process.argv.slice(2),
  });
  const ops = createSkillRunOps({
    rootDir,
    logger,
    dryRun: args.dryRun,
  });

  try {
    const backendPackageJson = await readBackendPackageJson(backendDir);
    const backendWorkspace = backendPackageJson.name || backendAppPath;
    const redisConfig = await resolveRedisConfig(backendDir);
    if (redisConfig.foreignKeys.length > 0) {
      logger.risk(
        `${redisConfig.foreignKeys.join(', ')} encontrado(s) no .env: topologia de duas instancias, fora do PRD do Hypomna (§6.2/§7 usam so ${REDIS_URL_KEY}) — remova depois de conferir.`,
      );
    }

    const ctx = {
      rootDir,
      dryRun: args.dryRun,
      changes: [],
      ops,
    };

    const libDir = path.join(backendDir, 'src', 'lib');
    const sessionCacheDir = path.join(libDir, 'session-cache');
    const rateLimitDir = path.join(libDir, 'rate-limit');
    const queueDir = path.join(backendDir, 'src', 'queue');

    await ensureDir(libDir, ctx);
    await ensureDir(sessionCacheDir, ctx);
    await ensureDir(rateLimitDir, ctx);
    await ensureDir(queueDir, ctx);

    await ensureBackendPackageJsonForRedis(backendDir, ctx);
    await ensureEnvFilesForRedis(backendDir, redisConfig, ctx);
    await ensureDockerComposeHasRedis(backendDir, redisConfig, ctx, logger, rootDir, projectName);

    await writeFileIfChanged(path.join(libDir, 'redis.ts'), renderRedisLibFile(), ctx);
    await writeFileIfChanged(path.join(sessionCacheDir, 'session-cache.service.ts'), renderSessionCacheService(), ctx);
    await writeFileIfChanged(path.join(sessionCacheDir, 'session-cache.module.ts'), renderSessionCacheModule(), ctx);
    await writeFileIfChanged(path.join(rateLimitDir, 'redis-throttler.storage.ts'), renderRedisThrottlerStorage(), ctx);
    await writeFileIfChanged(path.join(rateLimitDir, 'rate-limit.module.ts'), renderRateLimitModule(), ctx);
    await writeFileIfChanged(path.join(queueDir, 'enqueue-job.ts'), renderEnqueueJob(), ctx);

    // queue.module.ts so e' criado uma vez: depois disso, cada "--queue" so
    // injeta seu proprio submodulo no array de imports (nunca reescreve o
    // arquivo inteiro), do mesmo jeito que a config-prisma trata app.module.ts.
    const queueModulePath = path.join(queueDir, 'queue.module.ts');
    if (!fs.existsSync(queueModulePath)) {
      await writeFileIfChanged(queueModulePath, renderQueueModule(), ctx);
    }

    const queueNames = new Set(args.queues.filter(Boolean));
    for (const queueName of queueNames) {
      const className = toPascalCase(queueName);
      const queueSubDir = path.join(queueDir, queueName);
      const processorPath = path.join(queueSubDir, `${queueName}.processor.ts`);
      const subModulePath = path.join(queueSubDir, `${queueName}.module.ts`);

      await ensureDir(queueSubDir, ctx);

      // Processor e submodulo carregam TODO/logica de negocio a ser preenchida
      // depois — criados uma unica vez, nunca sobrescritos em reexecucoes.
      if (!fs.existsSync(processorPath)) {
        await writeFileIfChanged(processorPath, renderQueueProcessor(queueName, className), ctx);
      }
      if (!fs.existsSync(subModulePath)) {
        await writeFileIfChanged(subModulePath, renderQueueSubModule(queueName, className), ctx);
      }

      await ensureClassImportedInArray(
        queueModulePath,
        {
          className: `${className}QueueModule`,
          importPath: `./${queueName}/${queueName}.module.js`,
          arrayKey: 'imports',
        },
        ctx,
      );
    }

    const appModulePath = path.join(backendDir, 'src', 'app.module.ts');
    await ensureClassImportedInArray(
      appModulePath,
      {
        className: 'SessionCacheModule',
        importPath: './lib/session-cache/session-cache.module.js',
        arrayKey: 'imports',
      },
      ctx,
    );
    await ensureClassImportedInArray(
      appModulePath,
      { className: 'RateLimitModule', importPath: './lib/rate-limit/rate-limit.module.js', arrayKey: 'imports' },
      ctx,
    );
    await ensureClassImportedInArray(
      appModulePath,
      { className: 'QueueModule', importPath: './queue/queue.module.js', arrayKey: 'imports' },
      ctx,
    );

    if (ctx.changes.length === 0) {
      console.log('No changes required. Redis init is already up to date.');
      logger.step('Nenhuma alteracao necessaria (estado convergente).');
    } else {
      const modeLabel = args.dryRun ? 'Dry-run changes' : 'Applied changes';
      console.log(`\n${modeLabel}:`);
      logger.step(`${modeLabel}: ${ctx.changes.length} alteracoes.`);
      for (const change of ctx.changes) {
        console.log(`- ${change}`);
        logger.step(change, 'CHANGE');
      }
    }

    if (args.install) {
      if (args.dryRun) {
        console.log('\nDry-run: skipped dependency installation.');
        logger.step('Instalacao ignorada em dry-run.');
      } else {
        console.log('\nInstalling backend dependencies...');
        await runInstall(rootDir, backendWorkspace, ops);
        console.log('Backend dependencies installed successfully.');
      }
    }

    if (args.startRedis) {
      if (args.dryRun) {
        console.log('\nDry-run: skipped docker compose up.');
        logger.step('Subida do redis ignorada em dry-run.');
      } else {
        console.log('\nStarting redis with docker compose...');
        await runStartRedis(backendDir, ops);
        console.log('Redis started successfully.');
      }
    }

    if (args.dryRun) {
      console.log('\nRun again with --apply to persist these changes.');
      logger.step('Dry-run concluido. Execute com --apply para persistir.');
    }

    await logger.success();
  } catch (error) {
    await logger.failure(error);
    throw error;
  }
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exit(1);
});
