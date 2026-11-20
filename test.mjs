// Pruebas de restep-diff.
//   node tools/restep-diff/test.mjs            (desde projects/restep)
//   node tools/restep-diff/test.mjs filtro     (solo los casos cuyo nombre contiene «filtro»)
// 1. Cada par de fixtures/cases.json da exactamente las reglas que espera, y entre todos cubren todas las reglas.
// 2. La CLI: formatos, --fail-on, --date, errores de uso.
// 3. El servidor de referencia frente a una copia mutada de él (en un tmpdir), pidiendo los documentos por HTTP.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diff, RULES } from './restep-diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, 'restep-diff.mjs');
const SERVER = readFileSync(join(here, 'vendor/restep-server.mjs'), 'utf8');
const PORTS = [8820, 8821]; // rango asignado: 8820-8829
const DATE = '2026-11-20T00:00:00Z';
const only = process.argv[2];

let failed = 0, passed = 0;
const ok = (name) => { passed++; console.log(`ok     ${name}`); };
const fail = (name, why) => { failed++; console.log(`FALLA  ${name}: ${why}`); };
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
  return extra.length || missing.length ? `${missing.length ? `faltan ${missing.join(', ')}` : ''}${missing.length && extra.length ? '; ' : ''}${extra.length ? `sobran ${extra.join(', ')}` : ''}` : null;
};

