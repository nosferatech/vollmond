// Prototypes of ways to hold a number in JavaScript, and what each does to equality, RFC 8785 canonical JSON, Ajv and sorting.
// Run: node --expose-gc js-number-representations.mjs
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { canonicalize } from 'json-canonicalize';
import * as jsonc from 'jsonc-parser';
import { parse as parseLossless } from 'lossless-json';
import { canonicalDecimal, compareDecimal, isDoubleSafe } from './decimal.mjs';

const section = (t) => console.log(`\n== ${t}`);
const row = (label, value) => console.log(`${label.padEnd(60)} ${value}`);

section('Which lexemes survive a double? (the cases an "exact only when needed" representation would wrap)');
for (const s of ['1', '1.0', '10e-1', '0.1', '9007199254740991', '9007199254740993', '12345678901234567890', '1e400', '1e-400',
  '5e-324', '0.30000000000000004', '0.3000000000000000444089209850062616169452667236328125', '123456789.123456789123456789', '-0', '2.50', '1e21', '100000000000000000000000',
  '0.10000000000000001', '1.00000000000000000000', '100000000000000000000', '0.1000000000000000055511151231257827']) {
  row(s, `${isDoubleSafe(s) ? 'double-safe' : 'NEEDS EXACT'}   canonical=${canonicalDecimal(s)}   Number()=${Number(s)}`);
}

section('How often does a tool that prints doubles with 17 significant digits produce an exact-only number?');
{
  // The rule is the number's own shortest round-trip form, so a non-shortest 17 digit print of a double is exact-only.
  let seed = 12345;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const samples = Array.from({ length: 20000 }, () => (next() * 1000) * (next() < 0.5 ? 1 : 0.001));
  const exactOnly = (print) => samples.filter((d) => !isDoubleSafe(print(d))).length;
  row('doubles drawn (pseudo-random, fixed seed)', samples.length);
  row('printed with String(d) (shortest round trip)', `${exactOnly((d) => String(d))} exact-only`);
  row('printed with d.toPrecision(17) (like printf %.17g)', `${exactOnly((d) => d.toPrecision(17))} exact-only`);
  row('printed with d.toPrecision(15)', `${exactOnly((d) => d.toPrecision(15))} exact-only`);
}

section('Plain doubles: equality and ordering silently lose information');
for (const [a, b] of [['9007199254740993', '9007199254740992'], ['12345678901234567890', '12345678901234567891'], ['1e400', '2e400'], ['0.30000000000000004', '0.3000000000000000444089209850062616169452667236328125']]) {
  row(`${a} vs ${b}`, `double equal=${Number(a) === Number(b)}   exact compare=${compareDecimal(a, b)}`);
}

section('RFC 8785 canonical JSON and the node version token (SHA-256 over JCS, 16 hex digits)');
const token = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const jcsOfDoubleView = (lexeme) => canonicalize(JSON.parse(`{"id":${lexeme}}`));
for (const s of ['9007199254740992', '9007199254740993', '12345678901234567890', '12345678901234567891', '1e400', '1.0', '1']) {
  let out;
  try { out = `${jcsOfDoubleView(s)}  token=${token(jcsOfDoubleView(s))}`; } catch (e) { out = `THROWS ${e.message}`; }
  row(s, out);
}
console.log('  (same text, same token: two different stored values share a version token if they round to the same double)');

/** JCS extended for exact numbers: a number that is double-safe uses the ECMAScript form, any other uses canonicalDecimal in a fixed rule. */
function jcsExact(lexemeValue) {
  const lex = String(lexemeValue);
  return isDoubleSafe(lex) ? canonicalize(Number(lex)) : canonicalDecimal(lex);
}
row('extended rule: 9007199254740992 / 9007199254740993', `${jcsExact('9007199254740992')} / ${jcsExact('9007199254740993')}`);
row('extended rule: 12345678901234567890 / ...891', `${jcsExact('12345678901234567890')} / ${jcsExact('12345678901234567891')}`);
row('extended rule: 1e400', jcsExact('1e400'));
row('extended rule: 1.0 and 10e-1 both become', `${jcsExact('1.0')} and ${jcsExact('10e-1')}`);

