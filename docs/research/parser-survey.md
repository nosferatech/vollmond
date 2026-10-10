# Parser survey for numbers, duplicate keys and YAML dialects

Report for I0.2 (GitHub issue #3), 2026-10-09. It answers open question 2 of [the proposal](../draft/vollmond-proposal.md)
(Draft v0.3). The proposal is not edited here; proposed wording is in section 7.

How each claim is marked.

- **M** measured by a script in [parser-survey/](parser-survey/), whose output is kept in `parser-survey/results/`.
- **D** documented, with the source named. Not run here.
- **I** inferred from other measurements. A hypothesis, not an observation.

## 1. Summary

1. **Appendix B holds up.** Every row was confirmed (Go from documentation only). Three statements need correcting.
   - The JavaScript row says "in engines that support it". The engines can be named (Node 21, Chrome 114, Firefox 135,
     Safari 18.4), and Node 24.21 was measured.
   - The paragraph on js-yaml says the default schema includes timestamps and the core schema does not. That is true of 4.3.2 and
     false of 5.4.3, whose default is the core schema.
   - The paragraph on `ruamel.yaml` says it defaults to YAML 1.2. It does, and it still reads `2026-10-09` as a date.

   The table also gains a column for `-0` and `1e400`, and the Python row gains the integer digit limit. Section 6 has the
   corrected table.
2. **A number's exact text is available from every parser the project plans to use.** `JSON.parse` revivers get `context.source`
   in Node 24.21, and `jsonc-parser` and `yaml` give offsets and ranges (all M). The reviver is not the right tool for `core`,
   because `core` needs offsets for splicing and for duplicate-key detection anyway.
3. **Evidence and design are kept apart in section 5.** The evidence is that a plain `number` merges distinct values beyond 2^53
   in equality, sorting, Ajv's `const` and `enum`, and in input to RFC 8785 (M). That a double is lossy does not decide whether the
   specification should require every number to be held exactly. Section 5 compares four ways to respond (hold exactly with a
   hybrid, hold exactly always, keep doubles with a side table, or keep doubles and report numbers a double cannot hold) and
   states what a recommendation rests on. The choice is the project owner's.
4. **Several rules in the proposal meet parser behavior that the proposal does not yet state.** They are listed in section 7.4 and
   are not spec changes made here. The main ones are that `yaml`'s own writer rewrites numbers (`12345678901234567890` becomes
   `12345678901234567000`), that RFC 8785 requires numbers a double can express, and that `yaml` turns `1` and `'1'` into one JS key
   without an error.

## 2. What was run

| Component | Version | How |
|---|---|---|
| Node.js | 24.21.0 (V8 13.6.233.17) | `js-json.mjs`, `js-yaml.mjs`, `js-number-representations.mjs` |
| `jsonc-parser` | 3.3.1 | npm, exact pin |
| `yaml` (eemeli) | 2.9.1 | npm, exact pin |
| `js-yaml` | 5.4.3 (current) and 4.3.2 (`v4-legacy` tag), side by side | npm, exact pins; 4.3.2 through the alias `js-yaml4` |
| `ajv` | 8.20.0 | npm, exact pin |
| `json-canonicalize` | 3.0.1 (an RFC 8785 implementation) | npm, exact pin |
| `lossless-json` | 4.3.1 | npm, exact pin |
| Python | 3.9.6 (system) | virtual environment `.venv/` |
| PyYAML | 6.0.3 (with libyaml; `safe_load` uses the pure loader) | `requirements.txt` |
| `ruamel.yaml` | 0.19.1 | `requirements.txt` |
| Rust | cargo 1.98.1, `serde_json` 1.0.151, `serde` 1.0.229 | `serde-json-check/`, default and `arbitrary_precision` |
| Java | OpenJDK 26.0.2.1, Jackson (databind and core) 2.22.3, annotations 2.22 | `jackson/run.sh` |
| Ruby | 2.6.10, Psych 3.1.0 (the system Ruby, old) | `ruby-yaml.rb` |
| Go | not installed | documentation only |

