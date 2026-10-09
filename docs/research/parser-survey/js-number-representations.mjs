// Prototypes of ways to hold a number in JavaScript, and what each does to equality, RFC 8785 canonical JSON, Ajv and sorting.
// Run: node --expose-gc js-number-representations.mjs
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import { canonicalize } from 'json-canonicalize';
import * as jsonc from 'jsonc-parser';

const section = (t) => console.log(`\n== ${t}`);
const row = (label, value) => console.log(`${label.padEnd(60)} ${value}`);

// ---- exact decimal helpers (the minimum any exact alternative needs) ------------------------------
/** Splits a JSON or YAML 1.2 number lexeme into sign, significant digits and a power of ten, with no leading or trailing zeros. */
function decimalParts(lexeme) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(lexeme);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`not a decimal: ${lexeme}`);
  const [, sign, int, frac = '', exp = '0'] = m;
  let digits = int + frac;
  let exponent = Number(exp) - frac.length;
  const lead = digits.length - digits.replace(/^0+/, '').length;
  digits = digits.slice(lead);
  const trailing = digits.length - digits.replace(/0+$/, '').length;
  digits = digits.slice(0, digits.length - trailing);
  exponent += trailing;
  if (digits === '') return { neg: false, digits: '', exp: 0 }; // zero, negative zero is not a different number
  return { neg: sign === '-', digits, exp: exponent };
}
/** Compares two decimal lexemes exactly. Returns -1, 0 or 1. */
function compareDecimal(a, b) {
  const x = decimalParts(a);
  const y = decimalParts(b);
  if (x.digits === '' && y.digits === '') return 0;
  if (x.digits === '') return y.neg ? 1 : -1;
  if (y.digits === '') return x.neg ? -1 : 1;
  if (x.neg !== y.neg) return x.neg ? -1 : 1;
  const sign = x.neg ? -1 : 1;
  const magX = x.digits.length + x.exp;
  const magY = y.digits.length + y.exp;
  if (magX !== magY) return sign * (magX < magY ? -1 : 1);
  const n = Math.max(x.digits.length, y.digits.length);
  const dx = x.digits.padEnd(n, '0');
  const dy = y.digits.padEnd(n, '0');
  return dx === dy ? 0 : sign * (dx < dy ? -1 : 1);
}
/** A canonical text for a decimal value: the same text for 1, 1.0 and 10e-1. */
function canonicalDecimal(lexeme) {
  const { neg, digits, exp } = decimalParts(lexeme);
  if (digits === '') return '0';
  const body = exp >= 0 && exp <= 20 ? digits + '0'.repeat(exp) : exp < 0 && digits.length + exp > 0 ? `${digits.slice(0, digits.length + exp)}.${digits.slice(digits.length + exp)}` : exp < 0 && exp >= -20 ? `0.${'0'.repeat(-exp - digits.length)}${digits}` : `${digits}e${exp}`;
  return (neg ? '-' : '') + body;
}
/** True when the lexeme's decimal value survives a trip through an IEEE 754 double printed as its shortest decimal. */
const isDoubleSafe = (lexeme) => {
  const d = Number(lexeme);
  return Number.isFinite(d) && compareDecimal(lexeme, String(d)) === 0;
};

section('Which lexemes survive a double? (the cases an "exact only when needed" representation would wrap)');
for (const s of ['1', '1.0', '10e-1', '0.1', '9007199254740991', '9007199254740993', '12345678901234567890', '1e400', '1e-400',
  '5e-324', '0.30000000000000004', '0.3000000000000000444089209850062616169452667236328125', '123456789.123456789123456789', '-0', '2.50', '1e21', '100000000000000000000000']) {
  row(s, `${isDoubleSafe(s) ? 'double-safe' : 'NEEDS EXACT'}   canonical=${canonicalDecimal(s)}   Number()=${Number(s)}`);
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

section('Cost of the shapes: time and heap for 300000 numbers (document of the numbers 1 to 300000 with a few fractions)');
const N = 300000;
const doc = '[' + Array.from({ length: N }, (_, i) => (i % 7 === 0 ? `${i}.25` : `${i}`)).join(',') + ']';
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
keep.push(time('JSON.parse (plain doubles)', () => JSON.parse(doc)));
keep.push(time('JSON.parse with reviver reading context.source', () => JSON.parse(doc, (k, v, ctx) => (typeof v === 'number' ? { text: ctx.source } : v))));
keep.push(time('JSON.parse with reviver, wrapper only if not double-safe', () => JSON.parse(doc, (k, v, ctx) => (typeof v === 'number' && !(Number.isSafeInteger(v) || isDoubleSafe(ctx.source)) ? { text: ctx.source } : v))));
keep.push(time('jsonc-parser parse (plain doubles)', () => jsonc.parse(doc)));
keep.push(time('jsonc-parser parseTree (offsets kept for every node)', () => jsonc.parseTree(doc)));
keep.push(time('jsonc-parser visit, wrapper for every number', () => { const out = []; jsonc.visit(doc, { onLiteralValue: (v, off, len) => out.push({ off, len }) }); return out; }));
keep.push(time('jsonc-parser visit, hybrid (number or wrapper)', () => { const out = []; jsonc.visit(doc, { onLiteralValue: (v, off, len) => out.push(Number.isSafeInteger(v) ? v : isDoubleSafe(doc.slice(off, off + len)) ? v : { off, len }) }); return out; }));
void keep;
