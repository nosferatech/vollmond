// JavaScript JSON parsers: JSON.parse (with and without a reviver) and jsonc-parser.
// Run: node js-json.mjs
import * as jsonc from 'jsonc-parser';

const show = (label, fn) => {
  let out;
  try {
    const v = fn();
    out = typeof v === 'string' ? v : JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : Object.is(x, -0) ? '-0' : x));
  } catch (e) {
    out = `THROWS ${e.constructor.name}: ${e.message}`;
  }
  console.log(`${label.padEnd(58)} ${out}`);
};
const section = (t) => console.log(`\n== ${t}`);

console.log(`node ${process.version}, V8 ${process.versions.v8}`);

// Numbers that matter. Each is parsed as the top-level value or as a member.
const samples = [
  '9007199254740991', // 2^53 - 1
  '9007199254740992', // 2^53
  '9007199254740993', // 2^53 + 1
  '12345678901234567890', // beyond 2^63 and 2^64 - 1 is 18446744073709551615
  '123456789012345678901234567890', // beyond 64 bits
  '1', '1.0', '1e0', '10e-1',
  '-0', '-0.0', '0',
  '1e400', '-1e400',
  '1e-400', '5e-324', '0.1', '0.30000000000000004', '0.3000000000000000444089209850062616169452667236328125',
  '1.7976931348623157e308',
  '123456789.123456789123456789',
];

section('JSON.parse: value after parse, as a double');
for (const s of samples) show(s, () => { const v = JSON.parse(s); return Object.is(v, -0) ? '-0 (negative zero)' : `${v}`; });

section('JSON.parse with a reviver: does context.source exist, and what is it');
for (const s of samples) {
  show(s, () => {
    let got;
    JSON.parse(s, function (k, v, ctx) { got = { hasCtx: ctx !== undefined, source: ctx?.source }; return v; });
    return got;
  });
}
show('object member: {"a":1.0,"b":[2e2]}', () => {
  const seen = [];
  JSON.parse('{"a":1.0,"b":[2e2]}', function (k, v, ctx) { seen.push([k, ctx?.source]); return v; });
  return seen;
});
show('source is absent for objects, arrays (and strings?)', () => {
  const seen = [];
  JSON.parse('{"a":[1],"s":"x","t":true,"n":null}', function (k, v, ctx) { seen.push([k, 'source' in (ctx ?? {})]); return v; });
  return seen;
});
show('source after the reviver modifies a sibling', () => {
  const seen = [];
  JSON.parse('[1, 2]', function (k, v, ctx) { if (k === '0') this[1] = 99; seen.push([k, v, ctx?.source]); return v; });
  return seen;
});

section('Keeping the lexeme with a reviver: replace each number with an object');
class Num { constructor(text) { this.text = text; } }
const lexemeReviver = (k, v, ctx) => (typeof v === 'number' ? new Num(ctx.source) : v);
show('{"a":12345678901234567890,"b":1.0}', () => JSON.parse('{"a":12345678901234567890,"b":1.0}', lexemeReviver));
show('BigInt from source for integers', () => JSON.parse('[12345678901234567890, 1.5]', (k, v, ctx) => (typeof v === 'number' && /^-?\d+$/.test(ctx.source) ? BigInt(ctx.source) : v)));

section('JSON.rawJSON and JSON.isRawJSON (serialization of exact text)');
show('typeof JSON.rawJSON', () => typeof JSON.rawJSON);
show('JSON.stringify({a: JSON.rawJSON("12345678901234567890")})', () => JSON.stringify({ a: JSON.rawJSON('12345678901234567890') }));
show('JSON.stringify({a: JSON.rawJSON("1.0")})', () => JSON.stringify({ a: JSON.rawJSON('1.0') }));
show('JSON.stringify({a: JSON.rawJSON("1e400")})', () => JSON.stringify({ a: JSON.rawJSON('1e400') }));
show('JSON.rawJSON("abc") (must be a primitive JSON text)', () => JSON.stringify(JSON.rawJSON('abc')));
show('JSON.rawJSON("[1]") (arrays and objects refused)', () => JSON.stringify(JSON.rawJSON('[1]')));
show('JSON.stringify({a: 12345678901234567890n}) without toJSON', () => JSON.stringify({ a: 12345678901234567890n }));
show('JSON.stringify(1e400 literal) i.e. Infinity', () => JSON.stringify({ a: Infinity }));
show('JSON.stringify(-0)', () => JSON.stringify({ a: -0 }));

section('JSON.parse: duplicate keys and other strictness');
show('{"a":1,"a":2}', () => JSON.parse('{"a":1,"a":2}'));
show('{"__proto__":1}  own property?', () => Object.getOwnPropertyNames(JSON.parse('{"__proto__":1}')));
show('trailing comma [1,]', () => JSON.parse('[1,]'));
show('comment', () => JSON.parse('[1 /* c */]'));
show('leading zero 01', () => JSON.parse('01'));
show('+1', () => JSON.parse('+1'));
show('.5', () => JSON.parse('.5'));
show('NaN', () => JSON.parse('NaN'));
show('lone surrogate "\\ud800"', () => JSON.parse('"\\ud800"').length);
show('BOM prefix', () => JSON.parse('﻿1'));
show('JSON.parse with a reviver sees only the last duplicate', () => {
  const seen = [];
  JSON.parse('{"a":1,"a":2}', function (k, v, ctx) { seen.push([k, ctx?.source]); return v; });
  return seen;
});