Notes on method. Dates in YAML output are shown in UTC. The timings and heap figures in section 5.2 are single runs on one laptop
and show orders of magnitude only; the report quotes the committed copy of `results/js-number-representations.txt`, and a rerun
changes those lines. The Ruby is the macOS system Ruby, so its Psych is old; read it as a sample of YAML 1.1 behavior, not of
current Jekyll.

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
- **`serde_json` with `arbitrary_precision` keeps digits but normalizes** (M). `1e0` prints `1e+0`, `-0` prints `0`, and equality
  of `0.10` and `0.1` is false. Its `RawValue` keeps the text exactly, including `1e400` and `-0` (M).
- **Jackson's `BigDecimal` mode drops trailing zeros** (`1.0` prints `1`, M). The streaming parser's `getText()` returns the exact
  text, including `1e400` and `-0` (M).
- **Python limits integer text length in `json.loads`.** D (<https://docs.python.org/3/library/json.html>, fetched 2026-10-09)
  says "Changed in version 3.11: The default parse_int of int() now limits the maximum length of the integer string via the
  interpreter's integer string conversion length limitation". The default limit is 4300 digits (D,
  <https://docs.python.org/3/library/stdtypes.html#int-max-str-digits>), and the same page says the APIs "were added in security
  patch releases in versions before 3.12" without listing the releases. The system Python 3.9.6 used here predates the limit
  (M, `sys.get_int_max_str_digits` is absent). That a 5000 digit integer raises `ValueError` on a current Python is inferred (I);
  a 30 digit integer is far from the limit.

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
| JS `JSON.parse` | `reviver(key, value, context)`, `context.source` | present for numbers, strings, booleans and null; absent for objects and arrays; absent for a value whose slot the reviver itself changed (M). Gave `1.0`, `-0`, `1e400`, `12345678901234567890` verbatim (M) | no offset, so no splicing and no duplicate detection. Engines (D, MDN browser-compat-data fetched 2026-10-09): Node 21, Chrome 114, Firefox 135, Safari 18.4, Deno 1.33, Bun 1.1.43. Cost (M, one run, section 5.2): 91 ms for 300000 numbers against 3 ms without a reviver |
| JS `JSON.rawJSON` | serialization of exact text | `JSON.stringify({a: JSON.rawJSON("12345678901234567890")})` writes the digits; `1.0` and `1e400` too (M). Primitive JSON text only | same engines |
| `jsonc-parser` | `parseTree`, `visit` | every node has `offset` and `length`; `text.slice(offset, offset + length)` is the lexeme (M). `node.value` is the rounded double | `modify` cannot take a raw lexeme (a `BigInt` value throws, M), so a splice is hand-written from the offsets (M, one line) |
| `yaml` 2.9.1 | `Scalar.source`, `Scalar.range`, CST token `source`, option `intAsBigInt` | `source` holds `1.0`, `0x1F`, `1e3`, `-0`, `0o17`, `1e400`, `+1`, `017`, and 20 digit integers verbatim, with the `range` (M). `intAsBigInt` gives exact integers, but turns `-0` into `0n` and leaves decimals as doubles (M) | `Document.toString()` rewrites numbers (section 5.1); a splice by `range` does not (M) |
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

The Psych `1:30` value of 5400 is what Psych 3.1.0 returned (M); the reason was not investigated. In the 1.1 reader column,
`yaml` with `version: '1.1'` also read the key `y` in `{x: 1, y: 2}` as `true` (M, `merge key` case in `results/js-yaml.txt`).

What this says for §4.4.

- **PyYAML and Psych confirm the proposal's three examples** (`2026-10-09`, `yes`, `1:30`) and add `017`, `0b101`, `1_000`, `1e3` (a
  string there, so no quoting is needed for it) and `on`/`off` in all case forms. The set of strings a 1.1 reader changes is
  larger than the three examples, and it differs by reader. `y` and `n` are booleans for `yaml` in 1.1 mode and `js-yaml 5`'s
  `YAML11_SCHEMA`, but strings in PyYAML and Psych.
- **`ruamel.yaml`'s default is YAML 1.2 for booleans, octals and sexagesimals, but it still resolves timestamps** (M). `ruamel.yaml`
  is the library Appendix C names for Python, so a Python implementation must remove the timestamp resolver to read `2026-10-09`
  as a string, as §4.4 requires of vmd. (That removing the resolver is possible is inferred, I; the loader's resolver table was not
  inspected.)
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

