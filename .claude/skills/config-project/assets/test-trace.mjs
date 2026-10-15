#!/usr/bin/env node
// Rastreabilidade PRD ↔ testes (RF-86, PRD §7.1).
//
// Compara os cenários de aceite do PRD (`**CA-RF<nn>-<k>**`) com os testes do monorepo: tags `@CA-RF<nn>-<k>` nos
// `.feature` e o ID no título dos testes (`it('CA-RF99-1 …')`, para testes fora do `.feature`).
//
// Uso:
//   pnpm test:trace             relatório; sai com 0
//   pnpm test:trace --strict    falha se um RF entregue tiver cenário sem teste, ou se um teste citar um ID que o PRD não tem
//   pnpm test:trace --verbose   também lista, por RF, os cenários pendentes de RFs ainda não entregues
//   pnpm test:trace --prd <caminho do PRD>
//
// "Entregue" é o que a coluna "Testes" da §11 do PRD diz: preenchida com qualquer coisa diferente de `—`, `-` ou
// `_(a criar …)_`.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const verbose = args.includes('--verbose');
const prdFlag = args.indexOf('--prd');
const PRD_CANDIDATES = prdFlag >= 0 ? [args[prdFlag + 1]] : ['.docs/PRD.md', 'docs/PRD.md'];

const ROOT = process.cwd();
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.expo',
  'build',
  'coverage',
  '.turbo',
  '.git',
  '.docs',
  '.claude',
  '.log',
]);
const TEST_FILE = /\.(?:feature|(?:e2e-)?spec\.[cm]?[jt]sx?|test\.[cm]?[jt]sx?)$/;

const key = (rf, scenario) => `CA-RF${Number(rf)}-${Number(scenario)}`;
const label = (id) => id.replace(/^CA-RF(\d+)-/, (_, n) => `CA-RF${String(n).padStart(2, '0')}-`);
const rfOf = (id) => Number(/^CA-RF(\d+)-/.exec(id)[1]);
const rfLabel = (n) => `RF-${String(n).padStart(2, '0')}`;

async function readPrd() {
  for (const candidate of PRD_CANDIDATES) {
    try {
      return { file: candidate, text: await readFile(path.resolve(ROOT, candidate), 'utf8') };
    } catch {
      // tenta o próximo caminho
    }
  }
  console.error(`PRD não encontrado (procurei em: ${PRD_CANDIDATES.join(', ')}). Use --prd <caminho>.`);
  process.exit(2);
}

function expandRfs(cell) {
  const rfs = new Set();
  for (const part of cell.split(',')) {
    const range = /RF-(\d+)\s+a\s+RF-(\d+)/.exec(part);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) rfs.add(n);
      continue;
    }
    const single = /RF-(\d+)/.exec(part);
    if (single) rfs.add(Number(single[1]));
  }
  return rfs;
}

const PENDING_TESTS_CELLS = new Set(['', '—', '-']);
const isDeliveredTestsCell = (cell) => !PENDING_TESTS_CELLS.has(cell) && !cell.startsWith('_(a criar');

function deliveredRfs(prd) {
  const start = prd.search(/^## 11\. /m);
  if (start < 0) return new Set();
  const section = prd.slice(start).split(/^## 12\. /m)[0];
  const rows = section.split('\n').filter((line) => line.startsWith('|'));
  const header = rows.find((line) => /\|\s*Testes\s*\|/.test(line));
  if (!header) return new Set();

  const cells = (line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const testsColumn = cells(header).indexOf('Testes');
  const delivered = new Set();
  for (const row of rows) {
    if (row === header || /^\|\s*-+/.test(row)) continue;
    const columns = cells(row);
    const tests = columns[testsColumn] ?? '';
    if (isDeliveredTestsCell(tests)) {
      for (const rf of expandRfs(columns[0])) delivered.add(rf);
    }
  }
  return delivered;
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (TEST_FILE.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

async function collectTests() {
  const found = new Map();
  for await (const file of walk(ROOT)) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/CA-RF(\d+)-(\d+)/g)) {
      const id = key(match[1], match[2]);
      if (!found.has(id)) found.set(id, new Set());
      found.get(id).add(path.relative(ROOT, file));
    }
  }
  return found;
}

function groupByRf(ids) {
  const groups = new Map();
  for (const id of ids) {
    const rf = rfOf(id);
    if (!groups.has(rf)) groups.set(rf, []);
    groups.get(rf).push(label(id));
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

const { file: prdFile, text: prd } = await readPrd();
const prdIds = [...new Set([...prd.matchAll(/\*\*CA-RF(\d+)-(\d+)\*\*/g)].map((m) => key(m[1], m[2])))];
const prdSet = new Set(prdIds);
const delivered = deliveredRfs(prd);
const tested = await collectTests();

const withTest = prdIds.filter((id) => tested.has(id));
const missing = prdIds.filter((id) => !tested.has(id));
const missingDelivered = missing.filter((id) => delivered.has(rfOf(id)));
const missingPending = missing.filter((id) => !delivered.has(rfOf(id)));
const orphans = [...tested.keys()].filter((id) => !prdSet.has(id));

console.log(`PRD: ${prdFile}`);
console.log(
  `${prdIds.length} cenários, ${withTest.length} com teste, ${missing.length} sem teste; ` +
    `${delivered.size} RFs marcados como entregues na §11.`,
);

if (missingDelivered.length > 0) {
  console.log(`\nSem teste em RF entregue (${missingDelivered.length}) — falha em --strict:`);
  for (const [rf, ids] of groupByRf(missingDelivered)) console.log(`  ${rfLabel(rf)}: ${ids.join(', ')}`);
}

if (orphans.length > 0) {
  console.log(`\nTeste com ID que o PRD não tem (${orphans.length}) — falha em --strict:`);
  for (const id of orphans) console.log(`  ${label(id)} — ${[...tested.get(id)].join(', ')}`);
}

if (missingPending.length > 0) {
  const groups = groupByRf(missingPending);
  console.log(
    `\nPendentes de RFs ainda não entregues: ${missingPending.length} cenário(s) em ${groups.length} RF(s) — só relatório` +
      (verbose ? ':' : ' (use --verbose para listar).'),
  );
  if (verbose) for (const [rf, ids] of groups) console.log(`  ${rfLabel(rf)}: ${ids.join(', ')}`);
}

const failed = strict && (missingDelivered.length > 0 || orphans.length > 0);
if (failed) console.log('\ntest:trace --strict: divergência entre o PRD e os testes.');
process.exit(failed ? 1 : 0);
