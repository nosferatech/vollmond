// JavaScript YAML parsers: yaml (eemeli), js-yaml 5 and js-yaml 4.
// Run: node js-yaml.mjs
import { readFileSync } from 'node:fs';
import YAML, { Parser, Scalar, isScalar } from 'yaml';
import * as jy5 from 'js-yaml';
import * as jy4 from 'js-yaml4';

const cases = JSON.parse(readFileSync(new URL('./yaml-cases.json', import.meta.url), 'utf8'));
const pkgVersion = (name) => JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
console.log(`node ${process.version}; yaml ${pkgVersion('yaml')}; js-yaml ${pkgVersion('js-yaml')}; js-yaml4 ${pkgVersion('js-yaml4')}`);

const fmt = (v) => {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number': return Object.is(v, -0) ? 'num(-0)' : Number.isNaN(v) ? 'num(NaN)' : `num(${v})`;
    case 'bigint': return `big(${v})`;
    case 'boolean': return `bool(${v})`;
    case 'string': return JSON.stringify(v);
  }
  if (v instanceof Date) return `Date(${Number.isNaN(v.getTime()) ? 'invalid' : v.toISOString()})`;
  if (v instanceof Map) return `Map{${[...v].map(([k, x]) => `${fmt(k)}=>${fmt(x)}`).join(', ')}}`;
  if (v instanceof Set) return `Set{${[...v].map(fmt).join(', ')}}`;
  if (v instanceof Uint8Array) return `bytes[${v.length}]`;
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  return `{${Object.getOwnPropertyNames(v).map((k) => `${k}: ${fmt(v[k])}`).join(', ')}}`;
};

// Each parser takes text and returns an array of documents' values, or throws.
const yamlDocs = (opts) => (text) => {
  const docs = YAML.parseAllDocuments(text, { logLevel: 'silent', ...opts });
  const list = Array.isArray(docs) ? docs : [docs];
  const out = [];
  for (const d of list) {
    if (d.errors.length) throw new Error(d.errors.map((e) => e.code).join('+'));
    out.push(d.toJS({ maxAliasCount: -1 }));
  }
  const warn = list.flatMap((d) => d.warnings.map((w) => w.code));
  if (warn.length) out.push(`warnings:${warn.join('+')}`);
  return out;
};
const jsYamlDocs = (mod, opts) => (text) => mod.loadAll(text, opts);

const parsers = {
  'yaml core': yamlDocs({}),
  'yaml core+bigint': yamlDocs({ intAsBigInt: true }),
  'yaml 1.1': yamlDocs({ version: '1.1' }),
  'js-yaml5 default': jsYamlDocs(jy5, {}),
  'js-yaml5 yaml11': jsYamlDocs(jy5, { schema: jy5.YAML11_SCHEMA }),
  'js-yaml4 default': jsYamlDocs(jy4, {}),
  'js-yaml4 core': jsYamlDocs(jy4, { schema: jy4.CORE_SCHEMA }),
};

const run = (name, text) => {
  try {
    const docs = parsers[name](text);
    return docs.length === 1 ? fmt(docs[0]) : `${docs.length} docs: ${docs.map(fmt).join(' ; ')}`;
  } catch (e) {
    return `ERROR ${String(e.message).split('\n')[0].slice(0, 70)}`;
  }
};

console.log('\n## Scalars, as the value of `v:` (one block per input)');
console.log(`columns: ${Object.keys(parsers).join(' | ')}`);
for (const s of cases.scalars) {
  const text = `v: ${s}\n`;
  const cells = Object.keys(parsers).map((name) => {
    const r = run(name, text);
    return r.startsWith('{v: ') ? r.slice(4, -1) : r;
  });
  console.log(`${JSON.stringify(s).padEnd(34)} ${cells.join(' | ')}`);
}

console.log('\n## Documents');
for (const [label, text] of Object.entries(cases.documents)) {
  console.log(`\n${label}: ${JSON.stringify(text)}`);
  for (const name of Object.keys(parsers)) console.log(`  ${name.padEnd(18)} ${run(name, text)}`);  if (label.includes('duplicate key') || label.includes('merge key')) {
    console.log(`  ${'yaml uniqueKeys:false'.padEnd(18)} ${(() => { try { return fmt(yamlDocs({ uniqueKeys: false })(text)[0]); } catch (e) { return 'ERROR ' + e.message; } })()}`);
    console.log(`  ${'yaml merge:true'.padEnd(18)} ${(() => { try { return fmt(yamlDocs({ merge: true })(text)[0]); } catch (e) { return 'ERROR ' + e.message; } })()}`);
    console.log(`  ${'js-yaml5 json:true'.padEnd(18)} ${(() => { try { return fmt(jy5.load(text, { json: true })); } catch (e) { return 'ERROR ' + String(e.message).split('\n')[0]; } })()}`);
    console.log(`  ${'js-yaml4 json:true'.padEnd(18)} ${(() => { try { return fmt(jy4.load(text, { json: true })); } catch (e) { return 'ERROR ' + String(e.message).split('\n')[0]; } })()}`);
  }
}

console.log('\n## Serializers, which strings are quoted (the strings a YAML 1.1 reader would misread)');
const risky = ['2026-10-09', '2026-10-09T08:00:00Z', 'yes', 'No', 'on', 'OFF', 'y', 'n', '1:30', '017', '0b101', '1_000', '0o17', '0x1F', '1e3', '.inf', '~', 'null', '<<', '=', 'true', '12345678901234567890', 'plain'];
const bare = (text) => text.trimEnd().slice(3);
console.log('  columns: yaml default | yaml version 1.1 | js-yaml5 dump | js-yaml4 dump');
for (const s of risky) {
  const cells = [bare(YAML.stringify({ v: s })), bare(YAML.stringify({ v: s }, { version: '1.1' })), bare(jy5.dump({ v: s })), bare(jy4.dump({ v: s }))];
  console.log(`  ${JSON.stringify(s).padEnd(24)} ${cells.join(' | ')}`);
}

