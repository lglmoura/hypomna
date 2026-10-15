import { promises as fs } from 'node:fs';
import path from 'node:path';

// pnpm 11 aborta o install com ERR_PNPM_IGNORED_BUILDS quando um pacote com script de build
// nativo (prisma, msgpackr-extract, ...) nao esta em `allowBuilds` no pnpm-workspace.yaml, e grava
// o placeholder "set this to true or false" para cada um. As skills que rodam `--install`
// (config-prisma, config-redis, config-auth) chamam esta funcao antes: pre-aprova os pacotes que
// elas mesmas adicionam e resolve placeholders ja gravados — mesma regra que a config-project
// aplica no bootstrap (ensureWorkspaceAllowedBuilds).
const PLACEHOLDER = 'set this to true or false';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quoteKey = (name) => (/^[a-z0-9-]+$/.test(name) ? name : `'${name}'`);

export async function ensurePnpmAllowBuilds({ rootDir, names = [], ops }) {
  const filePath = path.join(rootDir, 'pnpm-workspace.yaml');

  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { updated: false, added: [], resolvedPlaceholders: 0 };
    }
    throw error;
  }

  const placeholderPattern = new RegExp(`(:\\s*)${PLACEHOLDER}`, 'g');
  const resolvedPlaceholders = (content.match(placeholderPattern) || []).length;
  let next = content.replace(placeholderPattern, '$1true');

  const missing = names.filter((name) => !new RegExp(`^\\s{2}['"]?${escapeRegExp(name)}['"]?:`, 'm').test(next));
  if (missing.length > 0) {
    const lines = missing.map((name) => `  ${quoteKey(name)}: true\n`).join('');
    if (/^allowBuilds:[ \t]*\r?\n/m.test(next)) {
      next = next.replace(/^allowBuilds:[ \t]*\r?\n/m, (match) => `${match}${lines}`);
    } else {
      next = `${next.replace(/\s*$/, '\n')}allowBuilds:\n${lines}`;
    }
  }

  if (next === content) {
    return { updated: false, added: [], resolvedPlaceholders: 0 };
  }

  await ops.writeTextFile(filePath, next, { ensureNewline: true, markRiskOnOverwrite: true });
  return { updated: true, added: missing, resolvedPlaceholders };
}