section('Ajv 8 on the candidate in-memory shapes');
const ajv = new Ajv({ strict: true, allErrors: false });
const check = (schema, data) => { const v = ajv.compile(schema); return v(data) ? 'valid' : `invalid (${v.errors[0].keyword}: ${v.errors[0].message})`; };
row('plain double 12345678901234567000, type integer', check({ type: 'integer' }, Number('12345678901234567890')));
row('plain double, maximum 9007199254740991', check({ type: 'integer', maximum: 9007199254740991 }, Number('12345678901234567890')));
row('plain double Infinity (from 1e400), type number', check({ type: 'number' }, Number('1e400')));
row('plain double 9007199254740992 vs enum [9007199254740993]', check({ enum: [JSON.parse('9007199254740993')] }, JSON.parse('9007199254740992')));
row('plain double, const 9007199254740993, data ...992', check({ const: JSON.parse('9007199254740993') }, JSON.parse('9007199254740992')));
row('BigInt 12345678901234567890n, type integer', check({ type: 'integer' }, 12345678901234567890n));
row('BigInt, type number', check({ type: 'number' }, 12345678901234567890n));
row('wrapper {text}, type number', check({ type: 'number' }, { text: '12345678901234567890' }));
row('wrapper class instance with valueOf, type number', check({ type: 'number' }, new (class N { constructor(t) { this.t = t; } valueOf() { return Number(this.t); } })('1')));
row('plain number 1.0 (parsed), type integer', check({ type: 'integer' }, JSON.parse('1.0')));
console.log('  (Ajv checks typeof data == "number" for type number and integer; BigInt and objects fail, so any exact shape needs an adapter)');

section('Sorting and comparison for a query engine');
const lexemes = ['9007199254740993', '9007199254740992', '12345678901234567891', '12345678901234567890', '2', '10', '1.5e1', '-0', '0'];
row('sort with Number()', [...lexemes].sort((a, b) => Number(a) - Number(b)).join(' '));
row('sort with exact compare', [...lexemes].sort(compareDecimal).join(' '));

section('Cost of the shapes, single run: 300000 numbers, 1 percent of them exact-only, 1 in 7 with a fraction');
console.log('  Each row builds the named shape with the stated class. Timings and heap are one run on one machine; compare orders of magnitude.');
const N = 300000;
const doc = '[' + Array.from({ length: N }, (_, i) => (i % 100 === 0 ? `${9007199254740993n + BigInt(i)}` : i % 7 === 0 ? `${i}.25` : `${i}`)).join(',') + ']';
class VmdNumber { constructor(text) { this.text = text; } }
class ExactNumber { constructor(text) { this.text = text; } }
const time = (label, fn) => {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const keep = fn();
  const ms = performance.now() - t0;
  globalThis.gc?.();
  const mb = (process.memoryUsage().heapUsed - before) / 1e6;
  row(label, `${ms.toFixed(0).padStart(5)} ms   retained ${mb.toFixed(1).padStart(6)} MB`);
  return keep;
};
const keep = [];
const lexemeOf = (off, len) => doc.slice(off, off + len);
keep.push(time('JSON.parse, plain doubles (rounds the exact-only numbers)', () => JSON.parse(doc)));
keep.push(time('JSON.parse with reviver, a {text} stand-in object for every number', () => JSON.parse(doc, (k, v, ctx) => (typeof v === 'number' ? { text: ctx.source } : v))));
keep.push(time('lossless-json 4.3.1 parse, a LosslessNumber for every number', () => parseLossless(doc)));
keep.push(time('jsonc-parser visit, B: a VmdNumber{text} for every number', () => { const out = []; jsonc.visit(doc, { onLiteralValue: (v, off, len) => out.push(new VmdNumber(lexemeOf(off, len))) }); return out; }));
keep.push(time('jsonc-parser visit, A: number, or ExactNumber{text} if not double-safe', () => {
  const out = [];
  jsonc.visit(doc, { onLiteralValue: (v, off, len) => { const t = lexemeOf(off, len); out.push(Number.isSafeInteger(v) || isDoubleSafe(t) ? v : new ExactNumber(t)); } });
  return out;
}));
keep.push(time('jsonc-parser visit, C: plain numbers plus a Map index to text for exact-only', () => {
  const out = [];
  const table = new Map();
  jsonc.visit(doc, { onLiteralValue: (v, off, len) => { const t = lexemeOf(off, len); if (!(Number.isSafeInteger(v) || isDoubleSafe(t))) table.set(out.length, t); out.push(v); } });
  return [out, table];
}));
keep.push(time('jsonc-parser parse, plain doubles (for comparison)', () => jsonc.parse(doc)));
keep.push(time('jsonc-parser parseTree, offsets kept for every node (for comparison)', () => jsonc.parseTree(doc)));
void keep;

