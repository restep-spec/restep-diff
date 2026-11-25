// Tests for restep-diff.
//   node tools/restep-diff/test.mjs            (from projects/restep)
//   node tools/restep-diff/test.mjs filter     (only the cases whose name contains "filter")
// 1. Each pair in fixtures/cases.json gives exactly the rules it expects, and together they cover every rule.
// 2. The CLI: formats, --fail-on, --date, usage errors.
// 3. The reference server against a mutated copy of it (in a tmpdir), requesting the documents over HTTP.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff, RULES } from './restep-diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'restep-diff.mjs');
const SERVER = readFileSync(join(here, 'vendor/restep-server.mjs'), 'utf8');
const PORTS = [8820, 8821]; // assigned range: 8820-8829
const DATE = '2026-11-20T00:00:00Z';
const only = process.argv[2];

let failed = 0, passed = 0;
const ok = (name) => { passed++; console.log(`ok     ${name}`); };
const fail = (name, why) => { failed++; console.log(`FAIL   ${name}: ${why}`); };
const check = (name, why) => (why ? fail(name, why) : ok(name));

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function mergePatch(target, patch) { // RFC 7396
  if (!isObject(patch)) return structuredClone(patch);
  const out = isObject(target) ? structuredClone(target) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = mergePatch(out[k], v);
  }
  return out;
}
const setDiff = (got, want) => {
  const extra = [...got].filter((r) => !want.has(r)), missing = [...want].filter((r) => !got.has(r));
  return extra.length || missing.length ? `${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `unexpected ${extra.join(', ')}` : ''}` : null;
};

// ── 1. Fixture pairs ─────────────────────────────────────────────────────
const base = JSON.parse(readFileSync(join(here, 'fixtures/base.json'), 'utf8'));
const { cases } = JSON.parse(readFileSync(join(here, 'fixtures/cases.json'), 'utf8'));
const covered = new Set();
for (const c of cases) {
  const old = mergePatch(base, c.old ?? {}), neu = mergePatch(old, c.new ?? {});
  const changes = diff(old, neu, { now: new Date(c.date ?? DATE) });
  const got = new Set(changes.map((x) => x.rule));
  got.forEach((r) => covered.add(r));
  if (only && !c.name.includes(only)) continue;
  check(`pair: ${c.name}`, setDiff(got, new Set(c.expect)));
}
if (!only) {
  const uncovered = Object.keys(RULES).filter((r) => !covered.has(r));
  check(`the pairs cover all ${Object.keys(RULES).length} rules`, uncovered.length ? `not covered: ${uncovered.join(', ')}` : null);
  // Compare in reverse: what is compatible one way is almost always incompatible the other.
  const added = diff(base, mergePatch(base, { collections: { books: { filter: { year: { type: 'integer', ops: ['eq'] } } } } }));
  const removed = diff(mergePatch(base, { collections: { books: { filter: { year: { type: 'integer', ops: ['eq'] } } } } }), base);
  check('a new filter is compatible and removing it is not', added[0]?.severity === 'compatible' && removed[0]?.severity === 'breaking' ? null
    : `${added[0]?.severity} / ${removed[0]?.severity}`);
}

