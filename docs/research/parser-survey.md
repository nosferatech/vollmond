# Parser survey for numbers, duplicate keys and YAML dialects

Status: report for I0.2 (GitHub issue #3), 2026-10-09. It answers open question 2 of
[the proposal](../draft/vollmond-proposal.md) (Draft v0.3). The proposal is not edited here; proposed wording is in section 7.

How each claim is marked.

- **M** measured by a script in [parser-survey/](parser-survey/), whose output is kept in `parser-survey/results/`.
- **D** documented, with the source named. Not run here.
- **I** inferred from other measurements. A hypothesis, not an observation.

## 1. Summary

1. **Appendix B is right on its main points and needs four corrections.** Every row was confirmed (Go from documentation only).
   The YAML paragraph is wrong in two places. js-yaml's default schema depends on the major version (4.3.2 includes timestamps,
   5.4.3 does not), and `ruamel.yaml` in its default YAML 1.2 mode still turns `2026-10-09` into a date. The JavaScript row should
   name the engines that have the reviver's source text. Section 6 has a corrected table.
2. **A number's exact text is available from every parser the project plans to use.** `JSON.parse` revivers get `context.source`
   in Node 24.21 (M), and `jsonc-parser` and `yaml` give offsets and ranges (M). The reviver is not the right tool for `core`,
   because `core` needs offsets for splicing and duplicate-key detection anyway.
3. **The in-memory shape is the real decision.** A plain `number` silently merges distinct values beyond 2^53 in equality,
   sorting, Ajv's `const` and `enum`, and the RFC 8785 node version token (M). Section 5 compares four shapes and recommends a
   hybrid (a plain `number` when the text survives a double, an exact object otherwise). The choice is the project owner's.
4. **Several rules in the proposal meet parser behavior that the proposal does not yet state.** They are listed in section 4.4
   and are not spec changes made here. The main ones are that `yaml`'s own writer rewrites numbers (`12345678901234567890` becomes
   `12345678901234567000`), that RFC 8785 requires numbers a double can express, and that `yaml` turns `1` and `'1'` into one JS
   key without an error.

## 2. What was run

| Component | Version | How |
|---|---|---|
| Node.js | 24.21.0 (V8 13.6.233.17) | `js-json.mjs`, `js-yaml.mjs`, `js-number-representations.mjs` |
| `jsonc-parser` | 3.3.1 | npm, exact pin |
| `yaml` (eemeli) | 2.9.1 | npm, exact pin |
| `js-yaml` | 5.4.3 (current) and 4.3.2 (`v4-legacy` tag), side by side | npm, exact pins; 4.3.2 through the alias `js-yaml4` |
| `ajv` | 8.20.0 | npm, exact pin |
| `json-canonicalize` | 3.0.1 (an RFC 8785 implementation) | npm, exact pin |
| Python | 3.9.6 (system) | virtual environment `.venv/` |
| PyYAML | 6.0.3 (with libyaml; `safe_load` uses the pure loader) | `requirements.txt` |
| `ruamel.yaml` | 0.19.1 | `requirements.txt` |
| Rust | cargo 1.98.1, `serde_json` 1.0.151, `serde` 1.0.229 | `serde-json-check/`, default and `arbitrary_precision` |
| Java | OpenJDK 26.0.2.1, Jackson (databind and core) 2.22.3, annotations 2.22 | `jackson/run.sh` |
| Ruby | 2.6.10, Psych 3.1.0 (the system Ruby, old) | `ruby-yaml.rb` |
| Go | not installed | documentation only |

Notes on method. Dates in YAML output are shown in UTC. The timings in section 5 are single runs on one laptop and show orders of
magnitude only. The Ruby is the macOS system Ruby, so its Psych is old; read it as a sample of YAML 1.1 behavior, not of current
Jekyll.

## 3. JSON parsers

### 3.1 Numbers

Values after parsing a number given as the whole document. "Lexeme" means the exact source text.

