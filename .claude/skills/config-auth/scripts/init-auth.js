#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const DEFAULT_BETTER_AUTH_VERSION = '1.3.4';
// Fallback usado apenas se skills.config.json nao definir backendAppPath (nao deveria
// acontecer: loadSkillConfig sempre retorna um valor normalizado — ver
// utils/resolve-skill-config.mjs, que tambem resolve a lista `apps`).
const BACKEND_WORKSPACE = 'apps/api';

let createSkillRunLogger = null;
let createSkillRunOps = null;
let loadSkillConfig = null;
let resolveNamespace = null;

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
  if (loadSkillConfig && resolveNamespace) return;

  const configModule = await import('../../utils/resolve-skill-config.mjs');
  loadSkillConfig = configModule.loadSkillConfig;
  resolveNamespace = configModule.resolveNamespace;
}

function printHelp() {
  console.log(`Auth init (project-specific Better-Auth scaffolding)

Usage:
  node .claude/skills/config-auth/scripts/init-auth.js [options]

Options:
  --apply             Apply file changes (default is dry-run)
  --dry-run           Simulate changes without writing
  --install            Run pnpm install for the api and the cookie-auth client apps after file changes
  --help                Show this help
`);
}

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: false,
    install: false,
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
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.apply) {
    args.dryRun = true;
  }

  return args;
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
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;

    result[key] = normalizeEnvValue(line.slice(separatorIndex + 1));
  }
  return result;
}

