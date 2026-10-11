# Design: phase I2 (validate and references)

Status: proposed, for the project owner's review (2026-10-11). It designs tasks I2.1 to I2.8 of [the implementation
plan](../plan/implementation-plan.md) (issues #21 to #28) against Draft v0.10 of [the proposal](../draft/vollmond-proposal.md)
(commit `d1e0a60` on `main`), and builds on [the I1 design](i1-read.md) and the code on `main` at `9c605a1`. Sections of the
proposal are cited as §n, decisions by their cards in the [decision log](../draft/vollmond-proposal-review.md), and the I1 design
as "I1 §n". Card I1's decision ids collide with the plan's task ids, so "I2.4" alone is a task. Section 12 lists the questions for
the owner; section 11 lists the places where the design reads the specification where it is silent, each to be confirmed or
corrected.

Claims are marked as in the I1 design. **M** is measured by a script in [`docs/research/i2-design/`](../research/i2-design/), with
its output in `results/`, on Node 24.21.0 on one laptop. **D** is documented, with the source named. **U** is unverified.

In brief:

- **Configuration** is read whole, with every problem `config-invalid` at its position. A configuration's own directory holds its
  schemas (`schema/` beside it), so `--config examples/vampiredb/config.yaml` brings its schemas along. Severities resolve late,
  in one function, so the index never depends on them.
- **Schemas** are validated with `@hyperjump/json-schema` rather than Ajv, if the owner agrees (question 1): Ajv ignores a member
  named `__proto__` of the null-prototype objects core builds, and wrongly satisfies `required: [toString]` on ordinary ones (M),
  while hyperjump gives no wrong verdict on Bowtie's 2020-12 run (D) or in the probes here (M). The logical types of §4.3 are
  vmd's own checks: `ajv-formats` departs from §4.3 on separators and offsets (D: §4.3), and hyperjump's formats refuse its leap
  seconds (M).
- **`x-vmd-list` and `x-vmd-ref` are read along a static spine** of the schema (properties, items, `$ref`, `allOf`), so that the
  proof of §7.4 needs no evaluation, and are an error under `oneOf` and the other conditional keywords (question 2). Keyed lists
  are evaluated natively, and the standard compilation of §9.3 becomes the oracle of a property test.
- **A record's binding** (keyed lists, declared section levels, typed references, schema issues) is computed once per file version
  and schema set. Address resolution, canonical addresses and `@key` take it, and the static proof raises `address-not-singular`,
  closing #15's first deviation.
- **References** are collected during the Markdown parse that already runs, with each destination's source range kept for I5's
  rewrites (M: the tree is unchanged). A second parse for links would cost as much as the first: 878 ms over vampiredb's docs (M).
- **The local index** is content-addressed JSONL in `.vmd/cache/`, one entry per file version in the portable index's row format,
  plus a snapshot of the last full check. A warm check re-parses nothing unchanged and re-resolves every reference, which costs 15
  ms for vampiredb's 2,006 (M).
- **vampiredb**: `vmd check` will report the 40 links into the 17 anchors that §6.2 does not make block anchors, which `docs.sh`
  accepts (card T, pending). Everything else resolves (M). A cold check without the index is estimated at about 1.1 s, within the
  plan's budget of 2 s for a warm one.

---

## 1. Module layout

### 1.1 `@vollmond/core`

New modules, and the I1 modules that change:

| Module (`src/`) | Responsibility |
|---|---|
| `config/` | the whole configuration of §9.1 (grows from `store/configuration.ts`); `Collection`; `classifyPath` into ignored, asset or record with its collection; the configuration's digest |
| `issue/severity.ts` | `applySeverities`: the uniqueness mode, `yaml_quoting` and the `issues` entries, within Appendix D's limits (section 2.5) |
| `store/path-rules.ts` | the path rules of §3.2, `filename-mismatch` and collection keys |
| `schema/` | loading schema files with vmd's own JSON and YAML readers; checking the `x-vmd-*` keywords; the spine (`SchemaShape`); the validator adapter; issues from its output |
| `schema/logical-types.ts` | the lexical checks of §4.3, each returning the value's parts for I3's comparisons |
| `binding/` | `bindRecord`: keyed lists, declared section levels, typed references, uniqueness, schema issues (section 4.1) |
| `address/` | the resolver over a `RecordStructure` and its binding, reporting how each step matched; `proveSingular`, the check of §7.4 |
| `reference/` | extraction (section 5.1), `resolveReferenceUri` (RFC 3986 against the citing path), statuses and targets, `x-vmd-ref`, aliases, the reference warnings |
| `check/` | `checkStore`: one record's checks and the store's, incremental over the index |
| `index/` | the rows of §14.2 in §14.4's line format; the `IndexCache` interface and a memory implementation; a `RecordStructure` rebuilt from rows |
| `format/markdown/` | also collects the references of the body and titles during the parse it already does (section 5.1) |
| `format/yaml.ts` | also raises `yaml-ambiguous-string` and `yaml-ambiguous-number`, deferred from I1 (I1 §3.3) |
| `store/` | `openStore` with a configuration source, an index cache and a read mode; `Store.binding`, `Store.references`, `Store.check` |

`ParsedRecord` keeps its I1 shape, and gains a supertype, `RecordStructure` (its path, format, node index, anchor table and
section keys), which is all that resolution and outlines read. The index rebuilds a `RecordStructure` without parsing (section 6).
No parser learns about configuration (I1 §2.4): the binding is applied after the parse, from outside.

### 1.2 `@vollmond/cli`

| Module (`src/`) | Responsibility |
|---|---|
| `configuration-file.ts` | a configuration source for the store's `.vmd/config.yaml` or the `--config` file, with the `schema/` directory beside it |
| `cache/` | the filesystem `IndexCache`: entries under `.vmd/cache/`, written by rename (section 6.2) |
| `backend/git-changes.ts` | the paths changed since a revision, for `check --changed` |
| `command/check.ts`, `refs.ts`, `schema.ts`, `index.ts` | the four commands of section 7 |
| `command/ls.ts`, `outline.ts`, `get.ts` | the collection column, the store-wide unreadable count, refs-in counts, `@refs` and `@collection` (the TODOs of #18) |

### 1.3 `js/packages/conformance`

`operations/check.ts` and `operations/refs.ts` are new. `resolve` and `meta` open the case's store through `openStore` with the
case's configuration, so that schemas apply; today they call `resolveStoreAddress` over a raw lookup. The declaration claims
`["read", "validate"]` once the first Validate pull request lands (section 13).

### 1.4 Dependencies

`core` gains `@hyperjump/json-schema` 1.18.0, its peer `@hyperjump/browser` 1.5.1, and `@hyperjump/json-schema-formats` 1.0.8 as a
direct dependency for four identifier formats (section 3.4), if question 1 is answered as recommended. All are pure JavaScript.
Their licences are to be confirmed at adoption, as for I1's (npm gives MIT for `@hyperjump/json-schema`; D: registry metadata).

- **Node APIs.** `@hyperjump/browser` imports `node:fs`, `node:process` and `node:url` in two modules, and its `package.json` maps
  both to browser variants through the `browser` field (M: read from the 1.5.1 package). Bundlers for the browser use those.
  Whether its type declarations reference Node's types, which core's `no-node-types` guard forbids, is U: the guard says so on
  adoption.
- **No network, no disk.** Core removes the `http`, `https` and `file` URI schemes when its validator module loads
  (`removeUriSchemePlugin`, D: the package's README). A `$ref` to an unregistered file then fails with a `RetrievalError` and
  reads nothing (M), which core reports as `schema-invalid`. The removal is global to the process, a cost of the library's global
  registry (section 3.1).
- No other runtime dependency. `ajv` and `ajv-formats`, which the plan names (§1.2), are not used.

---

## 2. Configuration (I2.1)

### 2.1 Reading

The configuration file is read as I1.8 reads it (#17): UTF-8 with a byte order mark skipped (J5), at most 1 MiB, one YAML document
read with vmd's YAML rules, the record-shape codes dropped, every problem a `config-invalid` at its position with `path: null` and
the file named in the issue's details. I2.1 reads every member and refuses one the specification does not define, so that a member
a newer minor version adds is never ignored, in the spirit of §9.1's detectable additions (reading R20); the message says it may
come from a newer version.

| Member | Value | Default |
|---|---|---|
| `vmd` | a number from 1, read as I1 reads it | required |
| `uniqueness` | `strict` or `lenient` | `strict` |
| `yaml_quoting` | `compatible` or `minimal` | `compatible` |
| `issues` | a mapping from issue codes to `off`, `warning` or `error`, within the limits of section 2.5 | none |
| `collections` | a mapping from collection names to collections | none |
| `ignore` | a list of globs (§11.2) | none |

A collection:

| Member | Value | Default |
|---|---|---|
| `match` | a non-empty list of globs over store paths | required |
| `exclude` | a list of globs | none |
| `schema` | a relative path, without `.` or `..` segments, in the schema directory (section 2.6) | none: the records are unschematized |
| `filename` | a pattern in the portable subset (§11.4), checked with core's `checkPortableRegex`, matched against the file name | none |
| `key` | `{filename: PATTERN}` with one capture group, or `{field: NAME}` | none |
| `query` | `{target: records}` or `{target: nodes}`, read and kept for I3 | none |

- **Member order carries no meaning** (§4.1). Collections are kept by name in UTF-8 byte order, so that nothing depends on the
  order they are written in, which a YAML mapping does not keep as data.
- **Globs** are checked with the filesystem backend's `compileGlob` rules (§11.2): a malformed one is `config-invalid` (M3).
- **Collection names** match `[A-Za-z][A-Za-z0-9_-]*`, so that one never contains `/`, `*` or `:`; reading R1, and question 9.
- **Collection keys** (`key`) give the `key` column of the index's `records` table: the first group of `filename`'s pattern, or
  the root field's value when it is a string or a number. The `collection:key` shorthand of §7.6 is not in I2's plan and waits.

### 2.2 Paths: ignored paths, assets, records, collections

`classifyPath(configuration, path)` gives what a store path is:

1. **Ignored**: a segment that starts with `.` (I1, #18), or a path an `ignore` glob matches. Ignored paths are passed to the
   backend's `list` and `grep` as `exclude` globs, the option #18 added for this, so that `ls` still counts exactly.
2. **A record**: a record extension, compared exactly (L4). Otherwise **an asset**.
3. **A record's collection**: every collection whose `match` matches and whose `exclude` does not. A record in no collection is
   valid and unschematized (§9.1). A record two collections claim breaks "a record belongs to at most one collection", for which
   Appendix D has no code: question 5.

`cat` still reads an ignored file (#18), and `get` does not find a record at an ignored path, since the store holds none there.

### 2.3 Path rules

`store/path-rules.ts` applies §3.2 to every listed path that is not ignored:

- `path-invalid`, once per rule broken: a segment outside `[A-Za-z0-9][A-Za-z0-9._-]*`, a segment over 255 bytes, a path over
  1,024 bytes, a path that is not NFC, a Windows reserved name (compared without regard to ASCII case, as Windows does: reading
  R2), a segment ending in `.`.
- `path-case-conflict` for each path after the first, in UTF-8 byte order, among paths equal under the per-code-point lower-case
  mapping of §6.3 step 3, whose tables core has (reading R2).
- Severity: an error for a record, a warning for an asset, since an asset is never in a collection (`match` globs name records).
  `at` is `""` for a record and null for an asset (Appendix D).
- `filename-mismatch` for a record of a collection with `filename` whose last segment does not match it.

### 2.4 What I2 adds to `ls`, `get` and `outline`

`ls` gains the collection column (#18's TODO), and `@collection` is the record's collection's name, absent for a record in none
(reading R3). `@refs` is section 5.7's. Refs-in counts and the store-wide count of unreadable records come from the index (section
6.5).

### 2.5 Severities

Issues are raised with Appendix D's default severity under strict uniqueness, and `applySeverities(issues, configuration)` turns
them into what is reported, at output, never in the index:

1. A raiser that knows the context gives it: `duplicate-key` at a level a schema declares `type: map` is an error in either mode
   (§5.7), and a path rule broken by an asset is a warning.
2. `uniqueness: lenient` makes `duplicate-key` and `duplicate-anchor` warnings at levels no schema declares.
3. `yaml_quoting: minimal` turns `yaml-ambiguous-string` and `yaml-ambiguous-number` off.
4. An `issues` entry sets the severity of every occurrence of its code that steps 1 to 3 left a warning or turned off, so it wins
   over the setting that implied a severity (§9.1), and it never lowers an error.

Appendix D's limits, as `readStoreConfiguration` checks them (question 6): an entry for a structural or an operation code is
`config-invalid`, since those cannot be configured; for a validation code whose occurrences are always errors (such as
`schema-violation` or `ref-dangling`) only `error` is accepted; for a code whose default is a warning, or whose severity depends
on its context (`duplicate-key`, `duplicate-anchor`, `path-invalid`, `path-case-conflict`, `not-representable`), any of the three
is accepted and applies to its warnings. An unknown code is `config-invalid`.

Because severities resolve at output, the index never holds them, and editing `issues` invalidates nothing (section 6.3).

### 2.6 `--config`, and where a configuration's files are

A configuration names its schemas relative to its own directory: in `schema/` beside the file. For `.vmd/config.yaml` that is
`.vmd/schema/`, as §9.1 says; for `--config examples/vampiredb/config.yaml` it is `examples/vampiredb/schema/`; for the suite's
`config` input, a file in `.vmd/`, it is `.vmd/schema/` again, which every case already assumes. `--config` replaces the whole
configuration; nothing is merged. Reading R4 generalizes §9.1's comment `# in .vmd/schema/` this way, since a store read
unmodified, such as vampiredb's `docs/`, cannot hold its schemas.

The store's own data stays in the store whatever configuration reads it: `.vmd/aliases.jsonl` (§13.6) belongs to the store. The
cache is the exception that needs a decision: writing `.vmd/cache/` into vampiredb's `docs/` would modify the checkout, which K3
forbids (question 4).

```ts
export interface ConfigurationSource {
  readonly content: Uint8Array;                 // the configuration file
  readonly name: string;                        // for messages: ".vmd/config.yaml", or the path given to --config
  readSchema(name: string): Promise<Outcome<Uint8Array>>;   // a file of the schema directory beside it
}
export function openStore(backend: StorageReader, options?: {
  readonly configuration?: ConfigurationSource;  // the backend's .vmd/config.yaml and .vmd/schema/ by default
  readonly cache?: IndexCache;                   // none: nothing persists between operations
  readonly readMode?: "best-effort" | "strict";  // section 4.6
}): Promise<Outcome<Store>>;
```

### 2.7 Byte order marks and sizes

Every file vmd reads skips a byte order mark at byte 0 (J5), which the suite's `validation/bom-config` case checks for a
configuration and a schema. The configuration and each schema file are at most 1 MiB, the bound I1.8 set for the configuration,
for the same reason (reading R5). The alias file has no bound in the specification; I2 reads it whole and sets none. Records have
none either, beyond the nesting bound of I1.

---

## 3. Schemas (I2.2)

### 3.1 Choosing a validator

The plan names Ajv with `ajv-formats` (§1.2, Appendix C). The options, checked on 2026-10-11:

| | Ajv 8.20.0 | json-schema-library 11.6.5 | @hyperjump/json-schema 1.18.0 |
|---|---|---|---|
| last release | 2026-04-24, after none from 2024-07 (D: npm) | 2026-10-09 (D: npm) | 2026-10-05 (D: npm) |
| Bowtie, 2020-12, 1,301 tests (run of 2026-10-11) | 27 wrong, 227 errored (D) | none wrong or errored (D) | none wrong, 4 skipped (D) |
| a `__proto__` member of a null-prototype object | ignored: `{"__proto__": 5}` passes `properties: {__proto__: {type: string}}` (M) | checked (M) | checked (M) |
| `required: [toString]` against `{}` from `JSON.parse` | passes (M): the prototype's member counts | fails, correctly (M) | fails, correctly (M) |
| where an error is | `instancePath`, an RFC 6901 pointer (M) | `#/a/b` for a member named `a/b`: `/` and `~` not escaped, so ambiguous (M) | `instanceLocation`, a URI fragment, percent-encoded (M) |
| a failing `oneOf` | the branches' errors and the `oneOf`'s (M) | one error (M) | the `oneOf`'s and the branches' (M) |
| `format` on numbers, as int64 needs | only by replacing the `format` keyword (M) | a format function sees any value (M) | a format handler sees any value (M) |
| `x-vmd-*` keywords | strict mode refuses unknown keywords, so each is declared (M) | ignored (M) | collected as annotations (D, M) |
| annotations, with failing branches dropped | no: a custom keyword runs in a failing `oneOf` branch (M) | no | yes (M) |
| code generation | `new Function` (D: `dist/compile/index.js`), so a page needs `unsafe-eval` under a CSP | none found (M: a search of `dist`) | none found (M) |
| API | synchronous | synchronous | compiling is asynchronous; a compiled validator is synchronous (D: README); a global registry |
| cold cost: import, compile a 200-property schema (M) | 10 ms, 26 ms | 4 ms, 2 ms | 26 ms, 12 ms |
| 1,000 validations of a 200-member record (M) | 6 ms | 41 ms | 25 ms (FLAG), 36 ms (BASIC) |
| size, runtime dependencies | 1.6 MB of `dist`, 4 | 117 KB, 6, one of them `valid-url` 1.0.9 | 380 KB, 7 with its peer |

Bowtie's numbers come from its published report for 2020-12 (`bowtie.report/draft2020-12.json`), summarized by
[`bowtie-summary.mjs`](../research/i2-design/bowtie-summary.mjs); how much of Ajv's "errored" is the harness's configuration
rather than Ajv is U. Among Ajv's wrong verdicts are the suite's "properties whose names are Javascript object property names" and
"required properties whose names are Javascript object property names", which the probes reproduce. `@cfworker/json-schema` 4.1.1
was probed too and reports every declared property of a null-prototype object as an additional one (M), so it is not in the table.

**Recommendation: `@hyperjump/json-schema`** (question 1). It is the only option without a wrong verdict in the probes or on
Bowtie, its locations are exact, it needs no code generation for I7's pages, and it gives annotation semantics should a later
version want them. Its costs: the format and output APIs are exported as `experimental` (D: README), so the version is pinned
exactly and raised deliberately; the registry and the format setting are global to the process, so core registers each schema
under a URI unique to the configuration, `https://vmd.invalid/<configuration digest>/schema/<file>` (`.invalid` never resolves, D:
RFC 2606 section 2); and it brings no messages, so vmd writes its own from the failing keyword and its value. Ajv's two defects
cannot both be worked around by choosing the objects it is given: null-prototype values break `__proto__`, and ordinary objects
break `required` and `properties` for `toString`, `constructor` and the prototype's other names (M).

### 3.2 Loading a collection's schema

1. **Read** the collection's `schema` file from the schema directory: `.json` with vmd's JSON reader, `.yaml` and `.yml` with its
   YAML reader, a byte order mark skipped, the record-shape codes dropped as for the configuration (a `$ref` beside other keywords
   is valid JSON Schema 2020-12, and `$defs` and `$schema` are ordinary members there). Any issue is `schema-invalid` at its
   position. So a YAML anchor or alias in a schema is an error, as in a record (reading R6).
2. **`$schema`** is absent or `https://json-schema.org/draft/2020-12/schema`; anything else is `schema-invalid`. **`$id`** is not
   supported in I2 (`schema-invalid`), since its base URI would break references between files by name; no schema of the suite or
   of Appendix A has one (reading R6).
3. **Other files** a relative `$ref` names are read from the same directory, transitively, before compiling. A `$ref` that leaves
   the directory, or has a scheme, is `schema-invalid`, since nothing is fetched.
4. **Check the `x-vmd-*` keywords** (section 3.3), then **compile** with the validator, which checks the schema against the
   2020-12 meta-schema (D: README, `setShouldValidateSchema`). Its `InvalidSchemaError` becomes `schema-invalid` at the positions
   of the output's locations in the schema file.

Schemas compile once per collection per store, when a command first needs one, so `ls`, `cat` and `grep` never load them. A
collection whose schema is invalid: question 11.

### 3.3 The extension keywords and the spine

vmd checks the keywords of §9.3 before the validator sees the schema:

- **`x-vmd-list`**: `type` is `map` or `multimap`; `keys` a non-empty list, each `@key`, a JSON Pointer or a member name; `@key`
  only on a `$sections` array, and a `$sections` array keyed by `["@key"]` only (reading R7); a single key member (question 8);
  `required` a list of strings; `items` a mapping from key values to schemas; `additional` a boolean or a schema.
- **`x-vmd-ref`**: `targets` a list of strings, `cardinality` `one` or `many`, `anchors` `any` or `explicit`; on a schema for a
  `$ref` object, or for a string with `format: uri-reference` (reading R8).
- **`x-vmd-summary`**: a boolean. **`x-vmd-ordered`**: `asc` or `desc`, beside an `enum`.
- A malformed keyword is `schema-invalid`. An unknown `x-vmd-*` keyword is `feature-unsupported`, of class operation in a schema
  (Appendix D).

**The spine.** `x-vmd-list` changes what an address means and `x-vmd-ref` what a value is, so vmd must know, for each node of a
record, which of them apply. The spine is the part of a schema reached from its root through keywords whose subschema for an
instance location does not depend on the instance's validity: `properties`, `patternProperties`, `additionalProperties`,
`prefixItems`, `items`, `$ref` (to a fixed location), `allOf`, and `x-vmd-list`'s own `items` and `additional`. It does not go
through `anyOf`, `oneOf`, `not`, `if`, `then`, `else`, `dependentSchemas`, `contains`, `propertyNames`, `unevaluated*` or
`$dynamicRef`.

An `x-vmd-list` or `x-vmd-ref` that the spine does not reach is `schema-invalid` (question 2), so that what an address means never
depends on which branch of a `oneOf` the data happens to satisfy, and the proof of §7.4 can work from the schema alone. Two
declarations that the spine brings to one location, through `allOf`, must be equal. `x-vmd-summary` and `x-vmd-ordered` are left
to I3, whose queries read them. A schema with `unevaluatedItems` beside `x-vmd-list` is `schema-invalid`, since the validator does
not see the list's items as evaluated (reading R7).

```ts
export interface SchemaShape {                  // a schema location, as the spine sees it
  readonly location: string;                    // "ticket.schema.yaml#/properties/parent"
  child(step: ShapeStep): readonly SchemaShape[];   // a member name, an item index, or a keyed-list key
  readonly list: ListDeclaration | null;        // x-vmd-list, here
  readonly ref: RefDeclaration | null;          // x-vmd-ref, here
  readonly format: string | null;               // the logical type, for I3
  readonly summary: boolean;
  readonly ordered: "asc" | "desc" | null;
}
```

`vmd schema` (section 7.3) and I3's typed comparisons read the same shape.

**Keyed lists are evaluated natively.** §9.3 defines a member-keyed list by its compilation to standard JSON Schema. Core
evaluates it directly instead, for two reasons: a list keyed by `@key` has no standard form, since the key is not in the instance,
so a native evaluation exists anyway; and a duplicate must be `duplicate-key` at the second item, not a `schema-violation` from a
`maxContains` that a reader cannot connect to its cause. The compilation stays the definition: a property test runs the validator
over the compiled form and over core's evaluation and requires the same verdicts (section 10). Per-key schemas are checked through
a wrapper whose `$ref` points into `x-vmd-list`'s `items`, which the validator resolves, although they sit inside a keyword it
does not know (M: [`hyperjump-subschema.mjs`](../research/i2-design/hyperjump-subschema.mjs)).

### 3.4 Logical types

`schema/logical-types.ts` implements §4.3's lexical spaces itself: neither `ajv-formats` (§4.3: a space separator, `+02` offsets)
nor `@hyperjump/json-schema-formats` (M: it refuses `23:59:60Z` and `01:59:60+02:00`, which J1 accepts) can be used for dates and
times. Each check is a small grammar over the string, never `Date.parse`, whose reading of other formats is implementation-defined
(D: ECMAScript 2025, section 21.4.3.2), and returns the value's parts, so that I3 compares by instant without parsing again.

| Type | Check | Applies to |
|---|---|---|
| `date` | RFC 3339 `full-date`, with the days of each month and the Gregorian leap years | strings |
| `time` | `full-time`: any fraction, `Z` or `z` or a numeric `±hh:mm` offset, `60` seconds only at 23:59 UTC after the offset (J1) | strings |
| `date-time` | `full-date`, `T` or `t`, `full-time`; no space (H2.7) | strings |
| `local-date-time` | `full-date`, `T`, `t` or a space, `partial-time` with any fraction; `60` seconds only at 23:59, taken as UTC (J1) | strings |
| `duration` | RFC 3339 Appendix A's ABNF exactly, without regard to case | strings |
| `int64` | a number that is an integer-valued double in [−2^63, 2^63−1], compared as a `BigInt`; or a string matching `-?(0\|[1-9][0-9]*)` in that range, `"-0"` included | numbers and strings |
| `bigint` | as `int64`, unbounded | numbers and strings |
| `decimal` | XML Schema 1.1's decimal, without white space | strings |
| `uri`, `uri-reference`, `email`, `uuid` | `@hyperjump/json-schema-formats`' `isUri`, `isUriReference`, `isEmail`, `isUuid`, which agree with every identifier case of the suite (M) | strings |

A format applies to the JSON types its row names and passes any other value, as JSON Schema's `format` does. Every other format
name stays an annotation (§4.3): core registers handlers for exactly these names and does not load the library's own format
module, and an unknown format then validates (M).

### 3.5 From the validator's output to issues

The validator runs on the record's value view in BASIC output (D: README), and its errors become `schema-violation` issues:

- `at` is the error's instance location, percent-decoded into an RFC 6901 pointer, which is the node's exact path. Where the
  keyword names a member, the issue goes to the member: an extra member for `additionalProperties` and `unevaluatedProperties`,
  the object itself for `required` (Appendix D: "the value").
- **One issue per value.** Errors under a failing `anyOf`, `oneOf` or `not` are dropped in favour of the applicator's own error at
  the same instance location, and the remaining errors at one location are merged into one issue whose message lists them. The
  suite expects one issue per failing value (`values/logical-types`), and an agent fixes a value, not a keyword (reading R9).
- The message is vmd's, from the keyword and the schema's value at the error's keyword location: `must be one of Open, In
  progress, Blocked, Closed`, `must be a date (RFC 3339 full-date)`. Its position is the node's, from the record's source map.

### 3.6 Types

```ts
export interface CollectionSchema {
  readonly collection: string;
  readonly digest: string;                      // of every schema file it reads, for the index
  readonly root: SchemaShape;
  validate(value: ValueObject, record: RecordStructure): readonly Issue[];   // schema-violation, positioned
}
export interface ListDeclaration {
  readonly type: "map" | "multimap";
  readonly key: "@key" | { readonly member: string };
  readonly required: readonly string[];
  readonly items: ReadonlyMap<string, SchemaShape>;   // the per-key schemas
  readonly additional: boolean | SchemaShape;
}
export interface RefDeclaration {
  readonly targets: readonly string[] | null;   // null: any target (J6)
  readonly cardinality: "one" | "many";
  readonly anchors: "any" | "explicit";
}
```

---

## 4. Keyed lists and uniqueness (I2.3)

### 4.1 A record's binding

```ts
export interface RecordStructure {               // what ParsedRecord has, and the index rebuilds without a parse
  readonly path: string;
  readonly format: RecordFormat;
  readonly nodes: NodeIndex;
  readonly anchors: AnchorTable;
  readonly sectionKeys: ReadonlyMap<string, string>;
}
export interface RecordBinding {
  readonly structure: RecordStructure;
  readonly collection: Collection | null;
  readonly lists: ReadonlyMap<string, KeyedList>;           // by the array's exact path, $sections arrays included
  readonly shapes: (at: string) => readonly SchemaShape[];  // the spine's locations of a node, for the proof
  readonly references: readonly ReferenceOccurrence[];      // section 5.1, typed references included
  readonly issues: readonly Issue[];                        // the parse's, adjusted, and the schema's
}
export interface KeyedList {
  readonly at: string;
  readonly type: "map" | "multimap" | "undeclared";         // undeclared: a $sections array no schema declares
  readonly keyOf: (index: number) => string | null;         // an item's key; null for an item without one
}
export function bindRecord(record: ParsedRecord, schema: CollectionSchema | null): RecordBinding;
```

`bindRecord` walks the value view and the spine together, once:

1. Each node gets its spine locations; each array with an `x-vmd-list`, and each `$sections` array, becomes a `KeyedList`. A
   member-keyed item's key is its key member's string value; an item without one has none (question 8).
2. The validator checks the value (section 3.5).
3. Each declared list is evaluated natively: `duplicate-key` at each item after the first whose key repeats, under `type: map`, an
   error in either mode; nothing under `multimap`; a `schema-violation` at the list for a missing `required` key, at an item for a
   failing per-key schema, and at an item whose key `additional: false` does not allow.
4. The parse's issues are adjusted for the declarations: a `duplicate-key` among sections at a level declared `multimap` is
   dropped, since repeats are allowed there, and one at a level declared `map` is marked as declared, so that lenient mode does
   not lower it (section 2.5).

A record in no collection gets the same binding with no schema: its `$sections` lists are undeclared, its data arrays plain.
`Store.binding(path)` gives a record's binding, once per operation, and the index keeps it per file version and schema digest
(section 6).

### 4.2 Keyed lists in resolution

I1's resolver takes a `RecordBinding` in place of a `ParsedRecord`; a record without a binding resolves as in I1. A step into an
array that is a keyed list matches the items whose key equals the step, compared by code point, and never an index (§7.3), so
`#benchmarks/append-4k/p99_us` reaches `/benchmarks/0/p99_us` (the suite's `keyed-list-step`). Without the binding the same step
would match nothing.

Resolution also reports how each step matched, for `x-vmd-ref`'s `anchors: explicit` and the warnings of §6.3 (section 5.6):

```ts
export type StepMatch =
  | "member" | "section-member"                  // a field or member name; $title, $body, ... (C17)
  | "key-explicit" | "key-title"                 // a section key from $anchor, or from the title's slug
  | "list-key" | "index"                         // a keyed-list key; a position, in a semantic or an exact path
  | "anchor-explicit" | "anchor-derived" | "anchor-block";
```

A step that matches one node in several ways records each way; a key and a derived anchor of one node stay one match (I1 §4.2).

### 4.3 Uniqueness, strict and lenient

The modes change severities only (I1 §4.2, section 2.5), and the declarations change what is a duplicate:

| Level | Strict | Lenient |
|---|---|---|
| declared `type: map` (`$sections` or data) | `duplicate-key` error | `duplicate-key` error |
| declared `type: multimap` | allowed, no issue | allowed, no issue |
| undeclared `$sections`, and the one namespace of fields and section keys (§5.7) | `duplicate-key` error | `duplicate-key` warning |
| anchors (§6.1) | `duplicate-anchor` error | `duplicate-anchor` warning |
| data arrays without `x-vmd-list` | not keyed: no duplicates | the same |

### 4.4 The proof of §7.4: `address-not-singular`

#15's first deviation closes here. `proveSingular(binding, fragment)` runs before evaluation, wherever a singular address is used
(`get`, `outline`, `resolve`, references of cardinality one, and forms 2 and 3 of a canonical address). It fails with
`address-not-singular`, `path` the record's and `at` null (H1.2), when some step could cross a level declared `multimap`:

- An exact path, and the root, are always singular (§7.2).
- The first step crosses the root's level: its fields and its child sections. It may also match an anchor (§7.3). The proof looks
  the name up in the record's anchor table and continues from each node it names. That lookup is not evaluation of the path, but
  it does read the record; §7.4's "before evaluating anything" is read this way (reading R10), since where an anchor's node sits
  in the schema cannot be known from the schema alone.
- Each later step crosses the level of the locations the previous step can reach, which the spine gives without data: a section's
  fields and child sections, whose level is its `$sections` declaration; a keyed list's items, by the step as the key, so
  `x-vmd-list.items[step]`, else `additional`, else the array's `items`; an object's members; an array's items.
- A location the schema does not constrain has no declarations below it, so nothing there is rejected. Lenient mode and duplicate
  data are not rejected either: they are §7.4's cases that fail at evaluation.

So `journal/week-41.md#log/entry-1` fails as `address-not-singular` although no Entry has the key `entry-1`, and
`#log/nothing-here` fails the same way, whether or not a `log` section exists: the declaration of the level decides (the suite's
`multimap-suffix-not-singular`). The cost is a few map lookups per step.

### 4.5 Canonical addresses and `@key`

Form 2 of §7.5 writes a keyed-list item by its key: `/benchmarks/1/p99_us` is `#benchmarks/read-4k/p99_us` (the suite's
`keyed-list-exact`). A form is singular only if `proveSingular` accepts it and evaluation finds that node alone, so through a
`multimap` level form 2 fails and form 3, the derived anchor, wins: the two Entries of `journal/week-41.md` are `#entry` and
`#entry-1` (`multimap-meta`). `@key` of a keyed-list item is its key (§5.10); an item without one keeps its index. A block anchor
whose name is not singular keeps core's fallback to its `$body`'s address, which #20's second open item leaves to the owner.

### 4.6 The strict read mode

§9.5's strict read mode (G7) was deferred to I3 because its codes come from schemas (I1 §5). With the binding of section 4.1,
every input it needs exists in I2: a strict store refuses a record with a structural error or with `schema-violation`,
`ref-target-not-allowed`, a declared `duplicate-key` or `filename-mismatch`, and a refused record is an error, not a result.
`openStore(…, {readMode: "strict"})` gives it in core; `ls` counts refused records with the unreadable ones. Whether the CLI gets
a global `--strict` now, which §12.1 does not list, is question 10. `ref-target-not-allowed` needs references resolved, so a
strict `get` of one record resolves that record's typed references.

---

## 5. References (I2.4)

### 5.1 Extraction

```ts
export interface ReferenceOccurrence {           // what a record says, independent of its path
  readonly form: "link" | "definition" | "ref-object" | "typed";
  readonly at: string;                          // the $ref object or the typed string; the $body or $title of a link
  readonly offset?: number;                     // a link's position in that string's value, in UTF-8 bytes (§5.9)
  readonly raw: string;                         // the target as written
  readonly uri: string;                         // the URI reference vmd resolves; raw except for Markdown (below)
  readonly destination?: ByteRange;             // where raw is in the file: what I5 rewrites
  readonly declaration?: RefDeclaration;        // from x-vmd-ref
}
```

**Markdown.** The parse of I1 already walks every node of the body's tree for its nesting check. I2.4 adds two exit handlers to
the mdast compiler, for `resourceDestinationString` and `definitionDestinationString`, that set `url` as the library's own
handlers do and also keep the token's range; extension handlers replace the defaults by key (D: `configure` in
`mdast-util-from-markdown` 2.1.0, `Object.assign` of `exit`). On 23 inputs the tree with them equals the tree without (M:
[`markdown-link-probes.mjs`](../research/i2-design/markdown-link-probes.mjs)). The same walk collects `link` and `definition`
nodes, and the link's position maps to the `$body` or `$title` that holds it:

- `raw` is the destination's source text: `x&amp;y.md`, `x\_y.md`, and `x y.md` for `<x y.md>` (M). `uri` is the destination as
  CommonMark reads it, entities and escapes decoded: `x&y.md`, `x_y.md` (M). §8.2 resolves the URI reference, which is `uri`.
- `offset` is the start of the link, its `[`, in the value: the suite's `See [a](…)` gives 4. A `$body`'s offsets go through I1's
  line-break map (I1 §2.2); a `$title`'s through a small map that removes the anchor element and joins a setext title's lines.
- A reference link `[text][label]` is not a reference; its definition is, once, wherever it is used (§8.1).
- Not references, and not collected: autolinks and autolink literals, which have a scheme and so leave the store (M: no
  destination token); links in code spans, code blocks, HTML blocks and comments (M); a raw `<a href>` (M); images, unless
  question 7 says otherwise; a `linkReference` whose label has no definition.

A separate mdast parse for links would cost as much as the record's own parse: 878 ms over vampiredb's docs against 940 ms (M).

**Prose in JSON and YAML** (C21). Each `$body` string of a section is parsed as a Markdown document of its own, and each `$title`
as the content of an ATX heading (K8), with offsets into the string itself. These parses run only in `check`, `refs` and the
index, never for `get`.

**`$ref` objects** (§8.1) are found by I1's shape walk wherever they stand in a field's value, schema or not: `form:
"ref-object"`, `at` the object. **Typed strings** come from the binding: a string whose spine location has `x-vmd-ref` and that is
a valid `uri-reference`; an invalid one is the `schema-violation` and no reference (reading R11).

### 5.2 Resolving a target

`resolveReferenceUri(citingPath, uri)` follows RFC 3986, with the store as the base:

1. A scheme or an authority: outside the store, and not a reference vmd tracks (§8.2). It raises nothing and is not listed.
2. The path is merged with the citing record's path (section 5.2 of RFC 3986), or taken from the store root when it starts with
   `/` (§8.2's store-root form). Dot segments are removed by vmd's own walk, which reports a path that climbs above the root as
   outside the store: RFC 3986's `remove_dot_segments` drops the excess `..` silently, so that `../../../g` against
   `http://a/b/c/d;p?q` is `http://a/g` (D: section 5.4.2).
3. The path is percent-decoded as UTF-8 into a store path; one that does not decode is `ref-dangling` with that message. An empty
   path is the citing record; a path ending in `/` names a directory.
4. A query is ignored, so `x.md?plain=1#a`, which GitHub's file views use, resolves as `x.md#a` (reading R12). The fragment is
   kept as written, and read as §7.1 reads an address, percent-decoding included.

What the store path is comes from the store's file list, read once per operation: a record, readable or not; an asset (an ignored
file counts as one, reading R13); a directory, which exists when a listed path is below it; or nothing.

### 5.3 Status and targets

| Target | Status (§8.5) | `targets` | Issue |
|---|---|---|---|
| nothing at the path | `dangling` | none | `ref-dangling` |
| an asset or a directory | `ok` | `{path}` (a fragment is ignored) | none |
| a record, no fragment or `#` alone | `ok`, also when the record is unreadable (J3) | the root, `{path, at: "", address: ""}` | none |
| an unreadable record, with a fragment | `unreadable` | none | `ref-target-unreadable` (warning) |
| a record, singular, not provably singular | `ambiguous` (question 3) | none | `ref-ambiguous`, with the reason |
| a record, singular, no match | `dangling`, unless an alias resolves it (section 5.5) | none | `ref-dangling` |
| a record, singular, several matches | `ambiguous` | the matches (reading R14) | `ref-ambiguous`, with the candidates |
| a record, `cardinality: many` | `ok`, also with no match (G5) | every match | none |
| through an alias | `aliased` | the alias's target | `ref-aliased` (warning) |

A malformed fragment, which `resolve` would refuse with `address-malformed`, is `ref-dangling` with that message, since a
reference's issue is about the reference (reading R14). Every issue is at the reference: `path` the citing record's, `at` the node
of section 5.1, with `offset` for a link (Appendix D's note on prose).

### 5.4 `x-vmd-ref`

- **`targets`**: the target's store path must match one entry. An entry that names a collection of the configuration matches that
  collection's records; any other entry is a glob over store paths (question 9). An asset or directory target is checked by its
  path. Without `targets`, anything is allowed (J6).
- **`cardinality: many`** resolves the fragment as a selector: no proof, every match, an empty result valid in a record that
  exists (G5), and `ref-dangling` for a record that does not (decision I1.8).
- **`anchors: explicit`** (G4, G10) refuses a reference any of whose steps matched only by `key-title`, `anchor-derived` or
  `index` (section 4.2): no title-derived name, no position in a semantic or an exact path. A step that matched one node by an
  allowed way too, such as `#done` naming a heading by its explicit anchor and its derived one, is allowed.
- A breach is `ref-target-not-allowed` at the reference; the status stays what resolution gave, since the target exists.

### 5.5 Aliases

`.vmd/aliases.jsonl` is read once per operation that resolves references (C22). Each line is a JSON object with `kind` `record`
(`from`, `to`) or `anchor` (`record`, `from`, `to`), and `at`, a date-time; anything else, a malformed path or anchor name
included, is `alias-file-invalid`, an operation error, and `check` stops with it, since without the aliases some references would
be reported as dangling that are not (reading R15). A reference that resolves through no live node is tried through the aliases:

1. a record alias whose `from` is the path, followed through chains with a guard against cycles;
2. then, in the record found, an anchor alias whose `from` is the fragment's first step, the remaining steps unchanged.

A live node always wins (§13.6), so an alias is consulted only when the live resolution is `dangling`. `alias-shadowed` warns for
each live anchor or record path that equals an alias's `from`. Writing the file is I5's.

### 5.6 The reference warnings

- **`ref-derived-anchor`**: the first step matched only by `anchor-derived` or `key-title`, both title-derived (G4), and the slug
  is not repeated in the record. **`ref-derived-repeat`** in its place when another heading of the record has the same slug, so
  that `#notes` and `#notes-1` both warn while two `## Notes` exist (§6.3). That needs each heading's slug beside its derived
  anchor, which the anchor table keeps from I2.4 on. vampiredb's docs have no reference through a derived anchor (M).
- **`ref-retargeted`**: a reference whose resolved exact path differs from the one in the previous index (§13.5), which is the
  snapshot of section 6.2. A reference is identified across runs by its citing path, node, form, `raw`, and its rank among the
  references with the same four in that node (reading R16); offsets are not used, since an edit above it moves them.
- **`alias-shadowed`**: section 5.5. The retitle and move detection of §13.5, and `check --fix`, are I5's (§21).

### 5.7 Types, and `@refs`

```ts
export type ReferenceStatus = "ok" | "dangling" | "ambiguous" | "aliased" | "unreadable";
export type ReferenceTarget = Target | { readonly path: string; readonly kind: "asset" | "directory" };   // #15, deviation 2
export interface Reference extends ReferenceOccurrence {
  readonly from: { readonly path: string; readonly at: string; readonly offset?: number };
  readonly status: ReferenceStatus;
  readonly targets: readonly ReferenceTarget[];
  readonly steps?: readonly StepMatch[][];      // how each step matched, for a record target
  readonly issues: readonly Issue[];            // the ref-* issues it raised, at their default severities
}
// Store.references({ from?: ADDRESS, to?: ADDRESS }): the references made in a node and below, or into a node and below.
```

`@refs` of a node is the list of its references in the shape `refs` gives without `from`: `raw`, `status`, `targets`, and `offset`
for a link. `Target` itself keeps I1's shape; the path-only targets of #15's second deviation are a separate type.

---

## 6. The local index (I2.5)

### 6.1 What it holds

The four tables of §14.2, in the row format of the portable index (§14.4, C28), split by what each row depends on:

| Entry | Keyed by | Holds |
|---|---|---|
| a file version's parse | blob id, format, implementation id | the `records` row without path or collection; the `RecordStructure` as `nodes` and anchor rows; the reference occurrences; the parse's issues (validation ones, or the structural errors of an unreadable record) |
| a file version's binding | the same, and the collection's name and schema digest | the keyed lists, the typed references, the binding's issues, the collection key |
| the snapshot of the last full check | (one per store) | each path's version, and each reference's resolved exact path and status: the "previous index" of §13.5 |

Values are not kept: nothing in `check` reads a value once the binding exists, and §14.2's `nodes` table holds none. Two columns
of §14.2's `nodes` are left out of the local entries: node versions, since nothing local reads them and each hashes its node's
canonical JSON, and semantic paths, which are canonical addresses and are computed from the structure when read. The portable
index of I7 writes both. Severities are never stored (section 2.5).

```json
{"t":"record","format":"md","size":672719,"tokens":168180,"title":"Minimal Log","readable":true}
{"t":"node","at":"/$sections/0","parent":"","key":0,"kind":"section","range":[1301,2914],"depth":1,"section_key":"vocabulary","heading":{"level":2,"range":[1301,1345],"slug":"0-vocabulary","derived":"0-vocabulary"}}
{"t":"anchor","name":"vocabulary","kind":"explicit","at":"/$sections/0"}
{"t":"ref","form":"link","at":"","offset":411,"raw":"#what-each-extension-adds","uri":"#what-each-extension-adds","destination":[820,846]}
{"t":"issue","code":"anchor-element-ignored","severity":"warning","at":"/$sections/12/$body","position":{"offset":61234,"line":1319,"col":3}}
```

(The figures are illustrative.) Rows carry no path, so one entry serves every path with those bytes, on every branch (§14.3).

### 6.2 Layout, keys and writing

```
.vmd/cache/
  .gitignore                          "*", so that the cache is never committed by mistake (§14.3)
  v1-<implementation id>/
    parse/<2 hex>/<blob id>.<format>.jsonl
    bind/<2 hex>/<blob id>.<format>.<collection>.<schema digest>.jsonl
    snapshot.json, snapshot-refs.jsonl
```

- **The implementation id** is a hash of core's sources, which the build writes into `dist/` (a small script beside
  `generate-unicode.mjs`), so that an unreleased build that changes the parser never reads another build's entries. A directory of
  another id is removed by `vmd index`.
- **Writes** go to a temporary file renamed into place. An entry's bytes are a function of its key, so two processes that write
  one entry at once write the same bytes; the snapshot is written whole, and the last writer wins with a consistent file.
- **Who writes**: `check`, `index`, `refs`, `ls` and `outline` read the cache and write what they parse. `get`, `cat` and `grep`
  neither read nor write it, so a plain read stays free of side effects.
- **The cache interface** is core's, so that the Lambda functions of I6 and I7 can keep it elsewhere:

```ts
export interface IndexCache {
  read(key: string): Promise<Uint8Array | null>;      // an entry's JSONL, or null
  write(key: string, rows: Uint8Array): Promise<void>; // a failed write is ignored: the cache is optional
}
```

A cache that cannot be written raises no issue, since Appendix D has no code for it and nothing is wrong with the store; `vmd
index` says how many entries it could not write.

Where the cache goes for a store read with `--config` and no `.vmd/` of its own, vampiredb's `docs/`, is question 4.

### 6.3 Invalidation

An entry is valid exactly while its key matches, so nothing is ever invalidated in place:

- a changed file has a new blob id, so its parse and binding are looked up afresh; an old commit's files find their old entries;
- a changed schema file changes the schema digest of every collection that reads it, so only the bindings miss, and they need the
  value, so those records are parsed again;
- a changed configuration changes nothing cached unless it changes a collection's schema or the records it claims; `issues`,
  `uniqueness` and `yaml_quoting` act at output;
- a new vmd build has a new implementation id.

File versions are hashed from the bytes the backend returns (I1 §2.6), which takes 7 ms for vampiredb's 3.1 MB (M). §14.3's "`git
ls-files -s` and git's stat cache supply file versions without hashing" contradicts I1's reason for hashing (clean filters) and is
listed in section 14. A stat cache of vmd's own (size, modification time, inode, with git's rule for racy timestamps) comes only
if a store's measurements ask for it.

### 6.4 An incremental check

1. List the store once: paths, versions, classes (section 2.2), path rules (section 2.3).
2. For each record in scope, read its parse entry, or parse it and write one.
3. For each, read its binding entry, or bind it, parsing first if step 2 did not, and write one.
4. Resolve every reference of the records in scope against the structures of their targets, restored from entries, a target parsed
   only on a miss. The plan's "re-resolving only the references into them" is simplified to re-resolving every reference:
   resolution over parsed structures costs 15 ms for vampiredb's 2,006 references (M), less than reading a cached result would,
   and it needs no record of what each result depended on.
5. Apply the severities; sort by path, then position.
6. When the scope is the whole store, write the snapshot.

The invariant, which a property test checks (section 10): a check that uses the cache reports exactly the issues of a check that
does not.

### 6.5 `ls`, `outline` and `grep`

- **`ls`** (K10). With the index, the count of unreadable records covers the whole store: one listing of every path, a lookup of
  each record's version, a parse only on a miss. `StorePage.unreadable.scope` gains `store`. Without a cache, `ls` keeps counting
  the page only, and says so.
- **`outline`** prints refs-in counts when the snapshot is current for every record, and otherwise leaves them out with a line
  saying that `vmd index` gives them, rather than resolving the whole store and losing I1's budget for a cold outline. A node's
  count is the references whose target is the node or lies below it, so a record's count is the sum (reading R17).
- **`grep`** gains nothing useful from the index: its estimate depends on the pattern, which no entry can know. What helps is
  cheaper: estimate the rest at the rate of matches per byte read, from the sizes `list` already returns, rather than per file,
  which a few large files skew (I2.5 makes that change).

---

## 7. Commands (I2.6)

### 7.1 `vmd check [PATHS..] [--changed REV] [-n N | --all]`

- **Scope.** Without arguments, every record. `PATHS` are store paths or globs; only those records' issues are reported, while
  their references still resolve into the whole store, as the suite's `records` input does. `--changed REV` takes the records that
  differ from `REV` in the working copy (`git diff --name-only -z REV` and the untracked files of `git ls-files --others
  --exclude-standard -z`, mapped below the store root), and the records whose references point into them, from the snapshot or,
  without one, from every record's cached references (§16.3's incremental pattern). A store without history fails with
  `storage-failed`, as `read(…, {at})` does (#16; reading R19). `--fix` is I5's.
- **Output.** Issues on stdout, since they are the result (O3), each in §12.3's format, sorted by path and position; at most 20 by
  default (`-n N`, `--all`), then the counts per code that `formatIssues` already writes; and a last line: `37 records (35 from
  the index), 2,006 references: 40 errors, 17 warnings`. Configuration issues and the Unicode warning go to stderr (O3). `--quiet`
  keeps the warnings (O2). `--json` writes `{"ok": true, "value": {records, from_index, references, unreadable}, "issues": […]}`
  with every issue (O4).
- **Exit codes.** 4 with any issue of severity `error`, 0 otherwise (§12.3, M4); 1 for `config-invalid`, `alias-file-invalid` and
  any other failure of the operation; 2 for usage.

```
$ vmd --store ~/vampiredb/docs --config examples/vampiredb/config.yaml check
design/Concurrency_Primitives.md:857:41 error ref-dangling: Minimal_Log.md#no-stall matches no node
  in   #ring-ordering/$body  (exact #/$sections/7/$sections/2/$body)
  hint the anchor element at Minimal_Log.md:1301 starts a list item's second paragraph, so it anchors nothing (§6.2)
...
57 issues, 37 not shown: 40 ref-dangling, 17 anchor-element-ignored
37 records (0 from the index), 2,006 references: 40 errors, 17 warnings
```

(The positions and the section path are illustrative.) The hint is worth its code: a `ref-dangling` whose name is an `<a id>` that
raised `anchor-element-ignored` in the target says so, since that is the cause in all 40 of vampiredb's cases (M).

### 7.2 `vmd refs ADDR [--to | --from] [--context N] [-n N] [--cursor C]`

- `--to`, the default: the references whose target is the node `ADDR` names or a node below it; for a record, every reference into
  it. `--from`: the references made in the node and below.
- One line per reference, grouped by citing record as `query` groups its matches (§12.2): the citing node's canonical address,
  `line:col`, the status, the raw target, and with `--from` the resolved address. `--context N` adds N lines of the citing file
  around it. The references' issues follow their lines on stdout, since they are part of the listing (O3).
- The default limit is 50, as for `grep`, with a cursor (§12.2). Exit 4 when a listed reference has an error, as any successful
  outcome with one (M4).
- Backlinks need every record's references, so `refs` uses the index: cold, it extracts the whole store once (about 1 s for
  vampiredb's docs, section 9).

```
$ vmd refs design/Minimal_Log.md#room
design/Minimal_Log.md#room  3 references
design/Paged_Log.md
  #holds/$body:120:14          ok  Minimal_Log.md#room
  #holds/release/$body:301:2   ok  Minimal_Log.md#room
design/Minimal_Log.md
  #tail-and-flusher/$body:4410:9  ok  #room
```

(The anchor, lines and counts are illustrative.)

### 7.3 `vmd schema [COLLECTION]`

Without a name, one line per collection: its name, globs, schema file and record count. With one, one screen from the spine: each
field with its type, logical type, `enum` (and its `x-vmd-ordered`), whether it is required, a reference's targets and
cardinality, `x-vmd-summary`; the keyed lists with their keys and required items; and the required sections. Cut at 40 lines
unless `--all`. `--json` gives the same as data.

### 7.4 `vmd index [--publish DIR]`

`vmd index` brings the cache up to date for the whole store, writes the snapshot, removes other builds' directories, and prints
`37 records (2 parsed, 35 from the index), 2,006 references; .vmd/cache 1.4 MB` (illustrative). `--publish DIR` is the portable
index, which §21 puts in I7 and §19.2 in the Publish profile; until then it is `usage-invalid` with that message (reading R18).
The local entries are already in its row format, so I7 concatenates them and adds the manifest.

### 7.5 Streams and exit codes

| Command | stdout | stderr | Exit |
|---|---|---|---|
| `check` | issues, counts, the summary | configuration issues, the Unicode warning | 4 with an error issue, else 0; 1 on failure; 2 usage |
| `refs` | the references and their issues | the same | 4 when a listed reference has an error, else 0 |
| `schema` | the summary | issues (`schema-invalid` included, exit 1) | 0, 1 |
| `index` | the counts | issues | 0; 4 when a file could not be read (M4) |

Under `--json` every outcome is one object on stdout (O4).

### 7.6 The Validate profile in the runner

The suite has 108 cases that need `validate` (M, a count over `conformance/cases/`): 94 `check`, 10 `resolve`, 3 `refs`, 1 `meta`.
The runner gains:

- **`check`**: opens the case's store over core's memory backend with the case's `config` and calls `Store.check({records})`; the
  issues, mapped to the four compared members, are compared unordered (conformance README, "Expected issues"). There is no result.
- **`refs`**: `Store.references({from: record})`, or every reference of the store; each mapped to `{from, raw, status, targets}`,
  with `from.offset` for a link, compared unordered, `targets` unordered too.
- **`resolve` and `meta`** through `openStore`, so that the cases with schemas resolve through their keyed lists.

The declaration claims `validate` with the first pull request that implements `check` (section 13), with `id` skip entries for the
case files later pull requests enable, each removed by the pull request that makes them pass, as in I1 (I1 §6).

| Pull request | Cases it enables |
|---|---|
| A, configuration and `check` | `anchors/duplicates` (20), `anchors/explicit` (4), `anchors/blocks-and-tags` (3), `anchors/derived/08-html`, `30-…`, `31-…` (4), `markdown/title` (6), `markdown/headings` (2), `paths/extensions` (1), `addresses/cardinality/strict-duplicate-check` (1): 41 |
| Y, YAML warnings | `values/yaml-scalars` (11) |
| C, schemas | `values/logical-types` (32), `validation/bom-config` (1) |
| D, keyed lists | the rest of `addresses/cardinality` (13) |
| E1, references | `references/targets`: the `refs` cases (3), `reference-into-unreadable-record`, `unreadable-record-without-fragment-no-warning` (5) |
| E2, typed references | `references/targets`: `many-reference-to-missing-record`, `no-targets-allows-any-target`, `targets-restrict` (3); `addresses/explicit-refs` (2) |

The suite has no case yet for most codes I2 raises: `config-invalid` per member, `schema-invalid`, `feature-unsupported` in a
schema, `path-invalid`, `path-case-conflict`, `filename-mismatch`, `@key` lists with `required`, `items` and `additional`,
`ref-ambiguous`, `ref-aliased`, `alias-shadowed`, `alias-file-invalid`, `ref-derived-anchor`, `ref-derived-repeat`, offsets of
links in titles and in JSON prose. Each pull request adds the cases for the codes it raises, so that other implementations are
held to them, as Draft v0.7's suite did for I1. `ref-retargeted` needs a previous index, which a case cannot give, and stays a
unit test.

---

## 8. vampiredb (I2.7, I2.8)

### 8.1 What the docs hold

Measured on the store `~/vampiredb/docs` on 2026-10-11 (M: [`vampiredb-links.mjs`](../research/i2-design/vampiredb-links.mjs)):

- 37 Markdown records, 3.1 MB, none unreadable; the parse raises 17 warnings, all `anchor-element-ignored` (card T).
- 2,006 references: 1,994 links and 12 link reference definitions, which 12 reference links use; none in a heading; no image, no
  asset and no directory target; 41 autolinks.
- Their targets: 1,198 resolve through an explicit anchor and 661 through a block anchor; 53 name a record without a fragment; 53
  are absolute URIs and 1 climbs above the store root (`guidelines/Decision_Log.md:234`, `../../.github/workflows/checkers.yml`),
  so 54 leave the store; and 40 match no node. None goes through a derived anchor.
- `scripts/docs.sh` on the same checkout: "30 documents, all conforming; 438 anchors and 2168 references to them checked", no
  problem (M: [`results/vampiredb-docs-sh.txt`](../research/i2-design/results/vampiredb-docs-sh.txt)).

The 40 are the links into the 17 `<a id>` elements of `design/Minimal_Log.md` that start a list item's second or later paragraph,
which §6.2 does not make block anchors (#20). `docs.sh` reads every `<a id="…"></a>` outside code as an anchor, so it accepts
them.

### 8.2 The trial configuration (I2.7)

`examples/vampiredb/config.yaml` grows from `vmd: 1` to a configuration with one collection, and a schema beside it in
`examples/vampiredb/schema/`:

```yaml
vmd: 1
collections:
  documents:                                   # the anchored documents docs.sh checks: design/, draft/, guidelines/
    match: ["design/**/*.md", "draft/*.md", "guidelines/*.md"]
    exclude: ["**/README.md"]
    schema: anchored-document.schema.yaml
```

```yaml
# anchored-document.schema.yaml: what docs.sh checks of a document's form, as far as a schema of the value view can say it
$defs:
  section:
    type: object
    if: { properties: { $title: { pattern: "^([0-9]+(\\.[0-9]+)*|A\\.[0-9]+)\\.? |^Appendix [A-Z]" } } }
    then: { required: [$anchor] }              # a numbered heading carries an anchor
    properties:
      $sections: { type: array, items: { $ref: "#/$defs/section" }, x-vmd-list: { type: map, keys: ["@key"] } }
type: object
required: [$title, $body]
properties:
  $body:                                       # the header table opens the document, until R1 moves it to front matter
    allOf:
      - pattern: "\\| \\*\\*Type\\*\\* \\| `?(Design|Investigation|Analysis|Report|Convention|Guideline|Record)\\b"
      - pattern: "\\| \\*\\*Status\\*\\* \\| `?(Draft|Accepted|Implemented|Deprecated)\\b"
  $sections: { type: array, items: { $ref: "#/$defs/section" }, x-vmd-list: { type: map, keys: ["@key"] } }
```

The header table is prose in the root's `$body`, so the two patterns check it as text, which is a stop-gap: R1 (§22) moves the
header to front matter, where a schema checks it as fields. `docs.sh`'s rule that `Implemented` is only for a Design, and its
component slugs from `docs/components.md`, are left out: the first is an `if`/`then` on prose, the second would copy a list the
schema cannot read. The document collection matches `docs.sh`'s `documents()` (`find docs/design docs/draft docs/guidelines -name
'*.md' ! -name README.md`), whose count is 30 (M). `docs.sh` asks for heading anchors only in documents that have at least one
anchor, while the schema asks every document of the collection; if one of the 30 has numbered headings and no anchor (U), I2.7
narrows `match` rather than the rule.

### 8.3 The comparison with `docs.sh` (I2.8)

| Check | `docs.sh` | `vmd check` |
|---|---|---|
| a link with `#ID` to a document with anchors, ID missing | yes | `ref-dangling` |
| a link with `#ID` to the 17 ignored anchors | accepted | `ref-dangling` (40), until card T is answered |
| a link to a missing file | only when it has a `#` | `ref-dangling` for every relative link |
| a link to a document without anchors | skipped ("its links are plain Markdown") | resolved: headings, derived anchors |
| reference links and definitions | not read (its pattern is `[text](target)`) | read |
| links and code-comment references from outside `docs/` (the repository's `README.md`, `.rs` files) | read: among its 2,168 references | outside the store, not seen |
| links from `docs/` to outside it | not checked | outside the store (54), not checked (§8.2) |
| a duplicate anchor id | yes | `duplicate-anchor` |
| a numbered heading without an anchor | yes | `schema-violation` (section 8.2) |
| header fields: Type, Status | yes | `schema-violation`, as patterns on prose |
| header fields: Implemented only for Design, Component slugs | yes | no |
| the shown number or label of a link (`[§4.6](…)`) | yes, and `--fix-refs` | no: label templates are deferred (§8.4, §20's open question 3) |
| ticket citations | yes | no: not vmd's |
| file names | letters, digits, `_`, `-`, `.` | `path-invalid` (§3.2), which is narrower for the first character |

`examples/vampiredb/check-demo.mjs`, in the style of I1.11's `demo.mjs`, runs both on the checkout and matches `docs.sh`'s link
problems inside `docs/` with vmd's issues by file, line and target, so that "every broken link `docs.sh` reports inside `docs/`,
`vmd` reports too" is a check rather than a claim. Since `docs.sh` reports nothing today, the demonstration plants faults in a
copy of the docs, each once: an anchor id renamed, an anchored heading deleted, a link to a missing file with and without `#`, a
duplicate anchor, a numbered heading without its anchor, a reference link to a missing anchor, and a wrong shown number. It
records which tool reports each, against the table above, then times `vmd check` cold and warm, the median of ten, on the
unmodified store, and checks that the store is unchanged (a digest before and after), as I1.11 did.

### 8.4 Card T

Card T asks the owner whether the 17 anchor elements move in vampiredb's documents or §6.2 widens to accept them. I2 proceeds
either way: the code does not depend on the answer, only the demonstration's numbers do. Until it is answered, `vmd check` on
vampiredb exits with 4 for the 40 links, and I2.8's record explains them. If §6.2 widens, the block anchor of a list item's later
paragraph is that paragraph, which I1's ranges already define for a top-level one, and the 40 resolve; if the documents change, it
is 17 edits in vampiredb by its owner, and the 40 links resolve with them. G6 forbids lowering `ref-dangling`, and K3 forbids
editing vampiredb from here, so the trial configuration cannot hide them.

---

## 9. Performance budget

The plan's exit: a warm `vmd check` over vampiredb's docs in under two seconds. Measured in one process (M):

| Step | Time |
|---|---|
| parse every record, first time in the process | 932 to 948 ms (three runs of the probe) |
| parse every record again | 863 to 882 ms |
| a git blob id for every file | 6 to 7 ms |
| `stat` of every file | 0.2 ms |
| resolve every reference, the records parsed | 14 to 15 ms; 8 to 9 ms with the resolvers' maps built |
| the validator: import, and compile one schema of 200 properties, in a fresh process | 26 ms, 12 ms |
| validate one record against it | 25 to 36 µs |
| a second, separate Markdown parse for links (not proposed) | 849 to 878 ms |

So a **cold check without a cache** costs about 60 ms of Node and imports (I1 §7), 40 ms for the validator, 950 ms of parsing, a
few milliseconds of validation and 15 ms of resolution: about 1.1 s (U until I2.8 measures it), within the budget already. A
**warm check** re-parses nothing: the listing and hashing (10 ms), reading 37 parse entries and 37 bindings (U: the rows of
Minimal_Log are a few hundred kilobytes), resolution (15 ms) and output. A few hundred milliseconds, including Node's start, is
the expectation (U).

What keeps it so:

- one parse per file version, ever, while the cache lives; the links come from that parse (section 5.1);
- no values in the cache, and no node versions computed (section 6.1);
- resolution re-run over cached structures rather than results cached with their dependencies (section 6.4);
- schemas compiled once per collection, only by commands that need them.

**A guard in CI** counts work rather than time, as #77's tests do: over a generated store of 50 records with links between them, a
second `check` parses no record, and after one record changes it parses exactly that one and binds it, and reports the same issues
as a check without a cache. A time bound would fail on loaded machines first (#76), while a count catches the regression that
matters, a cache that stops hitting.

The risk outside vmd is micromark's quadratic regression on some inputs (#13): a record of a few tens of kilobytes can take
seconds to parse until its fix is released. A cache hides it after the first check, and does not remove it.

---

## 10. Testing

As in I1 (I1 §8): Vitest unit tests per module, property tests with fast-check, the suite's cases, and the owner's rules.

**Property tests**, each with an oracle of its own where one exists:

1. **Keyed lists against §9.3's compilation.** Random member-keyed lists and declarations (`map` and `multimap`, `required`,
   per-key `items`, `additional`): core's native evaluation and the validator run over the standard compilation of §9.3 agree on
   validity, with core's `duplicate-key` standing for the compilation's `maxContains` failure. The oracle is the specification's
   own definition, run by a validator core does not write.
2. **Dates and times.** Strings built from random components (year, month, day, hour, minute, second, fraction, offset), valid
   exactly when the components are: the day against `Date.UTC`'s calendar for that month, a leap second against 23:59 UTC after
   the offset computed with integer arithmetic. Mutations (a separator, a digit count, a case) are checked against the ABNF.
   Durations from a generator of RFC 3339 Appendix A's grammar and from near misses (§4.3's examples). `int64`, `bigint` and
   `decimal` against `BigInt` and the XML Schema expression.
3. **URI resolution.** For random citing paths and relative references that stay in the store, `resolveReferenceUri` gives the
   store path that WHATWG's `new URL(ref, "https://store.invalid/" + citing)` gives, percent-decoded; for those that climb above
   the root, vmd says outside and `URL` clamps, which is the departure section 5.2 states.
4. **Link extraction.** Markdown generated with links at known positions (inline, definitions, in headings, tables, lists, block
   quotes, beside code spans and comments that hold link-like text, with CRLF and BOM variants): every planted reference is found
   with its `raw`, `offset` and `destination`, and no other; `destination` slices the file to `raw`.
5. **The cache changes nothing.** Over a generated store and a random sequence of edits, renames, schema changes and `issues`
   changes, a check with the cache reports exactly what a check without it reports, and parses only what changed.
6. **The proof agrees with evaluation.** For generated schemas and records without duplicates, in strict mode, an address the
   proof accepts never evaluates to several nodes; and an address that crosses a `multimap` level the record repeats keys at is
   always refused. This is a consistency check of two parts of core, so a wrong spine walk that both use would pass; the suite's
   `addresses/cardinality` cases are the independent part.

**Independence of oracles.** The suite's cases, written from the specification; the validator over §9.3's compilation; `Date.UTC`;
WHATWG `URL`; `BigInt`; and for vampiredb, `docs.sh` and a line scan of the files, as I1.11 did. A property that compares core
with itself says so, as property 6 does.

**Failing first.** Each pull request first removes its cases' skip entries and shows them failing, then implements, and its
description gives both counts (I1 §8). Each guard fires once and lets its near miss through: a `config-invalid` per member and per
limit of section 2.5, each `schema-invalid` of sections 3.2 and 3.3, each status of section 5.3, each step kind under `anchors:
explicit`. Stryker's survivors over `config/`, `schema/`, `binding/`, `reference/` and `check/` are listed in each pull request,
and a survivor in a guard gets a test.

**Predicted bugs, each with a failing test before the fix**, in the pull request that meets it:

- a `__proto__` member in a record and in a schema's `properties`, and `required: [toString]` (the defects measured in Ajv);
- a member named `a/b` or `a~b` in an issue's `at`, through the validator's percent-encoded locations;
- `../` past the root, which RFC 3986 clamps; `%E9` and other paths that do not decode as UTF-8;
- a `$ref` beside other keywords in a YAML schema, which the record-shape code `ref-malformed` would refuse;
- `23:59:60+02:00` invalid and `01:59:60+02:00` valid; `P1Y3D`; `"-0"`; `9223372036854775808` as a string;
- `unevaluatedItems` beside `x-vmd-list`; an `x-vmd-list` under `oneOf`;
- a stale binding after a schema edit; two processes writing one entry; an entry of another build;
- the `$title` offset of a link after an anchor element, and in a setext title of two lines.

---

## 11. Readings of the specification

Where the specification is silent or ambiguous and the design chooses, each for the owner to confirm or correct. None changes
behavior the specification states.

| | Reading | Where |
|---|---|---|
| R1 | collection names match `[A-Za-z][A-Za-z0-9_-]*` | §9.1; question 9 |
| R2 | Windows reserved names are compared without regard to ASCII case; case conflicts compare per-code-point lower case (§6.3 step 3) | §3.2 |
| R3 | `@collection` is absent for a record in no collection, as `@key` is for the root | §5.10 |
| R4 | a configuration's schemas are in `schema/` beside the configuration file, which §9.1's `.vmd/schema/` is an instance of | §9.1, §12.1 |
| R5 | a schema file is at most 1 MiB, the configuration's bound | §9.1 |
| R6 | schema files are read with vmd's JSON and YAML rules (no YAML anchors); `$schema` is 2020-12's or absent; `$id` is not supported yet | §9.2 |
| R7 | `@key` lists are keyed by `["@key"]` alone; `unevaluatedItems` beside `x-vmd-list` is `schema-invalid` | §9.3 |
| R8 | `x-vmd-ref` on a string schema requires `format: uri-reference` | §8.1, §9.3 |
| R9 | one `schema-violation` per failing value, branch errors of `anyOf`, `oneOf` and `not` folded into their applicator's | §9.2, Appendix D |
| R10 | the proof of §7.4 looks the first step's anchors up in the record, then works from the schema alone | §7.4 |
| R11 | a typed string that is not a valid `uri-reference` is a `schema-violation` and no reference | §8.1 |
| R12 | a query in a reference is ignored for resolution | §8.2 |
| R13 | a reference to an ignored file is checked like one to an asset, for existence | §3.3, §8.2 |
| R14 | an ambiguous reference lists its candidates as `targets`; a malformed fragment is `ref-dangling` | §8.5, conformance README `refs` |
| R15 | an invalid alias file stops `check`, an operation error | §13.6, Appendix D |
| R16 | a reference is identified across runs by citing path, node, form, raw text and rank, for `ref-retargeted` | §13.5 |
| R17 | a node's refs-in count includes the references into nodes below it | §12.1, §12.2 |
| R18 | `vmd index --publish` is refused until I7 | §12.1, §21 |
| R19 | `check --changed` on a store without history fails with `storage-failed` | §12.1, §11.2 |
| R20 | a configuration member the specification does not define is `config-invalid`; §9.1 lists the detectable forms of an addition for data and schemas, not for the configuration | §9.1 |

---

## 12. Open questions

Each with its options and a recommendation. Those marked *spec* change the specification if answered as recommended, and go into a
Draft v0.11 with their decision-log entries before the pull requests that need them.

1. **The validator.** (a) `@hyperjump/json-schema` 1.18.0; (b) Ajv 8.20.0, as the plan and Appendix C say, with the `__proto__`
   and `required` defects documented as known deviations; (c) json-schema-library 11.6.5, with its unescaped locations worked
   around. *Recommended: (a)*, for section 3.1's reasons; Appendix C and the plan's §1.2 change (*spec*, Appendix C).
2. **Where `x-vmd-list` and `x-vmd-ref` may stand.** (a) only on the spine of section 3.3, `schema-invalid` elsewhere; (b)
   anywhere, with annotation semantics, which (a) of question 1 can give, and a proof of §7.4 that then cannot be static for those
   levels; (c) anywhere, applied wherever the keyword is met, failing branches included, which is what a custom keyword in Ajv
   does. *Recommended: (a)*: a reference's meaning never depends on which branch of a `oneOf` its record satisfies, the proof
   stays before evaluation, and a Python implementation over `jsonschema` can do the same. (b) can come later as a minor addition,
   since today's schemas would stay valid (*spec*, §9.3).
3. **A reference through a level declared `multimap`**, which §7.4 says cannot be singular, but §8.5 gives no status for. (a)
   status `ambiguous`, issue `ref-ambiguous` saying it cannot be proved singular; (b) a new code `ref-not-singular`, status
   `ambiguous`; (c) evaluate it, and accept it when one node matches. *Recommended: (a)*: the reference may match several nodes by
   declaration, and it keeps one code per status. (c) contradicts §7.4 (*spec*, §8.5, Appendix D).
4. **Where the cache goes for a store read with `--config`**, whose root has no `.vmd/`, as vampiredb's `docs/`. (a) a per-user
   cache directory keyed by the store root's real path (`$XDG_CACHE_HOME/vmd/` or `~/Library/Caches/vmd/`), and `.vmd/cache/` for
   a store with its own `.vmd/`; (b) no persistent cache unless a new `--cache DIR` says where; (c) `.vmd/cache/` in the store
   anyway. (c) modifies the store, against K3. *Recommended: (a)*, with a global `--no-cache` for measurements and debugging
   (*spec*, §12.1, §14.3).
5. **A record that two collections match.** (a) a new validation error, `collection-conflict`, at the record, which is then read
   unschematized; (b) `config-invalid`, failing every command once such a file exists; (c) the first collection by name. (b) lets
   one new file break the store, and (c) depends on names. *Recommended: (a)* (*spec*, §9.1, Appendix D).
6. **`issues` entries for codes whose severity depends on context**, and for structural and operation codes. *Recommended*: the
   rule of section 2.5: an entry applies to a code's warnings only and never lowers an error; structural and operation codes take
   no entry; always-error validation codes accept only `error`. The alternative, an entry that sets every occurrence, would lower
   errors that G6 keeps (*spec*, Appendix D's "Configuring severities").
7. **Images.** §8.1 names inline links and link reference definitions. (a) an image is a reference too, so a missing image is
   `ref-dangling`; (b) images are not references. vampiredb's docs have none (M); tickets with screenshots will. *Recommended:
   (a)*, since a broken image is the broken link a reader sees first (*spec*, §8.1).
8. **Keyed-list keys.** *Recommended*: one key member per list (several are `schema-invalid` in this version, a later minor
   version may allow them); a key is a string; an item without one, or with a key that is not a string, is a `schema-violation` at
   the item in a declared list, and is reached only by its `$anchor` or its exact path, since no step indexes a keyed list (§7.3).
   §9.3's "a semantic path step matches a single key member" does not say which member of a composite key a step matches, and no
   case needs one (*spec*, §5.6, §9.3).
9. **`targets` entries.** §9.3's example mixes `tickets`, a collection, and `docs/**`, a glob. *Recommended*: an entry naming a
   collection of the configuration is that collection, and any other entry is a glob; with R1, a collection name never looks like
   a glob with `/` or `*`. The alternative, a prefix such as `collection:tickets`, is explicit but changes Appendix A's schema
   (*spec*, §9.3).
10. **The strict read mode now, and a global `--strict`.** (a) core's mode in I2.3 and `--strict` for `get`, `outline`, `ls` and
    `refs` in I2.6; (b) as the plan says, in I3.4 with `query`. *Recommended: (a)*: its inputs all exist in I2, and an agent
    reading a store that does not validate can use it before queries exist (*spec*, §12.1; the plan's I3.4).
11. **A collection whose schema is invalid.** (a) `schema-invalid` is reported; `check` goes on with the other collections, and
    with that collection's records checked for everything but their schema; a read that needs the binding of one of its records,
    such as `get` of an address, fails with it, since its addresses depend on the schema; (b) every command that opens the store
    fails. *Recommended: (a)*, so that one broken schema does not hide every other result (*spec*, §9.1: what "is an error" does).
12. **Card T**, pending (section 8.4). The design does not depend on it; I2.8's numbers do.

---

## 13. Task order

Each row is one pull request (plan §1.3). Letters continue I1's scheme.

| PR | Task | After | Done when |
|---|---|---|---|
| A | I2.1 configuration (#21), with `check` in core and the runner's `check` | (none) | the 41 cases of section 7.6 pass; a `config-invalid` test per member and limit, each with its near miss; path rules and `filename-mismatch` with cases added to the suite; `ls`'s collection column; `--config` with its `schema/`; Stryker's survivors listed |
| Y | YAML ambiguity warnings (#21) | A | `values/yaml-scalars` passes; `yaml_quoting` and an `issues` entry over them |
| C | I2.2 schemas (#22) | A | `values/logical-types` and `validation/bom-config` pass; property test 2; each `schema-invalid` and `feature-unsupported` fires once; the predicted bugs of section 10 for schemas |
| E1 | I2.4 references: extraction, resolution, statuses, aliases, warnings, `refs` in the runner, `@refs` (#24) | A | the five `references/targets` cases of section 7.6 pass; property tests 3 and 4; a suite case per status and warning |
| D | I2.3 keyed lists, uniqueness, the proof, canonical addresses, strict read (#23) | C | the rest of `addresses/cardinality` passes; property tests 1 and 6; #15's first deviation removed |
| E2 | I2.4 typed references and `x-vmd-ref` (#24) | D, E1 | the other `references/targets` cases and `addresses/explicit-refs` pass: all 108 Validate cases pass |
| F | I2.5 local index (#25) | E2 | property test 5; the CI guard of section 9; `ls`'s store-wide count and `outline`'s refs-in counts |
| G | I2.6 commands `check`, `refs`, `schema`, `index` (#26) | F | command tests over a fixture store for each option, stream and exit code of section 7.5; `--changed` in a temporary git repository |
| H | I2.7 vampiredb trial (#27) | C (draft), G (final) | `examples/vampiredb/` holds the configuration and schema of section 8.2; `vmd check` runs over the store with them |
| K | I2.8 demonstration (#28) | G, H | `check-demo.mjs` and its record in #28: the comparison of section 8.3, the planted faults, cold and warm timings, the store unchanged |

A starts at once. After A, C, E1 and Y run in parallel, and D follows C. **The critical path is A, C, D, E2, F, G, K**: the
binding needs schemas, typed references need the binding, the index caches what the binding gives, and the commands read the
index. H's schema can be written as soon as C lands, and only its run waits for G.

Before D, E1, E2 and G, the owner's answers to questions 2 to 11 go into Draft v0.11 (*spec* items) with their decision-log
entries, as Draft v0.7 did for card K. Question 1 is needed before C, question 4 before F.

The phase's exit, as the plan states it: the I0 fixtures for §8 and §9 pass (the 108 cases, and those the pull requests add), and
a warm `vmd check` over vampiredb's docs takes under two seconds.

---

## 14. Documents to update

With the owner's answers, in the same pull request as the answers they follow from (`AGENTS.md`, "Documents are a set"):

- **The implementation plan**: §1.2 (the validator, if question 1 is answered (a), and no `ajv-formats`); I2.2 (keyed lists
  evaluated natively, with the compilation as a test oracle); I2.5 (every reference re-resolved, section 6.4); I2.6 (`index`
  added, as §12.1 lists it); I3.4 (the strict read mode, if question 10 moves it).
- **The proposal**: Appendix C (the validator row, if question 1); §21's I2 row, whose "over vampiredb's docs and tickets"
  predates the move of the tickets to eternal-circle (the plan, 2026-10-10), so it says docs only, as the plan's I2.8 does;
  §14.3's sentence on `git ls-files -s`, which contradicts I1 §2.6's hashing of the bytes the backend returns (section 6.3); and
  the *spec* items of section 12, with Appendix D's new codes if any.
- **The conformance README**: the `refs` operation's `targets` for an ambiguous reference (R14), once confirmed.
- **This design**: section 12's answers, as the I1 design records card K in its section 9.

A validation pass over those documents closes that pull request, naming each and what changed.