// ── 1. Pares de fixtures ─────────────────────────────────────────────────────
const base = JSON.parse(readFileSync(join(here, 'fixtures/base.json'), 'utf8'));
const { cases } = JSON.parse(readFileSync(join(here, 'fixtures/cases.json'), 'utf8'));
const covered = new Set();
for (const c of cases) {
  const old = mergePatch(base, c.old ?? {}), neu = mergePatch(old, c.new ?? {});
  const changes = diff(old, neu, { now: new Date(c.date ?? DATE) });
  const got = new Set(changes.map((x) => x.rule));
  got.forEach((r) => covered.add(r));
  if (only && !c.name.includes(only)) continue;
  check(`par: ${c.name}`, setDiff(got, new Set(c.expect)));
}
if (!only) {
  const uncovered = Object.keys(RULES).filter((r) => !covered.has(r));
  check(`los pares cubren las ${Object.keys(RULES).length} reglas`, uncovered.length ? `sin cubrir: ${uncovered.join(', ')}` : null);
  // Comparar al revés: lo compatible en un sentido es casi siempre incompatible en el otro.
  const added = diff(base, mergePatch(base, { collections: { books: { filter: { year: { type: 'integer', ops: ['eq'] } } } } }));
  const removed = diff(mergePatch(base, { collections: { books: { filter: { year: { type: 'integer', ops: ['eq'] } } } } }), base);
  check('un filtro nuevo es compatible y quitarlo no', added[0]?.severity === 'compatible' && removed[0]?.severity === 'breaking' ? null
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
  const deprecOnly = write('deprecation.json', mergePatch(base, { collections: { books: { deprecations: [{ kind: 'field', name: 'rating', sunset: '2027-12-01T00:00:00Z' }] } } }));
  const compatOnly = write('compatible.json', mergePatch(base, { collections: { books: { sort: ['id', 'price', 'rating', 'title', 'year'] } } }));

  if (!only) {
    let r = await cli([B, N, '--date', DATE]);
    check('cli: texto agrupado por gravedad y salida 1 con incompatibles', r.code !== 1 ? `salida ${r.code}: ${r.err}`
      : !/^Incompatibles \(\d+\)[\s\S]*^Retiradas y avisos \(\d+\)[\s\S]*^Compatibles \(\d+\)[\s\S]*^Otros cambios \(\d+\)[\s\S]*^Resumen:/m.test(r.out) ? `texto inesperado:\n${r.out}` : null);

    r = await cli([B, N, '--date', DATE, '--json']);
    let json = null;
    try { json = JSON.parse(r.out); } catch { /* abajo */ }
    check('cli: --json', !json ? `no es JSON:\n${r.out}`
      : json.summary.breaking < 1 || json.changes.length !== Object.values(json.summary).reduce((s, n) => s + n, 0) ? `resumen incoherente: ${JSON.stringify(json.summary)}`
      : !json.changes.every((c) => RULES[c.rule] && c.location.startsWith('/') && c.links.every((l) => l.startsWith('https://restep.wubytes.com/es/1/#'))) ? 'cambios sin regla, ubicación o enlace'
      : null);

    r = await cli([B, N, '--date', DATE, '--markdown']);
    check('cli: --markdown', r.code !== 1 ? `salida ${r.code}` : !r.out.startsWith('## Cambios en la API') || !r.out.includes('### Incompatibles')
      || !r.out.includes('](https://restep.wubytes.com/es/1/#versiones)') ? `Markdown inesperado:\n${r.out}` : null);

    r = await cli([B, N, '--fail-on', 'none']);
    check('cli: --fail-on none', r.code === 0 ? null : `salida ${r.code}`);
    r = await cli([B, deprecOnly, '--date', DATE]);
    check('cli: un aviso de retirada no falla por defecto', r.code === 0 ? null : `salida ${r.code}`);
    r = await cli([B, deprecOnly, '--date', DATE, '--fail-on', 'deprecation']);
    check('cli: --fail-on deprecation', r.code === 1 ? null : `salida ${r.code}`);
    r = await cli([B, compatOnly, '--fail-on', 'deprecation']);
    check('cli: lo compatible no falla', r.code === 0 ? null : `salida ${r.code}`);
    r = await cli([B, B]);
    check('cli: sin cambios', r.code === 0 && r.out.includes('Sin cambios') ? null : `salida ${r.code}:\n${r.out}`);
    r = await cli([B, N, '--date', '2020-01-01T00:00:00Z', '--json']);
    const early = JSON.parse(r.out).changes.filter((c) => c.rule === 'deprecation.retired').length;
    r = await cli([B, N, '--date', DATE, '--json']);
    const late = JSON.parse(r.out).changes.filter((c) => c.rule === 'deprecation.retired').length;
    check('cli: --date decide si un sunset ya pasó', early === 0 && late > 0 ? null : `retiradas: ${early} antes, ${late} después`);

    r = await cli([B]);
    check('cli: un solo documento es error de uso', r.code === 2 ? null : `salida ${r.code}`);
    r = await cli([B, N, '--fail-on', 'todo']);
    check('cli: --fail-on desconocido', r.code === 2 ? null : `salida ${r.code}`);
    r = await cli([B, write('otro.json', { openapi: '3.1.0' })]);
    check('cli: un JSON que no es descubrimiento', r.code === 2 && r.err.includes('restep') ? null : `salida ${r.code}: ${r.err}`);
    r = await cli([B, join(dir, 'no-existe.json')]);
    check('cli: archivo que no existe', r.code === 2 ? null : `salida ${r.code}`);
    r = await cli(['--rules', '--markdown']);
    const readme = readFileSync(join(here, 'README.md'), 'utf8').match(/<!-- reglas -->\n([\s\S]*?)\n<!-- \/reglas -->/)?.[1];
    check('README: la tabla de reglas está al día', readme === r.out.trimEnd() ? null : 'regenérala con --rules --markdown');
    r = await cli(['--rules', '--json']);
    check('cli: --rules', r.code === 0 && JSON.parse(r.out).length === Object.keys(RULES).length ? null : `salida ${r.code}`);
  }

  // ── 3. Servidor de referencia frente a una copia mutada ────────────────────
  // [texto del servidor, reemplazo]: cada uno tiene que aparecer exactamente una vez.
  const MUTATIONS = [
    // books: se deja de poder ordenar por year
    ["sort: ['id', 'title', 'price', 'rating', 'year'],", "sort: ['id', 'title', 'price', 'rating'],"],
    // books: year pasa a ser obligatorio (en create y en item, y deja de admitir null)
    ["required: ['title', 'price'],", "required: ['title', 'price', 'year'],"],
    // books: max_limit baja de 50 a 20
    ["    max_limit: 50,\n    count: 'exact',\n    rows: rows([\n      { id: '7',", "    max_limit: 20,\n    count: 'exact',\n    rows: rows([\n      { id: '7',"],
    // books: una categoría más
    ["'poesia', 'infantil'] },", "'poesia', 'infantil', 'comic'] },"],
    // categories: sus elementos dejan de admitir DELETE
    ["methods: ['GET', 'POST'], item_methods: ['GET', 'PATCH', 'DELETE'],\n    types: { id: 'string', name: 'string', parent:",
      "methods: ['GET', 'POST'], item_methods: ['GET', 'PATCH'],\n    types: { id: 'string', name: 'string', parent:"],
    // books: filtro nuevo por title
    ["filter: { id: ['eq', 'in'], price: ['eq', 'lt', 'le', 'gt', 'ge'], category: ['eq', 'ne', 'in'],",
      "filter: { id: ['eq', 'in'], title: ['eq'], price: ['eq', 'lt', 'le', 'gt', 'ge'], category: ['eq', 'ne', 'in'],"],
  ];
  const EXPECTED = {
    'sort.removed': '/collections/books/sort',
    'input.now-required': '/collections/books/schemas/create/properties/year',
    // update también: el servidor solo admite null en los campos que no son obligatorios
    'input.type-narrowed': ['/collections/books/schemas/create/properties/year', '/collections/books/schemas/update/properties/year'],
    'field.type': '/collections/books/schemas/item/properties/year',
    'max-limit.lower': '/collections/books/max_limit',
    'filter.values-added': '/collections/books/filter/category/values',
    'field.enum-added': '/collections/books/schemas/item/properties/category',
    'input.enum-added': ['/collections/books/schemas/create/properties/category', '/collections/books/schemas/update/properties/category'],
    'method.removed': '/collections/categories/item_methods',
    'filter.added': '/collections/books/filter/title',
  };
  if (!only || 'servidor'.includes(only)) {
    let src = SERVER;
    for (const [from, to] of MUTATIONS) {
      if (src.split(from).length !== 2) throw new Error(`El texto no aparece exactamente una vez en el servidor:\n${from}`);
      src = src.replace(from, () => to);
    }
    const servers = [];
    const start = async (code, port) => {
      const file = join(dir, `server-${port}.mjs`);
      writeFileSync(file, code);
      const p = spawn(process.execPath, [file], { env: { ...process.env, PORT: String(port), RESTEP_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
      servers.push(p);
      await new Promise((done, ko) => { p.stdout.once('data', done); p.once('exit', () => ko(new Error(`El servidor no arrancó en el puerto ${port}`))); });
    };
    try {
      await start(SERVER, PORTS[0]);
      await start(src, PORTS[1]);
      const [ref, mut] = PORTS.map((p) => `http://localhost:${p}/`);
      let r = await cli([ref, ref, '--json']);
      check('servidor: la referencia frente a sí misma', r.code === 0 && JSON.parse(r.out).changes.length === 0 ? null : `salida ${r.code}: ${r.out.slice(0, 400)}${r.err}`);
      r = await cli([ref, mut, '--json', '--language', 'es']);
      const changes = r.code === 2 ? [] : JSON.parse(r.out).changes;
      const got = new Set(changes.map((c) => c.rule));
      const where = changes.filter((c) => EXPECTED[c.rule] && ![].concat(EXPECTED[c.rule]).includes(c.location)).map((c) => `${c.rule} en ${c.location}`);
      check('servidor: la copia mutada da los cambios esperados', r.code !== 1 ? `salida ${r.code}: ${r.err}`
        : setDiff(got, new Set(Object.keys(EXPECTED))) ?? (where.length ? `ubicaciones inesperadas: ${where.join('; ')}` : null));
      r = await cli([mut, ref, '--fail-on', 'none', '--json']);
      const back = JSON.parse(r.out).changes.map((c) => c.rule);
      check('servidor: al revés, sort.added, max-limit.higher y method.added', ['sort.added', 'max-limit.higher', 'method.added', 'filter.removed'].every((x) => back.includes(x)) && r.code === 0
        ? null : `${r.code}: ${back.join(', ')}`);
    } finally {
      for (const p of servers) p.kill();
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} de ${passed + failed} pruebas fallan` : `\nLas ${passed} pruebas pasan`);
process.exit(failed ? 1 : 0);
