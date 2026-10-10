// lossless-json (prior art for keeping every number's text) and what an exact object's valueOf decides.
// Run: node js-lossless-json.mjs
import Ajv from 'ajv';
import { LosslessNumber, getUnsafeNumberReason, parse, stringify } from 'lossless-json';
import { canonicalize } from 'json-canonicalize';
import * as jsonc from 'jsonc-parser';
import { isDoubleSafe } from './decimal.mjs';

const section = (t) => console.log(`\n== ${t}`);
const row = (label, value) => console.log(`${label.padEnd(62)} ${value}`);
const attempt = (fn) => { try { const v = fn(); return typeof v === 'bigint' ? `${v}n` : typeof v === 'object' ? JSON.stringify(v) : String(v); } catch (e) { return `THROWS ${e.message.slice(0, 90)}`; } };

section('lossless-json 4.3.1: parse() returns a LosslessNumber for every number');
for (const s of ['1', '1.0', '-0', '9007199254740993', '12345678901234567890', '1e400', '1e-400', '0.3000000000000000444089209850062616169452667236328125']) {
  const n = parse(s);
  row(s, `class=${n.constructor.name} text=${n.toString()} unsafeReason=${getUnsafeNumberReason(s)} valueOf()=${attempt(() => n.valueOf())}`);
}
row('parse of {"a":1,"a":2}', attempt(() => parse('{"a":1,"a":2}')));
row('stringify(parse("[1.0,12345678901234567890,1e400]"))', stringify(parse('[1.0,12345678901234567890,1e400]')));
row('parse("[1,]") (strictness)', attempt(() => parse('[1,]')));

section('Using a LosslessNumber where code expects a number');
const big = parse('9007199254740993');
const small = parse('1');
row('big + 1 (valueOf returns a bigint)', attempt(() => big + 1));
row('big == 9007199254740993 (loose equality)', attempt(() => big == 9007199254740993));
row('parse("1") === parse("1") (object identity)', parse('1') === parse('1'));
row('small + 1', attempt(() => small + 1));
row('parse("1e400") + 1', attempt(() => parse('1e400') + 1));
const ajv = new Ajv({ strict: true });
const check = (schema, data) => { const v = ajv.compile(schema); return v(data) ? 'valid' : `invalid (${v.errors[0].keyword})`; };
row('Ajv type number on LosslessNumber(1)', check({ type: 'number' }, small));
row('Ajv type integer on LosslessNumber(1)', check({ type: 'integer' }, small));
row('canonicalize({id: LosslessNumber(1)})', attempt(() => canonicalize({ id: small })));

section('An exact object that stands in for a number, by what its valueOf does');
class NoValueOf { constructor(t) { this.text = t; } }
class RoundingValueOf { constructor(t) { this.text = t; } valueOf() { return Number(this.text); } }
class ThrowingValueOf { constructor(t) { this.text = t; } valueOf() { throw new Error(`exact number ${this.text} has no double`); } }
for (const [label, make] of [['no valueOf', (t) => new NoValueOf(t)], ['valueOf returns Number(text)', (t) => new RoundingValueOf(t)], ['valueOf throws', (t) => new ThrowingValueOf(t)]]) {
  const x = make('9007199254740993');
  row(`${label}: x + 1`, attempt(() => x + 1));
  row(`${label}: x > 9007199254740992`, attempt(() => x > 9007199254740992));
  row(`${label}: Math.max(x, 1)`, attempt(() => Math.max(x, 1)));
  row(`${label}: JSON.stringify({x})`, attempt(() => JSON.stringify({ x })));
}

section('Restrict option: keep plain doubles, and report a number that is not double-safe (offsets from jsonc-parser)');
{
  const text = '{"id":9007199254740993,"ratio":0.30000000000000004,"big":12345678901234567890,"huge":1e400,"fine":[1,1.0,2.50,1e21]}';
  const found = [];
  jsonc.visit(text, { onLiteralValue: (value, offset, length) => {
    const lexeme = text.slice(offset, offset + length);
    if (typeof value === 'number' && !isDoubleSafe(lexeme)) found.push(`offset ${offset}: ${lexeme} is not double-safe, write it as the string "${lexeme}"`);
  } });
  console.log(`  ${found.join('\n  ')}`);
  row('RFC 8785 canonicalization of the double view, with the flagged numbers made strings', canonicalize({ id: '9007199254740993', ratio: 0.30000000000000004, big: '12345678901234567890', huge: '1e400', fine: [1, 1, 2.5, 1e21] }));
}
