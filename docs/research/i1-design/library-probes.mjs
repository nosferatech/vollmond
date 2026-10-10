// Behaviors of `yaml`, `jsonc-parser` and the runtime's Unicode data that docs/design/i1-read.md relies on.
//
//   node library-probes.mjs
//
// Every line prints what the library or runtime did. Nothing here is a vmd rule; the design says what core does about each.
import { parseTree, printParseErrorCode } from "jsonc-parser";
import { isMap, parseDocument, visit } from "yaml";

console.log(`node ${process.versions.node}, icu ${process.versions.icu}, unicode ${process.versions.unicode}`);

// --- yaml: errors, warnings, directives, tags, anchors, ranges ---
const yamlOptions = { version: "1.2", schema: "core", merge: false, uniqueKeys: false, keepSourceTokens: true };
function probeYaml(label, source) {
  const doc = parseDocument(source, yamlOptions);
  const marks = [];
  visit(doc, {
    Node(_key, node) {
      if (node.tag || node.anchor) marks.push({ node: node.constructor.name, tag: node.tag, anchor: node.anchor });
    },
    Alias(_key, node) {
      marks.push({ node: "Alias", source: node.source });
    },
  });
  const directive = doc.directives?.yaml;
  console.log(
    `yaml ${label.padEnd(22)} errors ${JSON.stringify(doc.errors.map((e) => e.code))} warnings ${JSON.stringify(doc.warnings.map((e) => e.code))}` +
      ` %YAML ${JSON.stringify({ version: directive?.version, explicit: directive?.explicit })} tags/anchors ${JSON.stringify(marks)}`,
  );
}
probeYaml("plain", "a: 1\nb: x\n");
probeYaml("!!str", "a: !!str 12\n");
probeYaml("non-specific tag !", "a: ! 12\n");
probeYaml("custom tag !foo", "a: !foo 12\n");
probeYaml("anchor and alias", "a: &x 1\nb: *x\n");
probeYaml("undefined alias", "a: *nope\n");
probeYaml("two documents", "a: 1\n---\nb: 2\n");
probeYaml("%YAML 1.1", "%YAML 1.1\n---\na: yes\n");
probeYaml("%YAML 1.3", "%YAML 1.3\n---\na: 1\n");
probeYaml("raw U+FFFE", 'a: "\uFFFE"\n');
probeYaml("byte order mark", "\uFEFFa: 1\n");
probeYaml("duplicate key", "a: 1\na: 2\n");
probeYaml("unclosed flow", "a: [1, 2\nb: 3\n");
// A lone CR is a line break in YAML 1.2.2 (section 5.4), but not to `yaml` 2.9.1.
for (const [label, source] of [
  ["block scalar, CR", "a: |\r  x\r"],
  ["block scalar, LF", "a: |\n  x\n"],
  ["plain scalar, CR", "a: x\r  y\r"],
  ["plain scalar, LF", "a: x\n  y\n"],
]) {
  const doc = parseDocument(source, yamlOptions);
  console.log(`yaml ${label.padEnd(22)} errors ${JSON.stringify(doc.errors.map((e) => e.code))} value ${JSON.stringify(doc.toJS())}`);
}
const ranged = parseDocument("k: x\u{1F600}y\nn: 0x1F\n", yamlOptions);
const n = ranged.get("n", true);
console.log(`yaml range of n in "k: x\u{1F600}y\\nn: 0x1F" ${JSON.stringify(n.range)} (UTF-16 units give 11), source ${n.source}, value ${n.value}`);
const lone = parseDocument('a: "\\ud800"\n', yamlOptions).toJS().a;
console.log(`yaml "\\ud800" is accepted; isWellFormed() = ${lone.isWellFormed()}; root isMap: ${isMap(ranged.contents)}`);

// --- jsonc-parser: error recovery, strictness, offsets ---
const jsonOptions = { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false };
for (const source of ["NaN", "+1", ".5", "01", '"a\u0001"', "\uFEFF{}", '{"a":1,}', '{"a":1 "b":2, "c" 3}', '"\\ud800"', '{"a":1,"a":2}', ""]) {
  const errors = [];
  const tree = parseTree(source, errors, jsonOptions);
  console.log(
    `jsonc ${JSON.stringify(source).padEnd(26)} errors ${JSON.stringify(errors.map((e) => [printParseErrorCode(e.error), e.offset]))}` +
      ` tree ${tree ? `${tree.type}, ${tree.children?.length ?? 0} children` : "none"}`,
  );
}
const offsets = parseTree('{"k":"x\u{1F600}","n": 1.0}', [], jsonOptions);
console.log(`jsonc offset of the second property ${offsets.children[1].offset} (UTF-16 units give 11)`);

// --- Unicode in the runtime ---
console.log(`"ΑΣ".toLowerCase() = ${"ΑΣ".toLowerCase()}; per code point = ${[..."ΑΣ"].map((c) => c.toLowerCase()).join("")}`);
console.log(`"İ".toLowerCase() has ${"İ".toLowerCase().length} code units (SpecialCasing's unconditional mapping)`);
console.log(`U+16EA0 (new in Unicode 17.0): \\p{L} ${/\p{L}/u.test("\u{16EA0}")}, lower-cases to U+${"\u{16EA0}".toLowerCase().codePointAt(0).toString(16).toUpperCase()}`);
console.log(`"\\u0085".trim() keeps U+0085: ${"\u0085".trim().length === 1}; \\p{White_Space} matches it: ${/\p{White_Space}/u.test("\u0085")}`);