// ---- jsonc-parser ----------------------------------------------------------------------------
section('jsonc-parser: parse() value, with strict options');
const strict = { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false };
for (const s of ['12345678901234567890', '1.0', '-0', '1e400', '1e-400', '{"a":1,"a":2}', '[1,]', '[1 /* c */]', '01', '+1', '.5', 'NaN']) {
  show(`parse(${s})`, () => {
    const errors = [];
    const v = jsonc.parse(s, errors, strict);
    return { value: Object.is(v, -0) ? '-0' : v, errors: errors.map((e) => jsonc.printParseErrorCode(e.error) + '@' + e.offset) };
  });
}

section('jsonc-parser: parseTree() gives offsets and length for every node, so the lexeme is s.slice(offset, offset+length)');
function lexemes(text) {
  const errors = [];
  const tree = jsonc.parseTree(text, errors, strict);
  const out = [];
  (function walk(n, path) {
    if (!n) return;
    if (n.type === 'number') out.push([path.join('.'), text.slice(n.offset, n.offset + n.length), n.value]);
    n.children?.forEach((c, i) => {
      if (n.type === 'object') walk(c.children[1], [...path, c.children[0].value]);
      else walk(c, [...path, i]);
    });
  })(tree, []);
  return { lexemes: out, errors: errors.map((e) => jsonc.printParseErrorCode(e.error)) };
}
show('{"a":12345678901234567890,"b":1.0,"c":[-0,1e400,0.10]}', () => lexemes('{"a":12345678901234567890,"b":1.0,"c":[-0,1e400,0.10]}'));
show('node.value for 12345678901234567890 is a double', () => {
  const t = jsonc.parseTree('12345678901234567890', [], strict);
  return { value: `${t.value}`, lexeme: '12345678901234567890'.slice(t.offset, t.offset + t.length) };
});
show('node.value for 1e400', () => { const t = jsonc.parseTree('1e400', [], strict); return `${t.value}`; });

section('jsonc-parser: the SAX visitor (visit) gives offset and length for each literal');
show('visit {"a":12345678901234567890}', () => {
  const seen = [];
  jsonc.visit('{"a":12345678901234567890}', { onLiteralValue: (value, offset, length) => seen.push({ value: `${value}`, offset, length }) });
  return seen;
});

section('jsonc-parser: duplicate keys are not reported by parse() or parseTree(); detect by walking the tree');
show('parseTree {"a":1,"a":2} children', () => {
  const t = jsonc.parseTree('{"a":1,"a":2}', [], strict);
  return t.children.map((c) => c.children[0].value);
});
show('findNodeAtLocation(tree, ["a"]) with duplicates', () => {
  const text = '{"a":1,"a":2}';
  const t = jsonc.parseTree(text, [], strict);
  const n = jsonc.findNodeAtLocation(t, ['a']);
  return `${text.slice(n.offset, n.offset + n.length)}`;
});

section('jsonc-parser: edits splice only the changed span (modify + applyEdits)');
show('modify a, leave 12345678901234567890 alone', () => {
  const text = '{\n  "a": 1.0,\n  "big": 12345678901234567890\n}\n';
  const edits = jsonc.modify(text, ['a'], 2, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return jsonc.applyEdits(text, edits);
});
show('modify with a string value to splice exact text? (no raw API; value must be JSON-serializable)', () => {
  const text = '{"a":1}';
  const edits = jsonc.modify(text, ['a'], 12345678901234567890n, {});
  return jsonc.applyEdits(text, edits);
});

section('jsonc-parser: further strictness probes (errors reported, not thrown)');
for (const s of ['"\\ud800"', '﻿1', '1.', '1e', '-', '00', '[1 2]', '{"a":1,}', "{'a':1}", '{"a":1}{"b":2}']) {
  show(`parse(${JSON.stringify(s)})`, () => {
    const errors = [];
    const v = jsonc.parse(s, errors, strict);
    return { value: typeof v === 'string' ? v.length + ' code units' : v, errors: errors.map((e) => jsonc.printParseErrorCode(e.error) + '@' + e.offset) };
  });
}

section('jsonc-parser: a hand-built splice from node offsets replaces one number and leaves the others');
show('replace "b" lexeme 1.0 with 2.50', () => {
  const text = '{"a":12345678901234567890,"b":1.0}';
  const n = jsonc.findNodeAtLocation(jsonc.parseTree(text, [], strict), ['b']);
  return text.slice(0, n.offset) + '2.50' + text.slice(n.offset + n.length);
});