console.log('\n## yaml: exact source text of a number (Scalar.source, ranges, CST)');
const src = 'a: 1.0\nb: 12345678901234567890\nc: 0x1F\nd: 1e3\ne: -0\nf: 0o17\ng: 1e400\nh: +1\ni: 017\n';
const doc = YAML.parseDocument(src);
for (const key of 'abcdefghi') {
  const node = doc.get(key, true);
  console.log(`  ${key}: value=${fmt(node.value)} source=${JSON.stringify(node.source)} range=${JSON.stringify(node.range)} slice=${JSON.stringify(src.slice(node.range[0], node.range[1]))} format=${node.format} tag=${node.tag}`);
}
console.log('  with intAsBigInt, b:', fmt(YAML.parseDocument(src, { intAsBigInt: true }).get('b')), 'source', JSON.stringify(YAML.parseDocument(src, { intAsBigInt: true }).get('b', true).source));
console.log('  CST tokens for `b`:');
for (const tok of new Parser().parse(src)) {
  if (tok.type === 'document') {
    for (const item of tok.value.items) {
      const v = item.value;
      if (v?.type === 'scalar') console.log(`    key=${item.key?.source} value.source=${JSON.stringify(v.source)} offset=${v.offset}`);
    }
  }
}
console.log('  toString() of the unchanged document:', JSON.stringify(doc.toString()));
console.log('  toString() round trip equals the source?', doc.toString() === src);
const edited = YAML.parseDocument(src);
edited.set('a', 2);
console.log('  after set(a, 2):', JSON.stringify(edited.toString()));
const edited2 = YAML.parseDocument(src);
edited2.set('a', new Scalar(12345678901234567890n));
console.log('  after set(a, Scalar(bigint)):', JSON.stringify(edited2.toString().split('\n')[0]));

console.log('\n## yaml: parse() (the convenience function) on a multi-document source and on aliases');
try { YAML.parse('a: 1\n---\nb: 2\n'); } catch (e) { console.log('  YAML.parse multi-doc throws:', e.code, e.message.split('\n')[0]); }
const aliasDoc = YAML.parseDocument('a: &x [1]\nb: *x\n');
console.log('  alias nodes visible in the AST:', (() => { let n = 0; YAML.visit(aliasDoc, { Alias() { n++; } }); return n; })());

console.log('\n## Single-document loaders on a multi-document source and on an empty source');
const single = { 'yaml parse': (t) => YAML.parse(t), 'js-yaml5 load': (t) => jy5.load(t), 'js-yaml4 load': (t) => jy4.load(t) };
for (const [name, fn] of Object.entries(single)) {
  for (const [label, text] of [['multi', 'a: 1\n---\nb: 2\n'], ['empty', ''], ['maxAliases:0 on an alias', 'a: &x [1]\nb: *x\n']]) {
    let out;
    try { out = fmt(label.startsWith('maxAliases') && name !== 'yaml parse' ? (name.startsWith('js-yaml5') ? jy5 : jy4).load(text, { maxAliases: 0 }) : fn(text)); } catch (e) { out = `ERROR ${String(e.message).split('\n')[0].slice(0, 70)}`; }
    console.log(`  ${name.padEnd(14)} ${label.padEnd(26)} ${out}`);
  }
}

console.log('\n## yaml: the document tree keeps what toJS loses');
{
  const d = YAML.parseDocument("1: a\n'1': b\ntrue: c\nnull: d\n[x, y]: e\n");
  console.log('  errors:', JSON.stringify(d.errors.map((e) => e.code)), 'toJS keys:', JSON.stringify(Object.keys(d.toJS({ mapAsMap: false }) ?? {})));
  console.log('  tree keys (typeof value, style):', d.contents.items.map((p) => (isScalar(p.key) ? `${typeof p.key.value}/${p.key.type ?? 'PLAIN'}` : 'collection')).join(', '));
  const t = YAML.parseDocument('a: !foo bar\nb: !!set {x}\nc: !!timestamp 2026-10-09\n');
  console.log('  explicit tags on the tree:', JSON.stringify(t.contents.items.map((p) => p.value.tag)), 'warnings:', JSON.stringify(t.warnings.map((w) => w.code)));
}

console.log('\n## yaml: strictness options that matter');
console.log('  uniqueKeys default errors on duplicate:', JSON.stringify(YAML.parseDocument('a: 1\na: 2\n').errors.map((e) => e.code)));
console.log('  strict:false still errors on duplicate:', JSON.stringify(YAML.parseDocument('a: 1\na: 2\n', { strict: false }).errors.map((e) => e.code)));
console.log('  schema "json" on 017 / yes / 2026-10-09:', ['017', 'yes', '2026-10-09'].map((s) => run('yaml core', `v: ${s}`)).join(' '));
for (const s of ['017', 'yes', '2026-10-09', '1e3', '.inf']) {
  const d = YAML.parseDocument(`v: ${s}\n`, { schema: 'json' });
  console.log(`    schema json, ${s}: ${d.errors.length ? 'ERROR ' + d.errors[0].code : fmt(d.toJS().v)}${d.warnings.length ? ' warning ' + d.warnings[0].code : ''}`);
}