## 5. Keeping exact numbers in JavaScript

This section separates what the experiments show from what the specification should do about it. Section 5.2 is evidence.
Sections 5.3 to 5.5 are options and a recommendation, which is the project owner's to take or leave.

### 5.1 What the proposal asks for

The proposal says a number's meaning is its decimal value (§4.2). It requires integers within ±(2^53−1) to be exact and every
other number to be held "at least as an IEEE 754 double", and it requires an implementation that cannot represent a number
exactly to say so when it compares, sorts or validates it against an exact type (§4.2). An unchanged number is never rewritten
(§4.2, §13.3). Equality is by value (§5.8). A node's version is a hash of its RFC 8785 canonical JSON (§11.3). Ajv validates the
value view (Appendix C). The plan decides int64 as a number within ±(2^53−1) and a decimal string beyond it (plan, "Decided for
this plan"), and §4.3 gives `bigint` the same canonical form, so numbers the project itself writes never need more than a double.

The requirement that an unchanged number is not rewritten does not depend on the in-memory shape. If edits splice the source,
the number never passes through the value. Both splices are demonstrated (M). For JSON, `jsonc-parser` offsets replaced `1.0` and
left `12345678901234567890` alone (`js-json.txt`). For YAML, `Scalar.range` replaced `a: 1.0` by `a: 2` and left the comment, the
other numbers (`0x1F`, `1e3`, `0o17`, `1e400`) and the flow sequence byte for byte; `Document.toString()` on the same edit
changed `12345678901234567890`, `0x1F`, `1e3` and `1e400`, and the spacing before the comment (`js-yaml.txt`).

### 5.2 Evidence

All from `results/js-number-representations.txt`, `results/js-lossless-json.txt` and the files named (M unless marked).

- **A plain double merges distinct values.** `9007199254740993` and `9007199254740992` are `===`, and so are `12345678901234567890`
  and `...891`, and `1e400` and `2e400`. Sorting by `Number()` puts `...993` before `...992`.
- **Input to RFC 8785 must be doubles, and the experiment violates that on purpose.** RFC 8785 §3.1 (D,
  <https://www.rfc-editor.org/rfc/rfc8785>) says "JSON number data MUST be expressible as IEEE 754 double-precision values" and
  recommends strings for anything else. Fed the rounded double that `JSON.parse` returns, `json-canonicalize` 3.0.1 (the only
  RFC 8785 library tried) writes the same text and the same 16 hex digit token (`24bb430971eb50f9`) for `9007199254740992` and
  `9007199254740993`, and throws for `1e400`, which `JSON.parse` has already turned into `Infinity`. The collision is the
  consequence of the violated precondition, not a defect of the library. It does mean a store that hashes the double view would
  accept an `if_version` write against a changed value.
- **RFC 7493 §2.2 (D)** says I-JSON messages "SHOULD NOT include numbers that express greater magnitude or precision than an IEEE
  754 double precision". So §4.1's "restricted as I-JSON" and §4.2's allowance for other numbers sit on the soft side of that
  rule, and §11.3 needs a rule of its own if numbers that are not doubles are held.
- **Ajv is wrong on a rounded double and rejects every exact shape.** With a plain double, `enum: [9007199254740993]` accepts the
  data `9007199254740992`, and `type: integer` accepts `12345678901234567000`. `1e400` becomes `Infinity` and fails `type: number`.
  A `BigInt`, a `{text}` object, an object with `valueOf` and a `lossless-json` `LosslessNumber` all fail `type: number` and
  `type: integer`.
- **What makes a number exact-only.** A lexeme is *double-safe* when its decimal value equals the shortest decimal that round-trips
  for its nearest double (`String(Number(lexeme))`), and *exact-only* otherwise. Digit counts do not decide it. Exact-only
  examples are `9007199254740993` (16 digits), `0.10000000000000001` (17 digits, the 17 significant digit print of `0.1`),
  `12345678901234567890` and `1e400`. Double-safe examples are `1`, `1.0`, `2.50`, `1e21`, `1.00000000000000000000` (21 digits) and
  `100000000000000000000` (21 digits).
- **How common exact-only numbers are depends on the producer, and no real store was scanned.** Printing 20000 pseudo-random
  doubles with the shortest round-trip form gave 0 exact-only numbers; printing them with 17 significant digits (like `printf
  "%.17g"`) gave 12688, about 63 percent. The data is synthetic. Tools that print non-shortest 17 digit floats would therefore make
  exact-only numbers common, not rare, in the stores that ingest their output. Whether any store the project meets does so is
  open. The test bed (vampiredb's docs and tickets) can be scanned with the rule above in a few lines.
- **Costs of the shapes**, one run each on 300000 numbers in which 1 percent are exact-only and one in seven has a fraction
  (committed `results/js-number-representations.txt`; the timings change on every run and show orders of magnitude only).

| Shape built | Class used | Time | Retained heap |
|---|---|---|---|
| `JSON.parse`, plain doubles (rounds the exact-only numbers) | none | 3 ms | 2.5 MB |
| `JSON.parse` with a reviver reading `context.source` | a `{text}` stand-in object per number | 91 ms | 19.4 MB |
| `lossless-json` 4.3.1 `parse` | its `LosslessNumber` per number | 19 ms | 22.6 MB |
| `jsonc-parser` `visit`, every number wrapped (B) | `VmdNumber{text}` per number | 26 ms | 20.2 MB |
| `jsonc-parser` `visit`, plain unless exact-only (A) | `ExactNumber{text}` for the 1 percent | 39 ms | 4.0 MB |
| `jsonc-parser` `visit`, plain plus a `Map` from index to text (C) | a `Map` entry for the 1 percent | 34 ms | 3.3 MB |
| `jsonc-parser` `parse`, plain doubles (the base for D) | none | 22 ms | 3.1 MB |
| `jsonc-parser` `parseTree`, offsets kept for every node | none | 24 ms | 27.1 MB |

D has no row of its own. It is the `jsonc-parser` `parse` row plus one classification per number, which is the work row A does
besides allocating (estimated, I).

### 5.3 The options

| | A. Hold exactly, hybrid | B. Hold exactly, always | C. Doubles and a side table | D. Doubles, and report what a double cannot hold |
|---|---|---|---|---|
| Shape | `number` when double-safe, else `ExactNumber` holding the canonical decimal text | every number is an object holding the text (`VmdNumber`; `lossless-json` is a ready one) | `JSON.parse`-shaped doubles, and a map from path to text for exact-only numbers | `number` only; an exact-only number in a file is a diagnostic (warning, or error in strict mode) that names the path and recommends a string |
| What §4.2 says | every number is held exactly; double-safe and exact-only are defined | as A, without the classification | doubles plus an exactness side channel | "at least a double" stays; the diagnostic and the double-safe rule are added; canonical output never produces an exact-only number (int64 and bigint already write strings) |
| Equality (§5.8) | `===` for two plain numbers, an exact comparison when either is exact (M, prototype of about 30 lines) | one comparison for every pair | `===` on the view is wrong for flagged paths (M) | `===` on doubles. Two different exact-only numbers compare equal (M), which only the diagnostic reports |
| RFC 8785 (§11.3) | the RFC for plain numbers, an extension rule for `ExactNumber` (a canonical decimal text, M prototype) that no library implements | one rule for all, or the same extension with delegation | the view violates the RFC's precondition (M); the hash must read the table | the RFC unchanged. In error mode an exact-only number never reaches the hash; in warning mode the collision of section 5.2 remains |
| Ajv | untouched for plain numbers; an adapter and exact numeric keywords for exact ones | an adapter for every number (M) | untouched, and silently wrong on flagged paths (M) | untouched |
| VQL comparison and sorting | one comparator, with a plain fast path | one comparator | needs the path, which a projected value no longer has (I) | untouched, doubles |
| Serialization, no rewriting | splice from the source; `JSON.stringify` for plain, `JSON.rawJSON` (Node 21 and later) or `core`'s writer for exact | `core`'s writer or `JSON.rawJSON` | `JSON.stringify` writes the rounded double (M) | unchanged; splice from the source |
| Cost in other languages | every implementation reproduces the classification, the comparator and the RFC 8785 extension, even where numbers are natively exact (I) | as A | as A | one predicate and one diagnostic |
| Heap, 300000 numbers, 1 percent exact-only (section 5.2) | 4.0 MB (M) | 20.2 MB with `VmdNumber`, 22.6 MB with `lossless-json` (M) | 3.3 MB (M) | 3.1 MB for the base parse (M), plus one classification pass (estimated) |
| Failure mode | loud only if `ExactNumber` refuses to become a double (section 5.4) | uniform; user arithmetic needs an explicit conversion | silent | error mode is loud, and a foreign file with such a number cannot be read until changed; warning mode continues with a rounded value |
| Prior art | `lossless-json` offers the pieces (`isSafeNumber`, `getUnsafeNumberReason`, a custom number parser) | `lossless-json` (MIT) keeps every number's text in a `LosslessNumber` | none found | RFC 8785 §3.1 and RFC 7493 §2.2 recommend strings; Protocol Buffers' JSON mapping writes 64-bit integers as strings |

A variant of A holds exact-only integers as `bigint`. It still needs an object for exact-only decimals, `bigint` throws in
`JSON.stringify` (M) and fails Ajv's `integer` type (M), so it is not set out separately.

`lossless-json` 4.3.1 (M, `js-lossless-json.txt`) keeps the text of every number in a `LosslessNumber`. Its `valueOf()` returns
a `number` when that is safe or when only insignificant digits are lost, a `bigint` for an integer beyond the safe range, and throws
for `1e400` and `1e-400`; its `parse` rejects duplicate keys and trailing commas; `stringify` writes the text back; and
`LosslessNumber` fails Ajv's `type: number`. It shows what B costs in practice. Note that a `bigint` from `valueOf()` makes
`big + 1` throw ("Cannot mix BigInt and other types").

### 5.4 Pitfalls of holding numbers exactly (A and B)

- **Whether an exact object fails loudly depends on its `valueOf`, which the options do not fix.** Measured for an exact-only
  value (`9007199254740993`, `js-lossless-json.txt`). With no `valueOf`, `x + 1` is the string `"[object Object]1"`, `x >
  9007199254740992` is `false` and `Math.max(x, 1)` is `NaN`, all silent. With a `valueOf` that returns `Number(text)`, `x + 1`
  is `9007199254740992`, silent rounding again. Only a `valueOf` that throws is loud, and then every arithmetic or comparison
  operator on an exact value throws, which is the intent. A throwing `valueOf` has to be specified.
- **A value whose JavaScript type depends on its digits makes a rarely run code path.** In A, a test suite with small numbers
  never executes the `ExactNumber` branch of a consumer, and the first exact-only number in production does. TypeScript narrows
  this (the type `number | ExactNumber` makes arithmetic fail to compile) but only for code that is typed, and not for
  plain JavaScript or for data passed through `unknown`. B has no such branch, at the price in section 5.2.
- **The extension rule for RFC 8785 is new specification text.** No library implements a canonical form for numbers a double
  cannot express, so it needs fixtures and an implementation in every language.

### 5.5 Recommendation (for the project owner)

What the recommendation rests on.

1. §4.2 already says other numbers are held "at least as an IEEE 754 double" and that an implementation that cannot hold one
   exactly must say so. D takes that sentence literally and says it at parse time.
2. The project's own canonical forms (int64, bigint) already write large integers as strings, and RFC 8785 §3.1 and RFC 7493 §2.2
   recommend the same. So only foreign data can contain an exact-only number.
3. A and B put work in every implementation, including those whose language has exact numbers: the same classification, the
   same comparator, and an RFC 8785 extension no library provides. D puts one predicate and one diagnostic in each.
4. The measured costs favor A over B (4.0 MB against 20 MB for the same data) and favor both D and C over either. C is silent
   about the problem it is meant to solve (section 5.2), and the weaker reading of C, doubles with a diagnostic, is D.

Recommendation. Take D as the baseline for the first release, with the double-safe rule written into §4.2, a diagnostic code for
it, and error mode in strict validation. If foreign data with exact-only numbers has to be accepted and compared, take A, and
specify `ExactNumber` with a throwing `valueOf` and the extension rule for RFC 8785 in the same change. B is the choice if one
shape matters more than memory and ergonomics. C is not recommended in any form.

What would change it. A scan of the real data (vampiredb's docs and tickets) that finds exact-only numbers, especially 17 digit
floats from a producer the project must ingest, would favor A, because D would then report on ordinary data. A requirement to
keep numbers above 2^53 as numbers, for example hash values stored as integers, would also favor A. In warning mode D does not
prevent the version token collision; only error mode does. D is compatible with a later move to A, since A accepts what D
rejects and the strings D asks for remain valid (I).

Open points under either choice. What `-0` becomes (the lexeme stays in the source and the value is `0`, as Python's `json`
already reads it). Whether `1e400` is valid (it is valid JSON and a valid YAML 1.2 float, and outside every double and RFC 8785).
Whether `1e-400`, which a double rounds to `0`, is exact-only (the rule above says it is). Whether the double-safe rule should be
the weaker "survives a double printed with 17 significant digits", which accepts `0.10000000000000001` but then makes it equal to
`0.1`, against §4.2's "meaning is the decimal value".

## 6. Appendix B, corrected, ready to paste

> ## Appendix B. Numbers in common parsers
>
> Measured by the I0.2 survey (`docs/research/parser-survey.md`), except Go, which is from documentation. Versions are in the survey.
>
> | Parser | Integers | Beyond 2^53 | Non-integers | `-0`, `1e400` | Exact options |
> |---|---|---|---|---|---|
> | JavaScript `JSON.parse` | IEEE 754 double | silently rounded | double | `-0` stays negative zero; `1e400` is `Infinity` | a reviver's `context.source` (Node 21, Chrome 114, Firefox 135, Safari 18.4); `JSON.rawJSON` to write |
> | `jsonc-parser` | double in `node.value` | silently rounded in `value`; `offset` and `length` give the exact text | double | as `JSON.parse` | `parseTree` and `visit` offsets |
> | Python `json` | arbitrary precision `int` | exact | `float` | `-0` is `int 0`; `1e400` is `inf` | `parse_float=Decimal`, or `parse_int=str` and `parse_float=str` for the text. From Python 3.11, and in security releases of earlier versions, integer text longer than 4300 digits raises `ValueError` |
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

Section 7.1 offers the §4.2 change as alternatives, because the choice between them is a design decision (section 5.5). The
"no rewriting" bullet is common to both because the evidence (section 5.1) supports it either way.

### 7.1 §4.2

Replace the "Exact range" and "No silent rounding" bullets with one of the following.

**Option D, report what a double cannot hold.**

> - **Exact range.** Implementations must handle integers in ±(2^53−1) exactly, and every other number at least as an IEEE 754
>   double.
> - **Numbers a double cannot hold.** A number is *double-safe* when its decimal value equals the shortest decimal that round-trips
>   for its nearest double (so `1`, `1.0`, `2.50` and `1e21` are double-safe, and `9007199254740993`, `0.10000000000000001`,
>   `12345678901234567890` and `1e400` are not). A number that is not double-safe is reported as `number-not-representable`, a
>   warning, or an error in strict mode, and the message recommends a string. The serializer never writes such a number: int64,
>   bigint and decimal values beyond a double are strings (§4.3).

**Option A, hold exactly (hybrid).**

> - **Exact range.** Implementations must handle integers in ±(2^53−1) exactly. Every other number is held exactly too, by its
>   decimal text, wherever the implementation's number type would round it.
> - **No silent rounding.** A number is *double-safe* when its decimal value equals the shortest decimal that round-trips for its
>   nearest double, and *exact-only* otherwise. In `@vollmond/core` a double-safe number is a JavaScript `number` and an
>   exact-only number is an `ExactNumber` carrying its canonical decimal text, whose `valueOf` throws. All comparisons go through
>   `equalNumbers` and `compareNumbers`. §11.3 states how an `ExactNumber` is written in canonical JSON.

Both options keep this bullet.

> - **No rewriting.** A number the client did not change is never re-serialized. The source text of a number comes from the
>   parser's offsets (`jsonc-parser` node offsets, `yaml` scalar ranges), and an edit splices only the changed span (§13.3), so
>   `12345678901234567890` survives an edit elsewhere in the file, even in JavaScript. A YAML library's own writer is not used for
>   unchanged nodes, because it rewrites numbers (`yaml` writes `12345678901234567890` as `12345678901234567000` and `0x1F` as
>   `0x1f`).

### 7.2 §4.4

> vmd reads YAML 1.2 with the core schema, so there are no implicit dates, and `yes`, `no`, `on` and `off` are strings. A reader
> must not resolve timestamps (`ruamel.yaml` does so even in 1.2 mode). Many tools still read YAML 1.1 (PyYAML; js-yaml's `YAML11_SCHEMA`, and its
> default schema before version 5; Ruby's Psych, used by Jekyll). So the serializer quotes every string that any of the following
> would read as something else, whichever reader is meant to be the cautious one, and `vmd check` warns about unquoted ones in
> strict mode.
>
> - timestamps, such as `2026-10-09`, `2026-10-09T08:00:00Z` and `2026-10-09 08:00:00`;
> - booleans in any case, namely `yes`, `no`, `on`, `off`, `y`, `n`, `true` and `false`;
> - YAML 1.1 numbers, such as `017`, `0b101`, `1_000`, `1:30`, `1:30:00` and `1:30.5`;
> - YAML 1.2 numbers, such as `0o17`, `0x1F`, `1e3`, `.inf` and `.nan`;
> - `null`, `~` and the empty string;
> - `<<` and `=`.
>
> A serializer cannot rely on its YAML library to do this. The `yaml` package's default writer quotes none of the timestamps, none
> of the booleans, and none of `0b101`, `1_000` and `1:30`, and its `version: '1.1'` option leaves `0o17`, `<<` and `=` bare.

### 7.3 Appendix B

The block quoted in section 6.

### 7.4 Not drafted, for the owner to decide

- **§4.1.** Whether `1e400` is a valid number (section 5.5), and the unpaired surrogate and duplicate key rules, which no parser
  except `serde_json` enforces and which therefore need `core` code and fixtures.
- **§11.3.** If option A is taken, the canonical text of a number that is not a double, so that node version tokens stay distinct.
  RFC 8785 does not define one. If option D is taken, that error mode is what keeps the hash sound.
- **§13.3.** The bullet "YAML is written with a round-trip writer that keeps comments, key order and quoting" needs a qualifier
  for numbers (section 7.1), since the `yaml` writer rewrites them (M, `results/js-yaml.txt`, where `1e3` becomes `1e+3`,
  `1e400` becomes `.inf`, `017` becomes `17` and `+1` becomes `1`). The `ruamel.yaml` round-trip writer keeps most number
  formats but rewrote `-0` to `0`, `1e400` to `.inf` and `+1` to `1` (M, `results/py-yaml.txt`).
- **§20 question 2** can be closed once the owner picks an option.

## 8. Noticed in passing

- `jsonc-parser`'s `parse` returns a value even when the error array is not empty; I1.2 should check the array first.
- `jsonc-parser` and `JSON.parse` reject a BOM, and every YAML parser measured accepts one (M). §13.3 keeps encoding "as found".
- Empty-file handling differs. `yaml` `parse` gives `null`, PyYAML gives `None`, and `js-yaml` 5 errors. The empty-record case
  needs a fixture.
- `ruamel.yaml` round-trip loading keeps a custom tag on a mapping as a `tag` attribute of the loaded map, not in the converted
  value (M, `results/py-yaml.txt`), so a check on `.tag` is needed.
- `js-yaml` 5 and `js-yaml` 4 differ enough (default schema, `-.5`, `-0`, `1e400`, complex keys) that the version belongs in a
  conformance report. Appendix C does not name `js-yaml`, so this affects only the survey and users' tools.
- The js-yaml 4 default schema turned `2026-13-45` into the Date `2027-02-14` (M).
- `lossless-json` 4.3.1, MIT, is a ready implementation of option B and a source of pieces for option A. It was added to the
  survey late and its licence and maintenance were not otherwise reviewed.
- The npm registry would not connect from the Node bundled certificates on the machine used (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`);
  `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem` fixed it. `run-all.sh` documents this.