| Input | JS `JSON.parse` (M) | `jsonc-parser` `parse` (M) | Python `json` (M) | Rust `serde_json` default (M) | `serde_json` `arbitrary_precision` (M) | Jackson `readTree` (M) | Go `interface{}` (D) |
|---|---|---|---|---|---|---|---|
| `9007199254740991` | exact | exact | `int` | `u64` | `u64` | `Long` | `float64` |
| `9007199254740993` | `9007199254740992` | `9007199254740992` | `int`, exact | `u64`, exact | `u64`, exact | `Long`, exact | `float64`, rounded |
| `12345678901234567890` | `12345678901234567000` | same | `int`, exact | `u64`, exact | `u64`, exact | `BigInteger` | `float64`, rounded |
| 30 digit integer | `1.2345678901234568e29` | same | `int`, exact | `f64`, rounded | text kept, exact | `BigInteger` | `float64`, rounded |
| `1` and `1.0` | both `1`, not distinguishable | both `1` | `int` and `float`, `==` is true | `u64` and `f64`, `Value` `==` is false | same, false | `IntNode` and `DoubleNode`, `equals` is false | both `float64` |
| `-0` | `-0` (negative zero) | `-0` | `int 0`, sign lost (`-0.0` stays a float `-0.0`) | `f64 -0.0` | `0`, sign lost | `0`, sign lost | `float64` |
| `1e400` | `Infinity` | `Infinity` | `float inf` | error "number out of range" | text kept, `as_f64` is `None` | `Infinity` | not stated (D) |
| `1e-400` | `0` | `0` | `0.0` | `0.0` | text kept | `0.0` | not stated (D) |
| `0.30000000000000004440892098500626...` (53 decimals) | rounded to `0.30000000000000004` | same | same | same | text kept | same | `float64` |