// ── 2. CLI ───────────────────────────────────────────────────────────────────
function cli(args) {
  return new Promise((done) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (code) => done({ code, out, err }));
  });
}
const dir = mkdtempSync(join(tmpdir(), 'restep-diff-'));
try {
  const write = (name, doc) => { const f = join(dir, name); writeFileSync(f, JSON.stringify(doc)); return f; };
  const B = join(here, 'fixtures/changelog-old.json');
  const N = join(here, 'fixtures/changelog-new.json');
  // Draft 7 (§5.5): discovery keeps a notice after its sunset, so these keep the one of the old document.
  const oldDoc = JSON.parse(readFileSync(B, 'utf8'));
  const deprecOnly = write('deprecation.json', mergePatch(oldDoc, { collections: { books: { deprecations: [...oldDoc.collections.books.deprecations, { kind: 'field', name: 'rating', sunset: '2027-12-01T00:00:00Z' }] } } }));
  const compatOnly = write('compatible.json', mergePatch(oldDoc, { collections: { books: { sort: [...oldDoc.collections.books.sort, 'year'] } } }));

  if (!only) {
    let r = await cli([B, N, '--date', DATE]);
    check('cli: text grouped by severity and exit 1 with breaking changes', r.code !== 1 ? `exit ${r.code}: ${r.err}`
      : !/^Breaking \(\d+\)[\s\S]*^Retirements and notices \(\d+\)[\s\S]*^Compatible \(\d+\)[\s\S]*^Other changes \(\d+\)[\s\S]*^Summary:/m.test(r.out) ? `unexpected text:\n${r.out}` : null);

    r = await cli([B, N, '--date', DATE, '--json']);
    let json = null;
    try { json = JSON.parse(r.out); } catch { /* checked below */ }
    check('cli: --json', !json ? `not JSON:\n${r.out}`
      : json.summary.breaking < 1 || json.changes.length !== Object.values(json.summary).reduce((s, n) => s + n, 0) ? `inconsistent summary: ${JSON.stringify(json.summary)}`
      : !json.changes.every((c) => RULES[c.rule] && c.location.startsWith('/') && c.links.every((l) => l.startsWith('https://w3id.org/restep/1/#'))) ? 'changes without rule, location or link'
      : null);

    r = await cli([B, N, '--date', DATE, '--markdown']);
    check('cli: --markdown', r.code !== 1 ? `exit ${r.code}` : !r.out.startsWith('## API changes') || !r.out.includes('### Breaking')
      || !r.out.includes('](https://w3id.org/restep/1/#versions)') ? `unexpected Markdown:\n${r.out}` : null);

    r = await cli([B, N, '--fail-on', 'none']);
    check('cli: --fail-on none', r.code === 0 ? null : `exit ${r.code}`);
    r = await cli([B, deprecOnly, '--date', DATE]);
    check('cli: a deprecation notice does not fail by default', r.code === 0 ? null : `exit ${r.code}`);
    r = await cli([B, deprecOnly, '--date', DATE, '--fail-on', 'deprecation']);
    check('cli: --fail-on deprecation', r.code === 1 ? null : `exit ${r.code}`);
    r = await cli([B, compatOnly, '--fail-on', 'deprecation']);
    check('cli: compatible changes do not fail', r.code === 0 ? null : `exit ${r.code}`);
    r = await cli([B, B]);
    check('cli: no changes', r.code === 0 && r.out.includes('No changes') ? null : `exit ${r.code}:\n${r.out}`);
    r = await cli([B, N, '--date', '2020-01-01T00:00:00Z', '--json']);
    const early = JSON.parse(r.out).changes.filter((c) => c.rule === 'deprecation.retired').length;
    r = await cli([B, N, '--date', DATE, '--json']);
    const late = JSON.parse(r.out).changes.filter((c) => c.rule === 'deprecation.retired').length;
    check('cli: --date decides whether a sunset has passed', early === 0 && late > 0 ? null : `retirements: ${early} before, ${late} after`);

    r = await cli([B]);
    check('cli: a single document is a usage error', r.code === 2 ? null : `exit ${r.code}`);
    r = await cli([B, N, '--fail-on', 'todo']);
    check('cli: unknown --fail-on', r.code === 2 ? null : `exit ${r.code}`);
    r = await cli([B, write('other.json', { openapi: '3.1.0' })]);
    check('cli: a JSON that is not discovery', r.code === 2 && r.err.includes('restep') ? null : `exit ${r.code}: ${r.err}`);
    r = await cli([B, join(dir, 'missing.json')]);
    check('cli: missing file', r.code === 2 ? null : `exit ${r.code}`);
    r = await cli(['--rules', '--markdown']);
    const readme = readFileSync(join(here, 'README.md'), 'utf8').match(/<!-- rules -->\n([\s\S]*?)\n<!-- \/rules -->/)?.[1];
    check('README: the rules table is up to date', readme === r.out.trimEnd() ? null : 'regenerate it with --rules --markdown');
    r = await cli(['--rules', '--json']);
    check('cli: --rules', r.code === 0 && JSON.parse(r.out).length === Object.keys(RULES).length ? null : `exit ${r.code}`);
  }

  // ── 3. Reference server against a mutated copy ────────────────────
  // [server text, replacement]: each must appear exactly once.
  const MUTATIONS = [
    // books: sorting by year is no longer possible
    ["sort: ['id', 'title', 'price', 'rating', 'year', 'reviews.rating'],", "sort: ['id', 'title', 'price', 'rating', 'reviews.rating'],"],
    // books: year becomes required (in create and in item, and no longer admits null)
    ["required: ['title', 'price'],", "required: ['title', 'price', 'year'],"],
    // books: max_limit goes down from 50 to 20
    ["    max_limit: 50,\n    count: 'exact',\n    // 5.5: sorting by year", "    max_limit: 20,\n    count: 'exact',\n    // 5.5: sorting by year"],
    // books: one more category
    ["'poesia', 'infantil'] },", "'poesia', 'infantil', 'comic'] },"],
    // categories: its items no longer admit DELETE
    ["methods: ['GET', 'POST'], item_methods: ['GET', 'PATCH', 'DELETE'],\n    id_from: 'either',",
      "methods: ['GET', 'POST'], item_methods: ['GET', 'PATCH'],\n    id_from: 'either',"],
    // books: rating can also be filtered with le
    ["rating: ['ge', 'null'],", "rating: ['ge', 'null', 'le'],"],
    // categories: the collation of name goes from server to codepoint (§6.1)
    ["unique: ['name'],\n    collations: { name: 'server' },", "unique: ['name'],\n    collations: { name: 'codepoint' },"],
    // categories: the client has to choose the id (§5.1)
    ["    id_from: 'either',", "    id_from: 'client',"],
    // books: highlight can no longer be expanded with include (9)
    ["highlight: { to: 'reviews', include: true },", "highlight: { to: 'reviews' },"],
    // products: restock becomes idempotent (11.1, table in 5.5)
    ["restock: { on: 'item', safe: false, idempotent: false,", "restock: { on: 'item', safe: false, idempotent: true,"],
    // reviews, a subcollection: hangs from another variable with another name (the same URL) and gains include_depth
    ["include_depth: 2,", "include_depth: 3,"],
    // shop, a singleton (§5.9): no longer admits PATCH
    ["  methods: ['GET', 'PATCH'],\n  types: { name: 'string', email:", "  methods: ['GET'],\n  types: { name: 'string', email:"],
  ];
  const EXPECTED = {
    'sort.removed': '/collections/books/sort',
    // update too: the server only admits null in fields that are not required
    'input.type-narrowed': ['/collections/books/schemas/create/properties/year', '/collections/books/schemas/update/properties/year'],
    'field.type': '/collections/books/schemas/item/properties/year',
    'max-limit.lower': '/collections/books/max_limit',
    'filter.values-added': '/collections/books/filter/category/values',
    'field.enum-added': '/collections/books/schemas/item/properties/category',
    'input.enum-added': ['/collections/books/schemas/create/properties/category', '/collections/books/schemas/update/properties/category'],
    'filter.op-added': '/collections/books/filter/rating/ops',
    'collation.named': '/collections/categories/collations/name',
    'relation.include-removed': '/collections/books/relations/highlight/include',
    'action.stronger': '/collections/products/actions/restock/idempotent',
    'include-depth.higher': '/collections/products/include_depth',
    'id-from.changed': '/collections/categories/id_from',
    'input.now-required': ['/collections/books/schemas/create/properties/year', '/collections/categories/schemas/create/properties/id'],
    'method.removed': ['/collections/categories/item_methods', '/singletons/shop/methods'],
  };
  if (!only || 'server'.includes(only)) {
    let src = SERVER;
    for (const [from, to] of MUTATIONS) {
      if (src.split(from).length !== 2) throw new Error(`The text does not appear exactly once in the server:\n${from}`);
      src = src.replace(from, () => to);
    }
    const servers = [];
    const start = async (code, port) => {
      const file = join(dir, `server-${port}.mjs`);
      writeFileSync(file, code);
      const p = spawn(process.execPath, [file], { env: { ...process.env, PORT: String(port), RESTEP_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
      servers.push(p);
      await new Promise((done, ko) => { p.stdout.once('data', done); p.once('exit', () => ko(new Error(`The server did not start on port ${port}`))); });
    };
    try {
      await start(SERVER, PORTS[0]);
      await start(src, PORTS[1]);
      const [ref, mut] = PORTS.map((p) => `http://localhost:${p}/`);
      let r = await cli([ref, ref, '--json']);
      check('server: the reference against itself', r.code === 0 && JSON.parse(r.out).changes.length === 0 ? null : `exit ${r.code}: ${r.out.slice(0, 400)}${r.err}`);
      r = await cli([ref, mut, '--json', '--language', 'es']);
      const changes = r.code === 2 ? [] : JSON.parse(r.out).changes;
      const got = new Set(changes.map((c) => c.rule));
      const where = changes.filter((c) => EXPECTED[c.rule] && ![].concat(EXPECTED[c.rule]).includes(c.location)).map((c) => `${c.rule} at ${c.location}`);
      check('server: the mutated copy gives the expected changes', r.code !== 1 ? `exit ${r.code}: ${r.err}`
        : setDiff(got, new Set(Object.keys(EXPECTED))) ?? (where.length ? `unexpected locations: ${where.join('; ')}` : null));
      r = await cli([mut, ref, '--fail-on', 'none', '--json']);
      const back = JSON.parse(r.out).changes.map((c) => c.rule);
      check('server: in reverse, sort.added, max-limit.higher, method.added, filter.op-removed and collation.changed', ['sort.added', 'max-limit.higher', 'method.added', 'filter.op-removed', 'collation.changed'].every((x) => back.includes(x)) && r.code === 0
        ? null : `${r.code}: ${back.join(', ')}`);
    } finally {
      for (const p of servers) p.kill();
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} of ${passed + failed} tests fail` : `\nAll ${passed} tests pass`);
process.exit(failed ? 1 : 0);