function serializeEnvContent(values, preferredOrder) {
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
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeFileIfChanged(filePath, content, ctx) {
  const normalized = ensureTrailingLineBreak(content);
  const result = await ctx.ops.writeTextFile(filePath, normalized, {
    ensureNewline: false,
    markRiskOnOverwrite: true,
  });
  if (!result.changed) return false;

  ctx.changes.push(`${result.created ? 'create' : 'update'} ${toPosix(path.relative(ctx.rootDir, filePath))}`);
  return true;
}

async function ensureDir(dirPath, ctx) {
  const created = await ctx.ops.ensureDir(dirPath, { note: 'preparacao de infraestrutura auth' });
  if (!created) return;
  ctx.changes.push(`mkdir ${toPosix(path.relative(ctx.rootDir, dirPath))}`);
}

// Mesma tecnica usada pela config-prisma/config-redis para registrar um modulo
// em app.module.ts sem reescrever o arquivo inteiro — generalizada aqui para
// className/importPath/arrayKey arbitrarios.
async function ensureClassImportedInArray(filePath, { className, importPath, arrayKey }, ctx) {
  if (!fs.existsSync(filePath)) return;

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

async function ensurePackageJsonDependencies(appDir, dependencies, ctx) {
  const packageJsonPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  const raw = await fsp.readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  const parsedDependencies = parsed.dependencies || {};
  parsed.dependencies = parsedDependencies;

  for (const [name, fallbackVersion] of Object.entries(dependencies)) {
    upsertValue(parsedDependencies, name, parsedDependencies[name] || fallbackVersion);
  }

  const nextRaw = `${JSON.stringify(parsed, null, 2)}\n`;
  if (nextRaw !== raw) {
    await writeFileIfChanged(packageJsonPath, nextRaw, ctx);
  }
}

// Nomes de env vars derivados do nome do app, no padrao do PRD §7 (WEB_ADMIN_BASE_URL,
// WEB_MARKETING_BASE_URL): web -> WEB_BASE_URL; web-admin -> WEB_ADMIN_BASE_URL.
function toEnvPrefix(appName) {
  return appName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function baseUrlEnvVarFor(app) {
  return `${toEnvPrefix(app.name)}_BASE_URL`;
}

// -- apps/api: schema Prisma do Better-Auth (User/Session/Account/Verification) --
// Formato canonico da propria biblioteca (adapters/prisma) — ver docs do
// Better-Auth / skill "create-auth" para o significado de cada campo. Esta
// funcao so garante que o arquivo exista no padrao modular deste projeto
// (prisma/models/*.model.prisma, config-prisma); nao reescreve depois de criado
// porque campos adicionais (ex.: plugins do Better-Auth) podem ser somados a
// mao aqui.
function renderAuthModelPrisma() {
  return `// Modelos de identidade do Better-Auth (PRD §5: "User — so autenticacao + locale, timeZone,
// platformRole"). Gerado uma unica vez pela skill config-auth — nunca sobrescrito depois, para
// permitir campos de plugins do Better-Auth (ex.: "twoFactor" para o TOTP do Admin, RF-07) sem
// perder edicoes manuais.
// Referencia oficial: https://www.better-auth.com/docs/adapters/prisma
//
// O shape exato deste schema muda entre versoes do "better-auth". Antes da primeira migration,
// confira este arquivo contra a versao instalada com o gerador oficial (no backend, depois de
// "pnpm install"):
//   pnpm exec @better-auth/cli generate
// e ajuste manualmente aqui se houver divergencia — este arquivo nunca e' regenerado.
//
// Pendencias das specs seguintes (nao deste bootstrap):
//   - locale e timeZone (PRD §5), gravados no cadastro a partir do navegador (RF-01, RF-09);
//   - TenantMembership e TraderProfile (RF-01) e a relacao User -> Tenant;
//   - identificadores UUID v7 (PRD §5, "Restricoes"), na spec RF-00-schema.
// User nao carrega tenantId: a identidade e' anterior ao tenant, e o Admin nao pertence a
// tenant algum (PRD §3.1).

model User {
  id            String    @id
  name          String
  email         String
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]

  // Papel de plataforma: so ADMIN/SUPPORT sao papeis explicitos (PRD §3.3). O Trader e'
  // resolvido pelo TenantMembership OWNER, nunca por este campo. Sem cadastro publico de
  // ADMIN/SUPPORT (RF-07, CA-RF07-1).
  platformRole  PlatformRole?

  @@unique([email])
  @@map("user")
}

enum PlatformRole {
  ADMIN   // opera a plataforma: tenants, assinaturas, catalogos, papeis (PRD §3.3)
  SUPPORT // somente leitura de metadados de tenant (PRD §3.3)
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([token])
  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verification")
}
`;
}

// -- apps/api: src/lib/auth.ts --
// Escopo desta skill: so a fundacao (e-mail e senha como unico metodo de login, RF-03) e a
// integracao especifica deste projeto (Prisma adapter proprio, invalidacao do cache de sessao
// no logout). Verificacao de e-mail (RF-02), recuperacao e troca de senha (RF-05, RF-06), TOTP
// do Admin (RF-07), bloqueio progressivo (RF-81) e a criacao do tenant no cadastro (RF-01)
// ficam fora daqui de proposito — entram pelas specs de identidade, com as skills genericas
// do Better-Auth ("emailAndPassword", "twoFactor", "security") aplicadas por cima deste arquivo.
// O plugin "organization" nunca entra: o tenant e' o Tenant do dominio (PRD §3.1).
function renderAuthLibFile({ trustedWebApps }) {
  const webOriginLines = trustedWebApps
    .map((app) => `  process.env.${baseUrlEnvVarFor(app)},`)
    .join('\n');

  return `import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '../generated/prisma/client.js';
import { closeRedisClient, createCacheRedisClient } from './redis.js';

// auth.ts precisa ser um singleton carregado fora do container de DI do Nest
// (todo doc oficial do Better-Auth exporta \`auth\` assim), entao usa seu
// proprio PrismaClient em vez do PrismaService injetavel de src/db.
const authPrismaClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Mesmo prefixo "session:" do SessionCacheService (config-redis) — necessario para
// que a invalidacao no logout limpe a mesma chave que o SessionGuard le. Um erro
// aqui nunca deve impedir o logout de completar no Postgres.
const sessionCacheClient = createCacheRedisClient('session:');

// Este client vive no escopo do modulo (o betterAuth() abaixo precisa dele no
// databaseHooks), fora do container do Nest — entao nao tem onModuleDestroy
// proprio. O AuthModule chama isto no shutdown para nao deixar conexao aberta.
export async function closeAuthSessionCache(): Promise<void> {
  await closeRedisClient(sessionCacheClient);
}

// Origens confiaveis: os clientes web que autenticam por cookie (apps/web e apps/web-admin,
// PRD §4.1). web-marketing nao autentica ninguem e nao entra aqui.
const trustedOrigins = [
${webOriginLines}
].filter((origin): origin is string => Boolean(origin));

export const auth = betterAuth({
  baseURL: process.env.API_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(authPrismaClient, { provider: 'postgresql' }),
  // RF-03: e-mail e senha e' o unico metodo de login (sem provedor social), para o Trader
  // (apps/web) e para Admin/Suporte (apps/web-admin).
  emailAndPassword: {
    enabled: true,
  },
  // Campo do User que o PRD §5 acrescenta ao modelo do Better-Auth. input: false — o client
  // nunca pode define-lo: sem isso um cadastro poderia enviar platformRole = ADMIN (CA-RF07-1).
  user: {
    additionalFields: {
      platformRole: { type: 'string', required: false, input: false },
    },
  },
  // Invalida o cache de sessao no mesmo fluxo do logout/revogacao — nunca so por TTL
  // passivo, para nao aceitar uma sessao ja revogada no Postgres (CA-RF05-2).
  databaseHooks: {
    session: {
      delete: {
        after: async (session) => {
          await sessionCacheClient.del(session.token);
        },
      },
    },
  },
});
`;
}

// -- apps/api: src/auth/auth.controller.ts --
function renderAuthController() {
  return `import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../lib/auth.js';

// Monta o handler do Better-Auth em /api/auth/* — rota aberta por definicao (RF-04:
// /health, /docs, /openapi.json, /public/*, /api/auth/* e /webhooks/*). Nunca aplicar
// SessionGuard aqui; o rate limit mais restrito do RF-81 entra pela spec de RF-81.
@Controller('api/auth')
export class AuthController {
  private readonly handler = toNodeHandler(auth);

  @All('*')
  async handleAuth(@Req() req: Request, @Res() res: Response) {
    return this.handler(req, res);
  }
}
`;
}

// -- apps/api: src/auth/session.guard.ts --
function renderSessionGuard() {
  return `import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { getSessionCookie } from 'better-auth/cookies';
import type { Request } from 'express';
import { auth } from '../lib/auth.js';
import { SessionCacheService } from '../lib/session-cache/session-cache.service.js';

// CA-RF04-1: nega acesso (401 UNAUTHORIZED) sem sessao valida. Cache-aside na frente
// do Postgres — le o token bruto do cookie de sessao (sem tocar o banco/Redis), usa esse
// token como chave do SessionCacheService; em cache miss, valida contra o Postgres via
// auth.api.getSession() e repovoa o cache. Nunca nega acesso so por cache frio.
//
// A credencial e' so o cookie de sessao (PRD §4.1: apps/web e apps/web-admin). A message
// traduzida do contrato de erro (RF-63) entra com o ExceptionFilter global.
//
// Este guard so autentica. O TenantGuard/TenantContext (RF-04, PRD §3.2) e o AdminGuard
// (PRD §3.3) dependem dos modelos de dominio que ainda nao existem — nao estao neste escopo.

// O token de sessao do Better-Auth chega assinado no cookie ("<token>.<assinatura>", ver
// signCookieValue de better-call, possivelmente com URL-encoding), enquanto o hook de invalidacao no logout
// (databaseHooks.session.delete.after em src/lib/auth.ts) so conhece o token cru gravado
// no Postgres. A chave de cache precisa ser o token cru dos dois lados — caso contrario o
// logout apagaria uma chave que ninguem escreveu e a sessao revogada continuaria valida no
// cache ate o TTL expirar.
function toCacheKey(credential: string): string {
  let decoded = credential;
  if (decoded.includes('%')) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // credencial malformada: segue com o valor original, o Postgres decide (401).
    }
  }
  const signatureStart = decoded.lastIndexOf('.');
  return signatureStart > 0 ? decoded.slice(0, signatureStart) : decoded;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessionCache: SessionCacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const headers = fromNodeHeaders(request.headers);

    const credential = getSessionCookie(headers);
    if (!credential) {
      throw new UnauthorizedException({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    const cacheKey = toCacheKey(credential);

    const cached = await this.sessionCache.get(cacheKey);
    if (cached) {
      (request as Request & { session: unknown }).session = JSON.parse(cached);
      return true;
    }

    const session = await auth.api.getSession({ headers });
    if (!session) {
      throw new UnauthorizedException({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
      });
    }

    await this.sessionCache.set(cacheKey, JSON.stringify(session));
    (request as Request & { session: unknown }).session = session;
    return true;
  }
}
`;
}

// -- apps/api: src/auth/current-session.decorator.ts --
function renderCurrentSessionDecorator() {
  return `import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { auth } from '../lib/auth.js';
import type { Request } from 'express';

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

// Extrai a sessao anexada pelo SessionGuard — use em
// controllers protegidos por @UseGuards(SessionGuard) em vez de ler
// request.session manualmente.
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Session => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { session: Session }>();
    return request.session;
  },
);
`;
}

// -- apps/api: src/auth/auth.module.ts --
function renderAuthModule() {
  return `import { Module, OnModuleDestroy } from '@nestjs/common';
import { closeAuthSessionCache } from '../lib/auth.js';
import { SessionCacheModule } from '../lib/session-cache/session-cache.module.js';
import { AuthController } from './auth.controller.js';
import { SessionGuard } from './session.guard.js';

@Module({
  imports: [SessionCacheModule],
  controllers: [AuthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AuthModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await closeAuthSessionCache();
  }
}
`;
}

async function ensureEnvFilesForAuth(backendDir, envDefaults, ctx) {
  const envExamplePath = path.join(backendDir, '.env.example');
  const envPath = path.join(backendDir, '.env');
  const preferredOrder = [
    'DATABASE_URL',
    'REDIS_URL',
    'BETTER_AUTH_SECRET',
    ...Object.keys(envDefaults),
  ];

  for (const envFilePath of [envExamplePath, envPath]) {
    const existing = (await readEnvFile(envFilePath)) || {};
    const nextValues = { ...existing };
    let changed = false;

    for (const [key, value] of Object.entries(envDefaults)) {
      if (!(key in nextValues)) {
        nextValues[key] = value;
        changed = true;
      }
    }

    if (!changed) continue;

    await writeFileIfChanged(envFilePath, serializeEnvContent(nextValues, preferredOrder), ctx);
  }
}

async function ensureCorsCredentials(backendDir, webApps, ctx, logger, rootDir) {
  const mainTsPath = path.join(backendDir, 'src', 'main.ts');
  if (!fs.existsSync(mainTsPath)) return;

  const content = await fsp.readFile(mainTsPath, 'utf8');

  if (content.includes('credentials: true')) {
    logger.step(
      `main.ts ja configura CORS com credentials (preservado): ${toPosix(path.relative(rootDir, mainTsPath))}`,
    );
    return;
  }

  if (!content.includes('app.enableCors();')) {
    logger.risk(
      `main.ts tem uma chamada de CORS que nao e' o "app.enableCors();" padrao da config-project — ajuste manualmente para incluir { origin: [...], credentials: true } (necessario para o cookie de sessao de apps/web e apps/web-admin): ${toPosix(path.relative(rootDir, mainTsPath))}`,
    );
    return;
  }

  // CORS para os tres clientes web: web e web-admin com cookie; web-marketing consome so /public/*.
  const originLines = webApps
    .map((app) => `      process.env.${baseUrlEnvVarFor(app)} ?? 'http://localhost:${app.port}',`)
    .join('\n');
  const replacement = `app.enableCors({
    origin: [
${originLines}
    ].filter((origin): origin is string => Boolean(origin)),
    credentials: true,
  });`;

  const updated = content.replace('app.enableCors();', replacement);
  logger.risk(
    `main.ts: app.enableCors() sera atualizado com as origens dos clientes web e credentials: true (necessario para o cookie de sessao de apps/web e apps/web-admin): ${toPosix(path.relative(rootDir, mainTsPath))}`,
  );
  await writeFileIfChanged(mainTsPath, updated, ctx);
}

// -- apps/web-admin: src/lib/auth-client.ts --
function renderWebAuthClient(apiUrlEnvVar, appName) {
  return `import { createAuthClient } from 'better-auth/react';

// authClient.useSession() em Client Components; authClient.getSession() em
// Server Components (via getServerSession(), ao lado deste arquivo) — ver
// .claude/rules/auth-client.md. Nunca usar middleware para verificacao de
// sessao em ${appName}. Sessao por cookie (PRD §4.1, RF-03).
export const authClient = createAuthClient({
  baseURL: process.env.${apiUrlEnvVar},
});
`;
}

function renderWebGetServerSession(appName) {
  return `import { headers } from 'next/headers';
import { authClient } from './auth-client';

// ${appName} e apps/api sao apps separados (origens diferentes) — um Server
// Component nao tem acesso automatico ao cookie de sessao como teria um
// Better-Auth co-localizado no mesmo Next.js app, entao os headers da
// requisicao recebida precisam ser encaminhados explicitamente.
export async function getServerSession() {
  const { data } = await authClient.getSession({
    fetchOptions: { headers: await headers() },
  });
  return data;
}
`;
}

async function readWorkspaceName(appDir, fallback) {
  const pkg = JSON.parse(await fsp.readFile(path.join(appDir, 'package.json'), 'utf8'));
  return pkg.name || fallback;
}

async function runInstall(rootDir, workspaces, ops) {
  // 'pnpm install --workspace <name>' NAO existe como forma de escopar a um pacote: pnpm
  // trata 'install <nome>' como alias de 'add <nome>' e '--workspace' sozinho nao filtra
  // nada — confirmado rodando de verdade (workspace descartavel) que isso adiciona o
  // workspace como dependencia do package.json da RAIZ, uma vez por item do loop (mesmo bug
  // corrigido em ../config-prisma e ../config-redis). Forma correta: um '--filter' por
  // workspace, todos numa unica chamada de 'install' (tambem testado: nao corrompe a raiz e
  // instala so os pacotes filtrados).
  const filterArgs = workspaces.flatMap((workspace) => ['--filter', workspace]);
  const { ensurePnpmAllowBuilds } = await import('../../utils/ensure-pnpm-allow-builds.mjs');
  const allowBuilds = await ensurePnpmAllowBuilds({ rootDir, names: [], ops });
  if (allowBuilds.updated) {
    console.log('Updated pnpm-workspace.yaml allowBuilds (pnpm 11 exige aprovacao de builds nativos).');
  }
  await ops.runCommand('pnpm', [...filterArgs, 'install'], rootDir);
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
  const backendDir = path.join(rootDir, backendAppPath);

  // Apps por papel de autenticacao (skills.config.json, "apps[].auth" — PRD §4.1):
  //   cookie -> web e web-admin; none -> web-marketing.
  const configuredApps = skillConfig.defaults.apps;
  const cookieWebApps = configuredApps.filter((app) => app.kind === 'next' && app.auth === 'cookie');
  const webApps = configuredApps.filter((app) => app.kind === 'next');

  if (!fs.existsSync(path.join(backendDir, 'package.json'))) {
    throw new Error(
      `Backend workspace not found at "${backendAppPath}" (missing package.json). ` +
        'If the backend lives elsewhere, set "backendAppPath" in skills.config.json.',
    );
  }

  const logger = await createSkillRunLogger({
    rootDir,
    skillName: 'config-auth',
    commandArgs: process.argv.slice(2),
  });
  const ops = createSkillRunOps({ rootDir, logger, dryRun: args.dryRun });

  try {
    const ctx = { rootDir, dryRun: args.dryRun, changes: [], ops };

    const prismaModelsDir = path.join(backendDir, 'prisma', 'models');
    const authDir = path.join(backendDir, 'src', 'auth');
    const libDir = path.join(backendDir, 'src', 'lib');

    await ensureDir(prismaModelsDir, ctx);
    await ensureDir(authDir, ctx);
    await ensureDir(libDir, ctx);

    // Schema Prisma do Better-Auth: criado uma unica vez (nunca sobrescrito) —
    // plugins do Better-Auth (twoFactor etc.) tendem a somar campos/tabelas aqui a mao.
    const authModelPath = path.join(prismaModelsDir, 'auth.model.prisma');
    if (!fs.existsSync(authModelPath)) {
      await writeFileIfChanged(authModelPath, renderAuthModelPrisma(), ctx);
    } else if (!/^\s*model\s+User\s*\{/m.test(await fsp.readFile(authModelPath, 'utf8'))) {
      // Arquivo so com o cabecalho de comentarios (ex.: config-prisma --module auth): nao tem os
      // models de identidade, entao a skill o completa em vez de deixar o Better-Auth sem schema.
      logger.risk(
        `auth.model.prisma existe mas nao define "model User" (placeholder do config-prisma --module auth?) — sera substituido pelo schema de identidade do PRD §5: ${toPosix(path.relative(rootDir, authModelPath))}`,
      );
      await writeFileIfChanged(authModelPath, renderAuthModelPrisma(), ctx);
    }

    // Arquivos de infraestrutura: sempre re-renderizados a partir do template
    // (mesma politica de redis.ts/session-cache.* na config-redis).
    await writeFileIfChanged(
      path.join(libDir, 'auth.ts'),
      renderAuthLibFile({ trustedWebApps: cookieWebApps }),
      ctx,
    );
    await writeFileIfChanged(path.join(authDir, 'auth.controller.ts'), renderAuthController(), ctx);
    await writeFileIfChanged(path.join(authDir, 'session.guard.ts'), renderSessionGuard(), ctx);
    await writeFileIfChanged(path.join(authDir, 'current-session.decorator.ts'), renderCurrentSessionDecorator(), ctx);
    await writeFileIfChanged(path.join(authDir, 'auth.module.ts'), renderAuthModule(), ctx);

    await ensurePackageJsonDependencies(
      backendDir,
      { 'better-auth': `^${DEFAULT_BETTER_AUTH_VERSION}` },
      ctx,
    );

    const backendPort = skillConfig.defaults.backendPort || 4000;
    const envDefaults = { API_BASE_URL: `http://localhost:${backendPort}` };
    for (const app of webApps) {
      envDefaults[baseUrlEnvVarFor(app)] = `http://localhost:${app.port}`;
    }
    await ensureEnvFilesForAuth(backendDir, envDefaults, ctx);

    await ensureCorsCredentials(backendDir, webApps, ctx, logger, rootDir);

    const appModulePath = path.join(backendDir, 'src', 'app.module.ts');
    await ensureClassImportedInArray(
      appModulePath,
      { className: 'AuthModule', importPath: './auth/auth.module.js', arrayKey: 'imports' },
      ctx,
    );

    // Clientes web com sessao por cookie (web e web-admin). web-marketing (auth "none") nao
    // autentica ninguem e nao recebe client de auth.
    const installWorkspaces = [];
    installWorkspaces.push(await readWorkspaceName(backendDir, backendAppPath));

    for (const app of cookieWebApps) {
      const appDir = path.join(rootDir, app.path);
      if (!fs.existsSync(path.join(appDir, 'package.json'))) {
        logger.step(`${app.name} nao encontrado em "${app.path}" — client de auth nao gerado (rode config-project primeiro).`);
        continue;
      }

      const appLibDir = path.join(appDir, 'src', 'lib');
      await ensureDir(appLibDir, ctx);
      await writeFileIfChanged(path.join(appLibDir, 'auth-client.ts'), renderWebAuthClient(app.apiUrlEnvVar, app.name), ctx);
      await writeFileIfChanged(path.join(appLibDir, 'get-server-session.ts'), renderWebGetServerSession(app.name), ctx);
      await ensurePackageJsonDependencies(appDir, { 'better-auth': `^${DEFAULT_BETTER_AUTH_VERSION}` }, ctx);
      installWorkspaces.push(await readWorkspaceName(appDir, app.path));
    }

    if (ctx.changes.length === 0) {
      console.log('No changes required. Auth init is already up to date.');
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
        console.log('\nInstalling dependencies...');
        await runInstall(rootDir, [...new Set(installWorkspaces)], ops);
        console.log('Dependencies installed successfully.');
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