The Go column rests on the package documentation (<https://pkg.go.dev/encoding/json>, fetched 2026-10-09), which says Unmarshal
stores "float64, for JSON numbers" in an interface value. A number that overflows a typed target is reported as an
`UnmarshalTypeError`. The page does not say what an out-of-range literal does in an `interface{}`; that cell is a gap, not a finding.

Observations that matter beyond the table.

- **A parsed double cannot tell `1` from `1.0`, and Python, Rust and Java can** (M). That is consistent with §4.2 (same number),
  but the Rust and Java tree types compare them as different, and Python's `json.dumps` rewrites `1e3` as `1000.0` and `1e400` as
  `Infinity` (M, `py-json.txt`). An implementation in those languages has to compare numerically and must not re-serialize.
- **`serde_json` with `arbitrary_precision` keeps digits but normalizes** (M): `1e0` prints `1e+0`, `-0` prints `0`, and equality
  of `0.10` and `0.1` is false. Its `RawValue` keeps the text exactly, including `1e400` and `-0` (M).
- **Jackson's `BigDecimal` mode drops trailing zeros** (`1.0` prints `1`, M). The streaming parser's `getText()` returns the exact
  text, including `1e400` and `-0` (M).
- **Python limits integer text length in `json.loads`.** D (<https://docs.python.org/3/library/json.html>, fetched 2026-10-09)
  says "Since 3.11, the default `int()` path also limits integer string length". The default of 4300 digits and the backport to
  3.9.14 and other security releases are from my recollection of the CPython documentation and are unverified. The system Python
  3.9.6 used here predates the limit (M, `sys.get_int_max_str_digits` is absent). I infer that a 5000 digit integer raises
  `ValueError` on a current Python; a 30 digit integer is far from the limit.

### 3.2 Duplicate keys and strictness

| Parser | Duplicate object keys | Option to detect or reject | Other leniency found (M unless marked) |
|---|---|---|---|
| JS `JSON.parse` | last wins; the reviver sees only the last | none | accepts `"\ud800"`; rejects BOM, comments, trailing commas, `NaN`, `01`, `+1`, `.5` |
| `jsonc-parser` `parse` | last wins | none; `parseTree` lists both members, so a walk can detect them; `findNodeAtLocation` returns the first | reports errors in an array and still returns a value (`[1,]`, `[1 2]`, `01`, `1.`); accepts `"\ud800"`; rejects BOM; `disallowComments` and `allowTrailingComma: false` must be set |
| Python `json` | last wins (D: json docs, "ignores all but the last name-value pair") | `object_pairs_hook` (M, raises on a repeat) | accepts `NaN`, `Infinity`, `-Infinity` (D, M) unless `parse_constant` raises; accepts `"\ud800"`; rejects a BOM in `str` input but accepts it in `bytes` |
| `serde_json` | `Value`: last wins; a derived struct: error "duplicate field" | typed targets only | rejects `NaN`, comments, trailing commas, lone surrogate escape |
| Jackson | last wins | `StreamReadFeature.STRICT_DUPLICATE_DETECTION` (parser) or `DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY` (tree) | `readTree` ignores trailing tokens unless `FAIL_ON_TRAILING_TOKENS`; a lone surrogate escape is accepted |
| Go v1 `encoding/json` | permitted (D, "In v1, a JSON object with duplicate names is permitted"); which value wins is not stated there | none in v1; v2 errors (D) | invalid UTF-16 surrogates are replaced, not an error (D) |

Consequence for the plan. I1.2 says "`jsonc-parser` in strict mode, duplicate keys rejected". `jsonc-parser` has no such option, so
the rejection is code in `core` (a walk over `parseTree`), and every entry of the error array must be treated as fatal. The I-JSON
rules on strings (RFC 7493 §2.1, no unpaired surrogates) are also `core`'s job, because only `serde_json` of the parsers measured
rejects them.

### 3.3 Getting a number's exact text

| Parser | Mechanism | Measured behavior | Limits |
|---|---|---|---|
| JS `JSON.parse` | `reviver(key, value, context)`, `context.source` | present for numbers, strings, booleans and null; absent for objects and arrays; absent for a value whose slot the reviver itself changed (M). Gave `1.0`, `-0`, `1e400`, `12345678901234567890` verbatim (M) | no offset, so no splicing and no duplicate detection. Engines (D, MDN browser-compat-data fetched 2026-10-09): Node 21, Chrome 114, Firefox 135, Safari 18.4, Deno 1.33, Bun 1.1.43. Cost (M): 82 ms for 300000 numbers against 2 ms without a reviver |
| JS `JSON.rawJSON` | serialization of exact text | `JSON.stringify({a: JSON.rawJSON("12345678901234567890")})` writes the digits; `1.0` and `1e400` too (M). Primitive JSON text only | same engines |
| `jsonc-parser` | `parseTree`, `visit` | every node has `offset` and `length`; `text.slice(offset, offset + length)` is the lexeme (M). `node.value` is the rounded double | `modify` cannot take a raw lexeme (a `BigInt` value throws, M), so a splice is hand-written from the offsets (M, one line) |
| `yaml` 2.9.1 | `Scalar.source`, `Scalar.range`, CST token `source`, option `intAsBigInt` | `source` holds `1.0`, `0x1F`, `1e3`, `-0`, `0o17`, `1e400`, `+1`, `017`, and 20 digit integers verbatim, with the `range` (M). `intAsBigInt` gives exact integers, but turns `-0` into `0n` and leaves decimals as doubles (M) | `Document.toString()` rewrites numbers, section 4.4 item 1 |
| Python `json` | `parse_int=str`, `parse_float=str` | receive the lexeme, including `-0`, `1e400` (M) | `parse_float=Decimal` turns `-0.0` into `Decimal('-0.0')` and is exact otherwise (M) |
| PyYAML, `ruamel.yaml` | `compose()` returns the node tree before conversion | `value` is the text and `start_mark.index` to `end_mark.index` slices the source, for every number in the test (M). The tag already says `int`, `float` or `str` | PyYAML types `1e3` and `1e400` as `str` (a 1.1 reading) |
| `serde_json` | `RawValue` | exact text for any value (M) | feature `raw_value` |
| Jackson | `JsonParser.getText()` | exact text (M) | streaming API only |
| Go | `Decoder.UseNumber`, `json.Number` | "A Number represents a JSON number literal" (D) | |

## 4. YAML parsers

The inputs are in `parser-survey/yaml-cases.json`; full tables are in `results/js-yaml.txt` and `results/py-yaml.txt`. Columns
use these names. `yaml` is eemeli's package. `js-yaml 5` and `js-yaml 4` are 5.4.3 and 4.3.2 with their default `load`. "YAML 1.1
reader" means `yaml` with `version: '1.1'`, `js-yaml 5` with `YAML11_SCHEMA`, PyYAML, Psych, and `ruamel.yaml` with `version = (1, 1)`.

### 4.1 Scalars (M)

| Input | `yaml` core | `js-yaml 5` | `js-yaml 4` | `ruamel.yaml` (1.2) | PyYAML | Psych | YAML 1.1 readers |
|---|---|---|---|---|---|---|---|
| `2026-10-09` | string | string | **Date** | **date** | **date** | **Date** | date |
| `2026-10-09T08:00:00Z` | string | string | **Date** | **datetime** | **datetime** | | datetime |
| `2026-13-45` | string | string | Date `2027-02-14` (overflow) | **ValueError raised** | **ValueError raised** | | `yaml` Date overflow; `js-yaml 5` string |
| `yes` `no` `on` `off` (any case) | string | string | string | string | **bool** | **bool** | bool |
| `y` `n` | string | string | string | string | string | string | `yaml` and `js-yaml 5`: bool |
| `017` | `17` | `17` | `17` | `17` | **15** | **15** | 15 |
| `0o17` | `15` | `15` | `15` | `15` | string | string | string |
| `0x1F` | 31 | 31 | 31 | 31 | 31 | 31 | 31 |
| `0b101` | string | string | 5 | 5 | 5 | 5 | 5 |
| `1_000` | string | string | string | `1000` | `1000` | `1000` | 1000 |
| `1:30` | string | string | string | string | **90** | **5400** | 90 |
| `.inf` `-.inf` `.nan` | float | float | float | float | float | float | float |
| `1e3` | 1000 | 1000 | 1000 | 1000 | **string** | **string** | `yaml` 1000; `js-yaml 5`, PyYAML, Psych: string |
| `1e400` | **Infinity** | **string** | **string** | **inf** | string | string | |
| `-0` | `-0` | `-0` | **`0`** | `0` | `0` | `0` | |
| `-.5` | -0.5 | -0.5 | **string** | -0.5 | **string** | -0.5 | |
| `12345678901234567890` | rounded double | rounded | rounded | exact `int` | exact `int` | exact | |

The Psych `1:30` value of 5400 is what Psych 3.1.0 returned (M); I did not look for the reason. In the 1.1 reader column,
`yaml` with `version: '1.1'` also read the key `y` in `{x: 1, y: 2}` as `true` (M, `merge key` case in `results/js-yaml.txt`).

What this says for §4.4.

- **PyYAML and Psych confirm the proposal's three examples** (`2026-10-09`, `yes`, `1:30`) and add `017`, `0b101`, `1_000`, `1e3` (a
  string there, so no quoting is needed for it) and `on`/`off` in all case forms. The set of strings a 1.1 reader changes is
  larger than the three examples, and it differs by reader: `y` and `n` are booleans for `yaml` in 1.1 mode and `js-yaml 5`'s
  `YAML11_SCHEMA`, but strings in PyYAML and Psych.
- **`ruamel.yaml`'s default is YAML 1.2 for booleans, octals and sexagesimals, but it still resolves timestamps** (M). `ruamel.yaml`
  is the library Appendix C names for Python, so a Python implementation must remove the timestamp resolver to read `2026-10-09`
  as a string, as §4.4 requires of vmd. (I: this follows from the loader's resolver table, which I did not inspect.)
- **`1e400` has no common reading.** It is an infinite double in `yaml` and `ruamel.yaml`, and a string in `js-yaml`, PyYAML and
  Psych (M). As a YAML 1.2 core float it is a number whose double is infinite, so the same file is a number in one
  implementation and a string in another unless `core` reads number lexemes itself.
- **Serializing strings with each library** (M, `results/js-yaml.txt`, the block headed "Serializers"). `yaml`'s default
  `stringify` quotes none of `2026-10-09`, `yes`, `No`, `on`, `OFF`, `y`, `n`, `1:30`, `0b101`, `1_000`, `<<`, `=` (it does quote
  `017`, `0o17`, `0x1F` and `1e3`, which its own core schema reads as numbers). Its option `version: '1.1'` quotes
  most of them but leaves `0o17`, `<<` and `=` bare, and a YAML 1.2 reader reads `0o17` as 15. `js-yaml 5`'s `dump` (its documented
  "maximum compatibility" schema) quotes all of them; `js-yaml 4`'s `dump` leaves `1_000` bare. PyYAML's `safe_load` raises on a
  bare `<<` or `=` value (M), so those two are also worth quoting.

### 4.2 Constructs (M)

| Construct | `yaml` | `js-yaml 5` | `js-yaml 4` | PyYAML `safe_load` | `ruamel.yaml` safe | `ruamel.yaml` rt |
|---|---|---|---|---|---|---|
| Duplicate key | error `DUPLICATE_KEY`; `uniqueKeys: false` makes last win; `strict: false` does not help | error; `json: true` makes last win | error; `json: true` last wins | **last wins, no error** | error | error; `allow_duplicate_keys = True` makes **first** win |
| Anchors and aliases | expanded in `toJS`; `Alias` nodes remain in the document tree | expanded; `maxAliases: 0` rejects (M) | expanded | expanded | expanded | expanded |
| Merge key `<<` | plain key `"<<"` unless `merge: true` or version 1.1 | plain key unless `mergeTag` added | **merged** by default | merged | merged | merged |
| `<<: 1` (not a map) | plain key | plain key | error | error | error | error |
| Custom tag `!foo` | **warning** `TAG_RESOLVE_FAILED`, value kept | error | error | error | error | **kept** (`TaggedScalar`; on a mapping, as an attribute) |
| `!!set`, `!!omap`, `!!binary`, `!!timestamp` | resolved even in core | error | resolved | resolved | resolved | resolved |
| Several documents | `parse` errors `MULTIPLE_DOCS`; `parseAllDocuments` returns all | `load` errors; `loadAll` | same | `safe_load` errors (`ComposerError`) | same | same |
| Empty file | `parse` gives `null` | error | `undefined` | `None` | `None` | `None` |
| Non-string keys (`1`, `true`, `null`, a date) | `toJS` keys are strings (a `null` key becomes `""`); the document tree keeps the typed key (number, boolean, null) | stringified | stringified; a date key becomes a Date's text | typed Python keys | typed | typed |
| Sequence or mapping as key | stringified `[ a, b ]` | **error** | stringified (`a,b`, `[object Object]`) | error | sequence: allowed; mapping: error | allowed |
| Key `1` and key `'1'` in one map | **both become the JS key `1`; last wins, no error** | error "duplicated mapping key" | error | both kept | both kept | both kept |
| Unpaired surrogate `"\ud800"` | accepted | accepted | accepted | accepted | accepted | accepted |
| Tab indent, BOM | tab error; BOM accepted | same | same | same | same | same |

What this says for §4.1 (YAML values outside the model are errors).

- **Every one of these is invisible in the plain JS or Python value** unless the check runs on the parsed tree or the events.
  Merged keys, expanded aliases, stringified keys and a kept custom tag leave no trace in the converted value. The checks belong on
  `yaml`'s document tree (`isAlias`, `node.anchor`, `node.tag`, the typed key, `doc.warnings`) and on Python's composed nodes.
- **`yaml`'s custom-tag problem is a warning, not an error** (M), so `core` has to treat `doc.warnings` as fatal, as well as
  `doc.errors`.
- **`yaml`'s `toJS` makes `1` and `'1'` collide silently** (M). A check on the converted object cannot see it.

## 5. How `@vollmond/core` can keep exact numbers in JavaScript

### 5.1 What has to hold

From the proposal: a number's meaning is its decimal value (§4.2); distinct values must not merge silently when compared, sorted or
validated (§4.2); an unchanged number is never rewritten (§4.2, §13.3); equality is by value (§5.8); a node's version is a hash of
its RFC 8785 canonical JSON (§11.3); and Ajv validates the value view (Appendix C). The plan decides int64 as a number within
±(2^53−1) and a decimal string beyond (plan, "Decided for this plan"), which keeps most large identifiers out of numbers. That makes
a number beyond a double rare in practice, but §4.2 still permits it and the format must not corrupt it.

"No rewriting" does not depend on the shape in memory. If edits splice the source (JSON: offsets from `jsonc-parser`; YAML: `range`
from `yaml`), an unchanged number never passes through the value at all (M, `js-json.txt`: a splice replaced `1.0` and left
`12345678901234567890` alone). The shape matters for reading.

### 5.2 Measurements that frame the choice

All from `results/js-number-representations.txt` (M).

- **A plain double merges distinct values.** `9007199254740993` and `9007199254740992` are `===`; so are `12345678901234567890` and
  `...891`; `1e400` and `2e400`. Sorting by `Number()` puts them in the wrong order (`...993` before `...992`).
- **The node version token collides.** `json-canonicalize` of `{"id":9007199254740992}` and `{"id":9007199254740993}` give the same
  text and the same 16 hex digit token (`24bb430971eb50f9`), so a write conditional on `if_version` would succeed against a changed
  value. `1e400` makes the canonicalizer throw. RFC 8785 is explicit (D, <https://www.rfc-editor.org/rfc/rfc8785>, §3.1) that "JSON
  number data MUST be expressible as IEEE 754 double-precision values" and recommends strings for anything else. RFC 7493 §2.2 (D)
  says I-JSON messages "SHOULD NOT include numbers that express greater magnitude or precision than an IEEE 754 double precision".
  So §4.1's "restricted as I-JSON" and §4.2's "every other number at least as a double" sit on the soft side of RFC 7493, and §11.3
  needs a rule of its own for numbers that are not doubles.
- **Ajv gives wrong answers on rounded doubles and rejects every exact shape.** With a plain double, `enum: [9007199254740993]`
  accepts the data `9007199254740992`, and `type: integer` accepts `12345678901234567000`; `1e400` becomes `Infinity` and fails
  `type: number`. A `BigInt`, a `{text}` object and an object with `valueOf` all fail `type: number` and `type: integer`.
- **Cost of a wrapper per number.** For 300000 numbers: plain `JSON.parse` retains about 2.5 MB; a reviver wrapping every number
  retains 19 MB and takes 82 ms; a reviver wrapping only non-double-safe numbers retains 2.4 MB (115 ms because the check
  runs per number); `jsonc-parser` `visit` with a wrapper per number retains 15 MB, the hybrid 3 MB (33 ms).
- **Which lexemes need the exact shape.** Define a lexeme as double-safe when its decimal value equals the decimal printed by
  `String(Number(lexeme))`. Then `1`, `1.0`, `10e-1`, `0.1`, `2.50`, `5e-324`, `0.30000000000000004` and `1e23` are double-safe, and
  `9007199254740993`, `12345678901234567890`, `1e400`, `1e-400`, the 53 decimal number above and `123456789.123456789123456789` are not.

### 5.3 The alternatives

| | A. Hybrid | B. Always an exact object | C. Plain doubles and a side table | D. Hybrid with `BigInt` |
|---|---|---|---|---|
| Shape | `number` when double-safe, else `ExactNumber` holding the canonical decimal text | every number is `VmdNumber` holding the text, with lazy `toNumber()` | the view is `JSON.parse`-shaped; a map from path to lexeme for numbers that are not double-safe | `number` when safe, `bigint` for integers beyond, an object for non-integers beyond |
| Equality (§5.8) | `===` for two plain numbers; an exact compare when either side is exact (one helper, about 30 lines, M prototype) | one compare helper for everything | `===` on the view is wrong for flagged paths; the caller must consult the table | as A, plus `bigint` cases |
| RFC 8785 (§11.3) | the RFC for plain numbers (so nodes without exceptional numbers hash exactly as RFC 8785 says); an extension rule for `ExactNumber` (canonical decimal text, M prototype) | one rule for all, but then ordinary numbers no longer follow RFC 8785 unless the helper delegates | the view collides (M); the hash must read the table | as A |
| Ajv | untouched for plain numbers; an adapter is needed for exact ones, and the numeric keywords on them (`const`, `enum`, `minimum`, `multipleOf`) need exact versions | every numeric keyword needs the adapter (M: every wrapper fails `type: number`) | untouched, and silently wrong on flagged paths (M) | `bigint` fails `type: integer` (M), so also an adapter |
| VQL comparison and sorting | one comparator (`compareNumbers`), plain fast path | one comparator everywhere | the comparator needs the path, which a projected value no longer has (I) | as A |
| Serialization | `JSON.stringify` works for plain; exact needs `JSON.rawJSON` (Node 21 and later) or `core`'s own writer; a `bigint` would throw, as in D | always `core`'s own writer | `JSON.stringify` works and writes the rounded double (silent rounding) | `bigint` throws in `JSON.stringify` (M) |
| User ergonomics | `record.value.size + 1` works for almost every value; a `typeof` branch for the rare exact one | arithmetic on a number needs `.toNumber()` | as today | as A, with a third type |
| Memory (M, 300000 numbers) | about 3 MB | 15 to 19 MB | about 2.5 MB plus the table | about 3 MB |
| Failure mode | code that ignores `ExactNumber` gets an object, not a wrong number: loud | none, uniform | code that ignores the table gets a wrong number: silent | as A |

### 5.4 Recommendation (for the project owner)

Alternative A. A number is a plain `number` when its lexeme is double-safe, and an `ExactNumber` (immutable, holding the canonical
decimal text) otherwise, with `equalNumbers` and `compareNumbers` as the only comparison entry points. Reasons.

1. It is the only alternative where the common case is the cheapest (no wrapper memory, Ajv and `JSON.stringify` untouched) and
   the rare case fails loudly. C fails silently, which is exactly what §4.2's "no silent rounding" prohibits; B pays on every
   number.
2. The int64 decision already routes large identifiers to strings, so `ExactNumber` will mostly be a guard rather than a hot path.
3. For all-plain data the node version token is exactly RFC 8785's, so a record in the common case hashes the same in any
   implementation. Only a record that carries an exceptional number depends on the extension rule.
4. Classification is cheap (measured above) and happens once, where the lexeme is read.

What A costs, so the owner can weigh B against it. Every consumer of the value view meets two shapes for numbers. `core` must
export the helpers and the Ajv adapter must be written and tested (a conformance fixture for `const` and `enum` on
`9007199254740993` is the obvious guard). The extension rule for RFC 8785 must be written into §11.3 and into the conformance
suite, because no library implements it. D adds `bigint` for little: it still needs the exact object for non-integers, and
`bigint` throws in `JSON.stringify` and fails Ajv's `integer` type.

B is the right choice if the owner prefers a single shape over the memory and ergonomics cost. C is not recommended.

Decisions the choice leaves open, to settle in I1.1 and I0.4. What `-0` becomes (the lexeme is kept in the source, and the value
is `0`; Python's `json` already reads `-0` as `0`). Whether `1e400` is an accepted number or an error (it is valid JSON and a
valid YAML 1.2 float, but outside every double and outside RFC 8785). Whether `1e-400` (a double rounds it to `0`) is exact.

## 6. Appendix B, corrected, ready to paste

> ## Appendix B. Numbers in common parsers
>
> Measured by the I0.2 survey (`docs/research/parser-survey.md`), except Go, which is from documentation. Versions are in the survey.
>
> | Parser | Integers | Beyond 2^53 | Non-integers | `-0`, `1e400` | Exact options |
> |---|---|---|---|---|---|
> | JavaScript `JSON.parse` | IEEE 754 double | silently rounded | double | `-0` stays negative zero; `1e400` is `Infinity` | a reviver's `context.source` (Node 21, Chrome 114, Firefox 135, Safari 18.4); `JSON.rawJSON` to write |
> | `jsonc-parser` | double in `node.value` | silently rounded in `value`; `offset` and `length` give the exact text | double | as `JSON.parse` | `parseTree` and `visit` offsets |
> | Python `json` | arbitrary precision `int` | exact | `float` | `-0` is `int 0`; `1e400` is `inf` | `parse_float=Decimal`, or `parse_int=str` and `parse_float=str` for the text; a limit of 4300 digits applies from 3.11 and the later 3.9 patch releases |
> | Go `encoding/json` | `float64` when decoding into `interface{}` | rounded | `float64` | not checked | `Decoder.UseNumber` |
> | Java Jackson | `int`, `long` or `BigInteger` by size | exact | `double` | `-0` is `0`; `1e400` is `Infinity` | `USE_BIG_DECIMAL_FOR_FLOATS` (drops trailing zeros); `JsonParser.getText()` for the text |
> | Rust `serde_json` | `i64` or `u64` | exact up to `u64`; beyond, `f64` | `f64` | `-0` is `-0.0`; `1e400` is an error | `arbitrary_precision` (normalizes the text); `RawValue` for the text |
>
> Duplicate keys are accepted with the last value winning by `JSON.parse`, `jsonc-parser`, Python `json`, Jackson and `serde_json`'s
> `Value`; only an option or a typed target rejects them, and `jsonc-parser` has no such option. No parser in the table rejects
> an unpaired surrogate escape except `serde_json`.
>
> YAML readers differ in version and in schema, and some differ between releases.
>
> | Reader | Implicit timestamps | `yes`/`no`/`on`/`off` | `017` | `0o17` | `1:30` |
> |---|---|---|---|---|---|
> | `yaml` 2.x, default (1.2 core) | no | strings | 17 | 15 | string |
> | `yaml` 2.x, `version: '1.1'` | yes | booleans (and `y`/`n`) | 15 | string | 90 |
> | `js-yaml` 5.x, default (core) | no | strings | 17 | 15 | string |
> | `js-yaml` 5.x, `YAML11_SCHEMA` | yes | booleans (and `y`/`n`) | 15 | string | 90 |
> | `js-yaml` 4.x, default | yes | strings | 17 | 15 | string |
> | `js-yaml` 4.x, `CORE_SCHEMA` | no | strings | 17 | 15 | string |
> | `ruamel.yaml`, default (1.2) | **yes** | strings | 17 | 15 | string |
> | PyYAML | yes | booleans | 15 | string | 90 |
> | Ruby Psych (3.1.0) | yes | booleans | 15 | string | 5400 |
>
> `js-yaml` 4's default schema also merges `<<` keys and resolves `!!set`, `!!omap` and `!!binary`; `js-yaml` 5's default does not.
> `ruamel.yaml` and PyYAML merge `<<` keys always.

## 7. Proposed wording (for the project owner to apply)

These assume alternative A. If the owner picks B, §4.2's second and third bullets change and the rest holds.

### 7.1 §4.2, replacing the "Exact range", "No silent rounding" and "No rewriting" bullets

> - **Exact range.** Implementations must handle integers in ±(2^53−1) exactly. Every other number is held exactly too, by its
>   decimal text, wherever the implementation's number type would round it; an implementation that cannot do so must say so (next
>   bullet).
> - **No silent rounding.** A number is *double-safe* when its decimal value equals the shortest decimal that round-trips through
>   the nearest IEEE 754 double (`1`, `1.0`, `0.1`, `2.50`), and *exact-only* otherwise (`9007199254740993`, `12345678901234567890`,
>   `1e400`, a decimal with more than 17 significant digits). An implementation that holds a number in a binary double must hold an
>   exact-only number in another form, or fail when it compares, sorts or validates it. In `@vollmond/core` a double-safe number is
>   a JavaScript `number` and an exact-only number is an `ExactNumber` carrying its canonical decimal text, and all comparisons go
>   through `equalNumbers` and `compareNumbers`.
> - **No rewriting.** A number the client did not change is never re-serialized. The source text of a number comes from the
>   parser's offsets (`jsonc-parser` node offsets, `yaml` scalar ranges), and an edit splices only the changed span (§13.3), so
>   `12345678901234567890` survives an edit elsewhere in the file, even in JavaScript. A YAML library's own writer is not used for
>   unchanged nodes, because it rewrites numbers (`yaml` writes `12345678901234567890` as `12345678901234567000` and `0x1F` as
>   `0x1f`).

### 7.2 §4.4

> vmd reads YAML 1.2 with the core schema: no implicit dates, and `yes`, `no`, `on` and `off` are strings. A reader must not resolve
> timestamps (`ruamel.yaml` does so even in 1.2 mode). Many tools still read YAML 1.1 (PyYAML; js-yaml's `YAML11_SCHEMA`, and its
> default schema before version 5; Ruby's Psych, used by Jekyll). So the serializer quotes every string that any of the following
> would read as something else, whichever reader is meant to be the cautious one, and `vmd check` warns about unquoted ones in
> strict mode.
>
> - timestamps: `2026-10-09`, `2026-10-09T08:00:00Z`, `2026-10-09 08:00:00`;
> - booleans, in any case: `yes`, `no`, `on`, `off`, `y`, `n`, `true`, `false`;
> - YAML 1.1 numbers: `017`, `0b101`, `1_000`, `1:30`, `1:30:00`, `1:30.5`;
> - YAML 1.2 numbers: `0o17`, `0x1F`, `1e3`, `.inf`, `.nan`;
> - `null`, `~` and the empty string;
> - `<<` and `=`.
>
> A serializer cannot rely on its YAML library to do this: the `yaml` package's default writer quotes none of the timestamps, none
> of the booleans, and none of `0b101`, `1_000` and `1:30`, and its `version: '1.1'` option leaves `0o17`, `<<` and `=` bare.

### 7.3 Appendix B

The block quoted in section 6.

### 7.4 Not drafted, for the owner to decide

- **§4.1.** Whether `1e400` is a valid number (section 5.4), and the unpaired surrogate and duplicate key rules, which no parser except
  `serde_json` enforces and which therefore need `core` code and fixtures.
- **§11.3.** The canonical text of a number that is not a double, so that node version tokens stay distinct (section 5.2). RFC 8785
  does not define one.
- **§13.3.** The bullet "YAML is written with a round-trip writer that keeps comments, key order and quoting" needs a qualifier for
  numbers (section 7.1), since the `yaml` writer rewrites them (M, `results/js-yaml.txt`: `1e3` to `1e+3`, `1e400` to `.inf`,
  `017` to `17`, `+1` to `1`). `ruamel.yaml`'s round-trip writer keeps most number formats but rewrote `-0` to `0`, `1e400` to
  `.inf` and `+1` to `1` (M, `results/py-yaml.txt`).
- **§20 question 2** can be closed once the owner picks a representation.

## 8. Noticed in passing

- `jsonc-parser`'s `parse` returns a value even when the error array is not empty; I1.2 should check the array first.
- `jsonc-parser` and `JSON.parse` reject a BOM, and every YAML parser measured accepts one (M). §13.3 keeps encoding "as found".
- `yaml` default `parse` of a comment-only or empty file gives `null`; PyYAML gives `None`; `js-yaml` 5 errors. The empty-record case
  needs a fixture.
- `ruamel.yaml` rt keeps a custom tag on a mapping as an attribute, not in the converted value (M); a check on `.tag` is needed.
- `js-yaml` 5 and `js-yaml` 4 differ enough (default schema, `-.5`, `-0`, `1e400`, complex keys) that the version belongs in a
  conformance report. Appendix C does not name `js-yaml`, so this affects only the survey and users' tools.
- The js-yaml 4 default schema turned `2026-13-45` into the Date `2027-02-14` (M).
- The npm registry would not connect from the Node bundled certificates on this machine
  (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`); `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` fixed it. `run-all.sh` documents this.
