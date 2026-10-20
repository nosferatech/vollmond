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
- **Schemas** are validated with `@hyperjump/json-schema` rather than Ajv, if the owner agrees (question 1), by a narrow margin.
  Configured with `ownProperties: true`, Ajv's one wrong verdict in the probes is that it skips a `properties` entry named
  `__proto__` (M; D: its source); on Bowtie's 2020-12 run it also gives wrong verdicts on `$dynamicRef` (15 tests) and
  `unevaluated*` (6 tests) (D). Hyperjump gives none there (D) or in the probes (M), and generates no code, at the cost of
  experimental APIs and process-wide state (section 3.1). The logical types of §4.3 are vmd's own checks: `ajv-formats` departs
  from §4.3 on separators and offsets (D: §4.3), and hyperjump's formats refuse its leap seconds (M).
- **`x-vmd-list` and `x-vmd-ref` are read along a static spine** of the schema (properties, items, `$ref`, `allOf`), so that the
  proof of §7.4 needs no evaluation, and are an error under `oneOf` and the other conditional keywords (question 2). Keyed lists
  are evaluated natively, and the standard compilation of §9.3 becomes the oracle of a property test.
- **A record's binding** (keyed lists, declared section levels, typed references, schema issues) is computed once per file version
  and schema set. Address resolution, canonical addresses and `@key` take it, and the static proof raises `address-not-singular`,
  closing #15's first deviation.
- **References** are collected during the Markdown parse that already runs, with each destination's source range kept for I5's
  rewrites (M: the tree is unchanged). A second parse for links would cost as much as the first: 878 ms over vampiredb's docs (M).
- **The local index** is content-addressed JSONL in a per-user cache directory, never in the store: one entry per file version in
  the portable index's row format, shared by every store and worktree, plus a snapshot of the last full check per store. Nothing
  in a checkout is read as cache, so entries committed into a repository are never trusted (section 6.2, question 4). A warm check
  re-parses nothing unchanged and re-resolves every reference, which costs 15 to 19 ms for vampiredb's 1,965 (M).
- **vampiredb**: `vmd check` will report the 40 links into 12 of the 17 anchor elements that §6.2 does not make block anchors,
  which `docs.sh` accepts (#20, open item 1, pending). Everything else resolves (M). A cold check without the index is estimated
  at about 1.1 to 1.4 s, within the plan's budget of 2 s for a warm one.

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
| `cache/` | the filesystem `IndexCache` in the per-user cache directory: entries written by rename, snapshots, eviction (section 6.2) |
| `backend/git-changes.ts` | the paths changed since a revision, for `check --changed` |
| `command/check.ts`, `refs.ts`, `schema.ts`, `index.ts` | the four commands of section 7 |
| `command/ls.ts`, `outline.ts`, `get.ts` | the collection column, the store-wide unreadable count, refs-in counts, `@refs` and `@collection` (the TODOs of #18) |

### 1.3 `js/packages/conformance`

`operations/check.ts` and `operations/refs.ts` are new. `resolve` and `meta` open the case's store through `openStore` with the
case's configuration, so that schemas apply; today they call `resolveStoreAddress` over a raw lookup. The declaration claims
`["read", "validate"]` once the first Validate pull request lands (section 13).

### 1.4 Dependencies

`core` gains `@hyperjump/json-schema` 1.18.0, its peer `@hyperjump/browser` 1.6.0, and `@hyperjump/json-schema-formats` 1.0.8 as a
direct dependency for four identifier formats (section 3.4), if question 1 is answered as recommended. All are pure JavaScript.
Their licences are to be confirmed at adoption, as for I1's (npm gives MIT for `@hyperjump/json-schema`; D: registry metadata).

- **Node APIs.** `@hyperjump/browser` imports `node:fs`, `node:process` and `node:url` in two modules, and its `package.json` maps
  both to browser variants through the `browser` field (M: read from the 1.5.1 package, and again from 1.6.0). Bundlers for
  the browser use those. Whether its type declarations reference Node's types, which core's `no-node-types` guard forbids, is U:
  the guard says so on adoption.
- **No network, no disk.** The guarantee is core's own: before anything is compiled, every `$ref` of every schema file must name a
  file of the schema directory or a location inside one (section 3.2, step 3), so the validator is never asked to retrieve
  anything. As a second line of defense, the CLI, and later vmd's own Lambda functions, remove the `http`, `https` and `file` URI
  schemes at start (`removeUriSchemePlugin`, D: the package's README); a `$ref` to an unregistered file then fails with a
  `RetrievalError` and reads nothing (M). Core itself does not remove them, since the plugins are global to the process: removing
  them would break any other user of `@hyperjump/browser` in a host process that embeds core, such as a server that also validates
  documents with remote references.
- No other runtime dependency. `ajv` and `ajv-formats`, which the plan names (§1.2), are not used.

---

## 2. Configuration (I2.1)

### 2.1 Reading

The configuration file is read as I1.8 reads it (#17): UTF-8 with a byte order mark skipped (J5), at most 1 MiB, one YAML document
read with vmd's YAML rules, the record-shape codes dropped, every problem a `config-invalid` at its position with `path: null` and
the file named in the issue's details. I2.1 reads every member. What a member the specification does not define gives is question
21: §9.1 lists the forms a minor version may add, and a configuration member is not among them.

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
- **Collection names** are any string in §9.1. The design proposes `[A-Za-z][A-Za-z0-9_-]*`, so that a name never contains `/`,
  `*` or `:` (questions 9 and 10).
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

- `path-invalid`, once per path, its message naming every rule the path breaks: a segment outside `[A-Za-z0-9][A-Za-z0-9._-]*`, a
  segment over 255 bytes, a path over 1,024 bytes, a path that is not NFC, a Windows reserved name (compared without regard to
  ASCII case, as Windows does: reading R1), a segment ending in `.`. One issue per path, not per rule, is intended: a path that is
  not NFC always holds a character outside the segment rule's ASCII set too, and two issues would count one problem twice (reading
  R13, Appendix D's counting rule read with the path as the occurrence).
- `path-case-conflict` for each path after the first, in UTF-8 byte order, among paths equal under the per-code-point lower-case
  mapping of §6.3 step 3, whose tables core has (reading R1).
- Severity: an error for a record, a warning for an asset, since an asset is never in a collection (`match` globs name records).
  `at` is `""` for a record and null for an asset (Appendix D).
- `filename-mismatch` for a record of a collection with `filename` whose last segment does not match it.

### 2.4 What I2 adds to `ls`, `get` and `outline`

`ls` gains the collection column (#18's TODO), and `@collection` is the record's collection's name, absent for a record in none
(reading R2). `@refs` is section 5.7's. Refs-in counts and the store-wide count of unreadable records come from the index (section
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

Appendix D's limits, as `readStoreConfiguration` checks them: an entry for a structural or an operation code is `config-invalid`,
since those cannot be configured; for a validation code whose occurrences are always errors (such as `schema-violation` or
`ref-dangling`) only `error` is accepted, since a validation error stays an error; an unknown code is `config-invalid`. Appendix D
decides all of that. What it leaves open is question 6: for a code whose severity depends on its context (`duplicate-key`,
`duplicate-anchor`, `path-invalid`, `path-case-conflict`, `not-representable`), the design accepts any of the three values and
applies the entry to the code's warnings only.

Because severities resolve at output, the index never holds them, and editing `issues` invalidates nothing (section 6.3).

### 2.6 `--config`, and where a configuration's files are

A configuration names its schemas relative to its own directory: in `schema/` beside the file. For `.vmd/config.yaml` that is
`.vmd/schema/`, as §9.1 says; for `--config examples/vampiredb/config.yaml` it is `examples/vampiredb/schema/`; for the suite's
`config` input, a file in `.vmd/`, it is `.vmd/schema/` again, which every case already assumes. `--config` replaces the whole
configuration; nothing is merged. This generalizes §9.1's comment `# in .vmd/schema/`, which changes where a configuration given
with `--config` finds its schemas, so it is question 13: a store read unmodified, such as vampiredb's `docs/`, cannot hold them.

The store's own data stays in the store whatever configuration reads it: `.vmd/aliases.jsonl` (§13.6) belongs to the store. The
cache does not: it lives in a per-user directory for every store (section 6.2, question 4), so reading vampiredb's `docs/` writes
nothing into the checkout, as K3 requires.

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
configuration and a schema. The configuration is at most 1 MiB, the bound I1.8 set, recorded as a deviation in #17; the design
proposes the same bound for each schema file (question 20). The alias file is at most 16 MiB (decision Z3, Draft v0.13 §11.2),
read with that bound; a larger one is `alias-file-invalid`, whose message names the limit and suggests `vmd alias prune`. This
design first read it whole and set no bound, as the specification had none. Records have none either, beyond the nesting bound
of I1.

---

## 3. Schemas (I2.2)

### 3.1 Choosing a validator

The plan names Ajv with `ajv-formats` (§1.2, Appendix C). The options, checked on 2026-10-11. The probes ran the versions in the
column heads; Bowtie's run, whose row gives its version, ran some others.

| | Ajv 8.20.0, with `ownProperties: true` | json-schema-library 11.6.5 | @hyperjump/json-schema 1.18.0 |
|---|---|---|---|
| releases (D: npm) | 8.20.0 on 2026-04-24; 8.18.0 on 2026-02-14; 8.17.1 on 2024-07-12 | 11.6.5 on 2026-10-09 | 1.18.0 on 2026-10-05 |
| Bowtie, 2020-12, 1,301 tests, run of 2026-10-11 (D) | 8.20.0: 27 wrong, 227 errored | 11.6.2: none wrong or errored | 1.17.7: none wrong, 4 skipped |
| a `properties` entry named `__proto__` | skipped, for every instance: `{"__proto__": 5}` passes `properties: {__proto__: {type: string}}` (M; D: `allSchemaProperties` in `dist/vocabularies/code.js` filters the name out) | checked (M) | checked (M) |
| members named like `Object.prototype`'s (`toString`, `constructor`) in `properties`, `required`, `dependentRequired` | correct with `ownProperties: true`; wrong without it, on objects from `JSON.parse` (M) | correct (M) | correct (M) |
| where an error is | `instancePath`, an RFC 6901 pointer (M) | `#/a/b` for a member named `a/b`: `/` and `~` not escaped, so ambiguous (M) | `instanceLocation`, a URI fragment, percent-encoded (M) |
| a failing `oneOf` | the branches' errors and the `oneOf`'s (M) | one error (M) | the `oneOf`'s and the branches' (M) |
| `format` on numbers, as int64 needs | only by replacing the `format` keyword (M) | a format function sees any value (M) | a format handler sees any value (M) |
| `x-vmd-*` keywords | strict mode refuses unknown keywords, so each is declared (M) | ignored (M) | collected as annotations (D, M) |
| annotations, with failing branches dropped | no: a custom keyword runs in a failing `oneOf` branch (M) | no | yes (M) |
| code generation | `new Function` (D: `dist/compile/index.js`), so a page needs `unsafe-eval` under a CSP | none found (M: a search of `dist`) | none found (M) |
| API | synchronous | synchronous | compiling is asynchronous; a compiled validator is synchronous (D: README); a global registry |
| cold cost: import, compile a 200-property schema (M) | 10 ms, 26 ms | 4 ms, 2 ms | 26 ms, 12 ms |
| 1,000 validations of a 200-member record (M) | 6 ms | 41 ms | 25 ms (FLAG), 36 ms (BASIC) |
| state | per instance: each `Ajv` object has its own schemas | per compiled schema | process-wide: the schema registry, the format setting, the URI scheme plugins (D: README) |
| unpacked package, runtime dependencies (D: npm's `unpackedSize`) | 1.0 MB, 4 | 3.1 MB, source maps and browser bundles included, 6, one of them `valid-url` 1.0.9 of 2013 | 453 KB and 28 KB for its peer, 7 with the peer |

Bowtie's numbers come from its published report for 2020-12 (`bowtie.report/draft2020-12.json`), summarized by
[`bowtie-summary.mjs`](../research/i2-design/bowtie-summary.mjs). Bowtie's harness configuration is not known here (U), and Ajv's
errored tests look like strict mode's refusals rather than verdicts: 133 are in the `format` cases, whose unknown formats strict
mode refuses. Its 27 wrong verdicts are 15 on `$dynamicRef` and `$dynamicAnchor`, 6 on `unevaluatedItems` and
`unevaluatedProperties` (among them "unevaluatedItems with nested items", "unevaluatedItems depends on adjacent contains",
"unevaluatedProperties with if/then/else, then not defined"), 5 on names `Object.prototype` has, which `ownProperties: true`
corrects in the probes, and 1 on a custom meta-schema (D: the report, by theme). Run here with strict mode off and `ownProperties:
true` over the report's 73 `unevaluated*` cases that need no other document, Ajv gives 13 wrong verdicts of 199 tests and
hyperjump none (M: [`unevaluated-cases.mjs`](../research/i2-design/unevaluated-cases.mjs)); with strict mode off, tests that
Bowtie's run counted as errored are run, which is why the count is higher than Bowtie's 6. The first version of this design said
that Ajv's prototype-name defects could not all be worked around; that was wrong. With `ownProperties: true` the only probed
defect left is the `__proto__` entry of `properties` (M: [`ajv-own-properties.mjs`](../research/i2-design/ajv-own-properties.mjs),
2 wrong verdicts of 84, both that one).

Two other validators were looked at. `@cfworker/json-schema` 4.1.1 reports every declared property of a null-prototype object as
an additional one (M), so it is out. `ata-validator` had no wrong verdict and no error on Bowtie's run, as 1.46.0 (D), and its
package is pure JavaScript with optional per-platform native accelerators (D: its README). It is not proposed now: its first
release was on 2026-03-21, it has published 159 versions in all, the first included, six of them in the five days before this
design, and 1.51.0 on the day of writing (D: npm). A dependency of core is read by every implementation's maintainers for years,
and that rate of change is a risk the probes cannot measure. It was not probed (U), and is the first candidate if hyperjump
disappoints in I2.2.

**Recommendation: `@hyperjump/json-schema`** (question 1), by a narrower margin than the first version of this design gave. What
decides it is the 21 wrong verdicts on `unevaluated*` and `$dynamicRef`, in keywords a schema author uses without knowing which
validator runs, which vmd cannot correct around Ajv. The `__proto__` skip can be: core could check a `properties` entry named
`__proto__` itself, and refuse `$dynamicRef` as `schema-invalid`. Ajv's strengths are real: it is the fastest by a factor of four
to six, synchronous, keeps its state per instance, and its locations are exact. Its code generation matters less than the first
version said: I7's pages run VQL, not validation, and a Lambda function allows it. Hyperjump's costs:

- the format and output APIs are exported as `experimental` (D: README), so the version is pinned exactly and raised deliberately;
- its process-wide state (section 3.1.1), which Ajv does not have;
- it brings no messages, so vmd writes its own from the failing keyword and its value, and more output folding (section 3.5);
- 7 dependencies, `node:` imports behind a `browser` field (section 1.4).

If the owner weighs process-wide state above the `unevaluated*` verdicts, Ajv 8.20.0 with `ownProperties: true`, a native check of
`properties.__proto__`, `$dynamicRef` refused, and the `unevaluated*` cases listed as known deviations, is the alternative, and
sections 3.2 to 3.5 hold for it with Ajv's error shape.

#### 3.1.1 Hyperjump's process-wide state

- **The registry.** `registerSchema` throws when a URI is registered twice: "A schema has already been registered for … You can
  use 'unregisterSchema' to remove the old schema before registering the new one" (M:
  [`hyperjump-output.mjs`](../research/i2-design/hyperjump-output.mjs); D: `lib/schema.js`, line 45, in 1.18.0). The conformance
  runner opens the same store's configuration for many cases, a warm Lambda function opens stores again and again, and property
  test 5 edits schemas in one process; each would hit it. So core registers each schema file under
  `https://vmd.invalid/<digest>/schema/<file>`, where the digest is SHA-256 over the configuration and every schema file the
  collection reads (`.invalid` never resolves, D: RFC 2606 section 2), and keeps a process-wide memo from digest to compiled
  validators: a digest seen before reuses them, and a URI is never registered with other bytes, since other bytes give another
  digest. The memo holds at most 64 schema sets; registering a 65th unregisters the least recently used set's URIs
  (`unregisterSchema`, M: registering again then succeeds). The CLI never reaches the bound.
- **The format setting** (`setShouldValidateFormat(true)`) and the format handlers are global too. Core sets them once, and a host
  process that embeds core and uses hyperjump itself sees format assertion turned on for vmd's formats.
- **The URI schemes**: section 1.4. Core leaves them alone; the CLI removes them.

This state tilts question 1 towards Ajv, and the design keeps hyperjump all the same, for the reason above.

### 3.2 Loading a collection's schema

1. **Read** the collection's `schema` file from the schema directory: `.json` with vmd's JSON reader, `.yaml` and `.yml` with its
   YAML reader, a byte order mark skipped, the record-shape codes dropped as for the configuration. A `$ref` beside other keywords
   is valid in 2020-12, where `$ref` is an applicator whose siblings are evaluated too (D: JSON Schema 2020-12 Core, section
   8.2.3.1), so `ref-malformed` must not fire there; `$defs` and `$schema` are ordinary members. Any issue is `schema-invalid` at
   its position. vmd's YAML rules refuse anchors, aliases and tags, which are valid YAML and which some schema authors use to
   share definitions: question 15.
2. **`$schema`** is absent or `https://json-schema.org/draft/2020-12/schema`; anything else is `schema-invalid`, since §9.2 names
   2020-12. **`$id`** is valid 2020-12, and the design proposes to refuse it in I2 (question 14): its base URI would change what
   references between files by name mean. No schema of the suite or of Appendix A has one.
3. **Every `$ref`** is checked as text before anything is compiled: resolved against its file's URI, it must name a file of the
   schema directory, or a location inside one, which is then read, transitively. A `$ref` that leaves the directory, or has a
   scheme or an authority of its own, is `schema-invalid`. This check is what guarantees that nothing is fetched and no file
   outside the directory is read, whatever the validator would do; section 1.4's removal of URI schemes only backs it up.
4. **Check the `x-vmd-*` keywords** (section 3.3), then **compile** with the validator, which checks the schema against the
   2020-12 meta-schema (D: README, `setShouldValidateSchema`). Its `InvalidSchemaError` becomes `schema-invalid` at the positions
   of the output's locations in the schema file.

Schemas compile once per collection per store, when a command first needs one, so `ls`, `cat` and `grep` never load them. A
collection whose schema is invalid: question 12.

### 3.3 The extension keywords and the spine

vmd checks the keywords of §9.3 before the validator sees the schema:

- **`x-vmd-list`**: `type` is `map` or `multimap`; `keys` a non-empty list, each `@key`, a JSON Pointer or a member name; `@key`
  only on a `$sections` array (§9.3), and, as the design proposes, a `$sections` array keyed by `["@key"]` only (question 17) and
  a single key member (question 8); `required` a list of strings; `items` a mapping from key values to schemas; `additional` a
  boolean or a schema.
- **`x-vmd-ref`**: `targets` a list of strings, `cardinality` `one` or `many`, `anchors` `any` or `explicit`; on a schema for a
  `$ref` object, or for a string, which the design proposes must then have `format: uri-reference` (question 18).
- **`x-vmd-summary`**: a boolean, as the design proposes (question 19). **`x-vmd-ordered`**: `asc` or `desc`, beside an `enum`.
- A malformed keyword is `schema-invalid`. An unknown `x-vmd-*` keyword is `feature-unsupported`, of class operation in a schema
  (Appendix D), and so is an unknown member or value inside `x-vmd-list` or `x-vmd-ref`, such as `sorted: true` or `type: set`
  (decision AA2, Draft v0.14 §9.3); a member whose value has the wrong form stays `schema-invalid`.

**The spine.** `x-vmd-list` changes what an address means and `x-vmd-ref` what a value is, so vmd must know, for each node of a
record, which of them apply. The spine is the part of a schema reached from its root through keywords whose subschema for an
instance location does not depend on the instance's validity: `properties`, `patternProperties`, `additionalProperties`,
`prefixItems`, `items`, `$ref` (to a fixed location), `allOf`, and `x-vmd-list`'s own `items` and `additional`. It does not go
through `anyOf`, `oneOf`, `not`, `if`, `then`, `else`, `dependentSchemas`, `contains`, `propertyNames`, `unevaluated*` or
`$dynamicRef`. A `$dynamicRef` is allowed, and every `$dynamicAnchor` of its name counts as a target reached off the spine
(decision AA3, Draft v0.14 §9.2 and §9.3).

**Declarations off the spine.** An `x-vmd-list` or `x-vmd-ref` that the collection's schema reaches through an applicator off the
spine, such as a branch of `oneOf`, is `schema-invalid` (question 2), also where the spine reaches it too (decision AA4, item 6,
Draft v0.14 §9.3), so that what an address means never depends on which branch the data happens to satisfy, and the proof of §7.4
can work from the schema alone. A declaration the collection's schema does not reach at all is no error: a shared
`common.schema.yaml` whose `$defs` each collection uses only in part is valid, and what is unreached is never checked against the
spine. Reached means through any keyword, so the walk that finds the off-spine declarations follows every applicator and every
`$ref`, with a set of visited locations against cycles.

**Several declarations at one instance location** must be equal. Where the schema alone shows two unequal ones, it is
`schema-invalid`; where only a member name in the data brings them together, that member of that record has a `schema-violation`.
They meet in four ways:

- `allOf`, and `$ref` beside other keywords (D: 2020-12 Core, section 8.2.3.1): both are static, so the check runs when the schema
  is loaded, except for two `additionalProperties` of an `allOf`, which meet only at a member the data names and so wait for the
  record (decision AA4, item 4, Draft v0.14 §9.3);
- a member named in `properties` whose name a `patternProperties` pattern also matches: static too, since the name is in the
  schema; patterns are ECMA-262 expressions, run with the `u` flag (D: 2020-12 Core, section 10.3.2.2, which names ECMA-262);
- two patterns that both match one member name: only a name in the data can tell, so the check runs when a record is bound
  (but a name that a `properties` anywhere in the schema lists is checked when the schema is loaded, conservatively; decision
  AA4, item 4, Draft v0.14 §9.3), and
  raises a `schema-violation` at that member of that record, naming both patterns and their declarations, as any value the schema
  cannot accept would. The member then gets neither declaration: an array there is not a keyed list, a string there is no typed
  reference. The record stays readable, and the collection's other records are unaffected, so the result depends neither on which
  record is checked first nor on the cache. The existing code fits, since §9.2's schema violation is a value the schema rejects,
  and §9.5's strict read refuses the record (question 2 names it). The proof, which knows the step's text, sees the same two
  declarations at that member and decides as section 4.4 does: if either is `multimap`, the address is not singular; otherwise the
  member's array is not keyed, and a key step through it matches nothing, as it does in the binding. The proof is deliberately
  stricter than the binding there: it refuses an address such as `#m/0` through that member when either declaration is `multimap`,
  although the binding treats the array as a plain one, because the proof judges declarations, and the data's conflict does not
  remove the `multimap` one from the schema;
- an array item, which gets the array's `items` (or a `prefixItems` entry) together with `x-vmd-list`'s per-key schema or its
  `additional`, never one in place of the other (2020-12 applies every applicator); section 4.4 reads both. A per-key schema meets
  the `items` or `prefixItems` entry when the schema is loaded; `additional` meets them only at an item whose key the list's
  `items` does not name, which the data decides, so that waits for the record (decision AA4, item 4, Draft v0.14 §9.3, kept on
  card AF, Draft v0.15).

`x-vmd-summary` and `x-vmd-ordered` are left to I3, whose queries read them. A schema with `unevaluatedItems` beside `x-vmd-list`
would fail valid data, since the validator does not see the items `x-vmd-list` checks as evaluated; the design proposes to make it
`schema-invalid` (question 16).

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
a wrapper whose `$ref` points into `x-vmd-list`'s `items`, which hyperjump resolves, although they sit inside a keyword it does
not know (M: [`hyperjump-subschema.mjs`](../research/i2-design/hyperjump-subschema.mjs)). 2020-12 leaves such a reference to each
implementation, since a value inside an unknown keyword need not be a schema (D: Core, the section "References to Possible
Non-Schemas"), and only hyperjump was probed, so with another validator core would compile each per-key schema as a document of
its own, with the file's `$defs` beside it (U: not needed unless question 1 changes).

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
| `local-date-time` | `full-date`, `T`, `t` or a space, `partial-time` with any fraction; `60` seconds in any minute, as the grammar allows (card AV) | strings |
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
- **One issue per value**, by folding rules over the output's keyword locations, so that no issue lands on a value that is valid
  (reading R3). The suite expects one issue per failing value (`values/logical-types`), and an agent fixes a value, not a keyword.
  What hyperjump's BASIC output gives for each, measured (M:
  [`hyperjump-output.mjs`](../research/i2-design/hyperjump-output.mjs)), and the rule:

  | Keyword | BASIC output | Rule |
  |---|---|---|
  | `anyOf`, `oneOf` | the applicator's error at the value, and every branch's errors | keep the applicator's; drop every error whose keyword location is inside it |
  | `not` | the applicator's error alone | keep it |
  | `if`, `then`, `else` | the failing `then` or `else` keyword's errors, nothing for `if` | keep them: they are the value's own failures |
  | `contains` with no match | the `contains` error at the array, and a `const` error at every item, each of which is valid as an item | keep the array's; drop every error whose keyword location is inside `contains` |
  | `maxContains`, `minContains` | the `contains` error at the array, and errors at the items that do not match, which are valid | the same; the message counts the matches against the bound, from the schema's `minContains` or `maxContains` |
  | `propertyNames` | an error at `#*/NAME`, hyperjump's notation for a member's name, which is not a JSON Pointer | `at` is the member `NAME`, its value's exact path; the message says that the name, not the value, fails |
  | `dependentSchemas`, `unevaluated*` | not probed (U); expected at the value or the members concerned | keep them; an unevaluated member goes to the member, as `additionalProperties` does |

  The errors that remain at one location are merged into one issue whose message lists them. A location the folding cannot place,
  in a notation the table does not list, is a bug in core, caught by a test that fails on any location that is not a JSON Pointer
  or `#*/` followed by one segment.
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
Each target gets its route, how each step matched the node on the way to it, also when a selector's step matches several nodes,
since a step's matches are children of the previous step's, each of one of them. The project owner's answer on card AM (section
5.4) needs a route per target. Naming an exact path's tokens `section-member`, `index` or `member` is this design's, for G10's
refusal of positions in an exact path.

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
  it does read the record; §7.4's "before evaluating anything" is read this way (reading R4), since where an anchor's node sits in
  the schema cannot be known from the schema alone.
- Each later step crosses the level of the locations the previous step can reach, which the spine gives without data, and every
  location counts, so a declaration anywhere among them decides: a section's fields and child sections, whose level is its
  `$sections` declaration; a keyed list's items, by the step as the key, where an item's locations are the array's `items` and
  every `prefixItems` entry (the step does not say which position) together with `x-vmd-list.items[step]` if the list declares
  that key, or `additional` if it is a schema; an object's members, where a member's locations are its `properties` entry, every
  `patternProperties` entry whose pattern matches the step, and `additionalProperties` when neither does; an array's items.

  The first version of this rule took the per-key schema in place of the array's `items`, and so missed a `multimap` declared
  under `items`: `{type: array, x-vmd-list: {type: map, keys: [name]}, items: {properties: {runs: {type: array, x-vmd-list: {type:
  multimap, keys: [id]}}}}}` makes `#benchmarks/append-4k/runs/r1` not singular, and a rule that read only
  `x-vmd-list.items[append-4k]` would have accepted it. A unit test holds this case.
- A step from a section that begins with `$` names the section's own member (`$title`, `$body`, `$sections`, `$anchor`,
  `$tags`, and `$schema` at the root), and crosses no level: it is singular wherever the section itself is, so `#summary/$body`
  is singular even where every root section's child sections are declared `multimap` (card AD). No section key of a valid
  record can begin with `$`: a heading's slug drops it, and an anchor must start with a letter. An invalid explicit anchor such
  as `$x` still becomes its section's key, with `anchor-invalid`; there a `$` step that the proof accepts can be ambiguous at
  evaluation, as other data that breaks a rule the proof relies on is (§7.4). `$sections` is the section's own member too, but a
  step into it is a key of the section's child sections, and crosses their level. A `$` step into a data list is a key like any
  other, since a key member may hold any string. The proof still works from the schema alone, but for the first step.
- A location the schema does not constrain has no declarations below it, so nothing there is rejected. Lenient mode and duplicate
  data are not rejected either: they are §7.4's cases that fail at evaluation.
- Where the schema alone cannot prove the address, whichever step fails, the record decides its first step (card AO): the proof
  looks the step up as evaluation matches it, in the anchor table, the root's member of that name and the root's `$sections` keyed
  list (`indexesOf`), a node that several of them name counting once. If the step names exactly one node there, an explicit anchor
  that no top-level key repeats or a unique top-level key, the proof proves the steps after it from that node's shape alone. If it
  names several, the address fails as `address-not-singular` at the step the schema found, and the message says how many nodes the
  first step names in the record and lists their exact paths. If it names none, the address is proved (card AP): it names no node,
  whatever follows the first step, and is not ambiguous, so evaluation finds it `address-not-found` and a reference written with
  it is `dangling`, which the anchor aliases of section 5.5 then resolve. `#tpyo` and `#tpyo/later` are not found, and `#done`
  after `done` was renamed `finished`, with the alias `done` to `finished`, is `aliased` to `#finished`. The address an alias
  gives, `#finished/$body` for `#done/$body`, is proved again as any address is. A first step that begins with `$` already reaches
  one place in the schema, the root's own member, so the record is not asked. This makes no address harder to prove than before,
  and declaring a level `multimap` never makes one easier. So in a journal whose top-level sections may repeat, `#done` and
  `#done/$body` are singular where `done` is the explicit anchor of one node and no other top-level section has the key `done`.
  `#monday` over two `## Monday` sections is not singular, and neither is `#done` where a top-level `## Done` and another node's
  explicit anchor `done` are both there (§7.3's ambiguity, which the record shows). A derived anchor counts as any anchor does:
  `#monday-1` names the second Monday alone, and so does a block anchor that names one block. The case is not only a `multimap`
  root's. In `{"$title": "R", "notes": {"a": 1}}`, where the root's sections are a map but their own child sections are declared
  `multimap`, the schema cannot tell the field `notes` from a root section `notes`. So `#notes/a` is proved only because the
  record has the field and no such section. Canonical addresses follow (section 4.5): such a node's explicit anchor, or a repeated
  section's unique derived anchor, becomes its canonical address in place of its exact path. The suite's `addresses/cardinality`
  cases `repeating-root-*` and `map-root-*` hold these examples, and its `references/aliases` cases `*-repeating-root` the aliased
  and dangling links.

So `journal/week-41.md#log/entry-1` fails as `address-not-singular` although no Entry has the key `entry-1`, and
`#log/nothing-here` fails the same way: where the record has the one `log` section, the declaration of its level decides (the
suite's `multimap-suffix-not-singular`). Where it has no `log` section, the address names nothing and is not found. The cost is a
few map lookups per step.

### 4.5 Canonical addresses and `@key`

Form 2 of §7.5 writes a keyed-list item by its key: `/benchmarks/1/p99_us` is `#benchmarks/read-4k/p99_us` (the suite's
`keyed-list-exact`). A form is singular only if `proveSingular` accepts it and evaluation finds that node alone, so through a
`multimap` level form 2 fails and form 3, the derived anchor, wins: the two Entries of `journal/week-41.md` are `#entry` and
`#entry-1` (`multimap-meta`). `@key` of a keyed-list item is its key (§5.10); an item without one keeps its index. A block anchor
whose name is not singular keeps core's fallback to its `$body`'s address, which #20's second open item leaves to the owner.

### 4.6 The strict read mode

§9.5's strict read mode (G7) was deferred to I3 because its codes come from schemas (I1 §5). With the binding of section 4.1,
every input it needs exists in I2: a strict store refuses a record with a structural error or with `schema-violation`, a
declared `duplicate-key` or `filename-mismatch`, and a refused record is an error, not a result. It does not refuse a record for
`ref-target-not-allowed`: the project owner's answer on card AS leaves that to the implementation, and vmd's choice, which Draft
v0.17 §9.5 states for the owner to confirm, is to return the record while `check` reports the reference, so a strict read
resolves no typed references.
`openStore(…, {readMode: "strict"})` gives it in core; `ls` counts refused records with the unreadable ones. Whether the CLI gets
a global `--strict` now, which §12.1 does not list, is question 11.

The refusal is the readers', not the store's shared read path (the project owner's answer on card AJ): a strict `get`, `outline`
or `resolve` fails on a refused record, but `Store.binding`, which the reference resolver and `check` read, binds the record in
either mode. So a reference into a refused record has the status a best-effort store gives it, and `check` reports the same issues
in both modes, as §9.5's validator reports every issue whatever the mode. §8.5's `unreadable` stays the status of a reference into
a record every reader refuses. A refused read fails with the record's refusing issues only, not its other errors, as a read of a
record with a structural error fails with its structural errors (the implementing agent's reading in #146, confirmed by the
project owner on card W7).

`references()` over every record (`refs` without `from`) reads as a query does (the project owner's answer on card AK): in the
strict mode it returns the references of the records it can read, reports each refused record as an error of the outcome, and
fails as a whole over a collection whose schema cannot be used. A best-effort store leaves both out silently, as before. The
implementing agent's readings in #146, confirmed by the project owner on card W7: a refused record is reported by every issue it is
refused for, not by one error per record; a record with a structural error, and one the backend cannot read (`storage-failed`),
are reported as well; and the failure gives the issue of each collection whose schema cannot be used, once each.

The mode refuses the codes above, and no others: typed references (I2.4's second pull request, section 13) add
`ref-target-not-allowed`, which `check` reports and the mode does not refuse (card AS).

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

A separate mdast parse for links would cost as much as the record's own parse: 849 to 878 ms over vampiredb's docs against 932 to
948 ms in the same runs (M).

**Prose in JSON and YAML** (C21). Each `$body` string of a section is parsed as a Markdown document of its own, with the link
reference definitions of every `$body` of the record in scope, the first in the order of the record's Markdown form winning where
two define one label (decision AB, Draft v0.14 §5.4), and each `$title` as the content of an ATX heading (K8), with offsets into
the string itself. These parses run when references are asked for and not otherwise: in `check`, `refs` and the index for every
record, and in `get` only when `@refs` is requested, then for the strings of the requested node and the sections below it. A plain
`get` parses no prose. (The first version said "never for `get`", which contradicted `@refs` on `get`, section 5.7.) A Markdown
record's links need no extra parse, since they come from its own.

**`$ref` objects** (§8.1) are found by I1's shape walk wherever they stand in a field's value, schema or not: `form:
"ref-object"`, `at` the object. **Typed strings** come from the binding: a string whose spine location has `x-vmd-ref` and that is
a valid `uri-reference`; an invalid one is the `schema-violation` and no reference (reading R5). A `$ref` object carries the
declaration of its own schema, or else of its `$ref` member's: the object is the one reference, and an `x-vmd-ref` on its `$ref`
member applies to it (the project owner's answer on card AN). Where the object's schema and its `$ref` member's both declare
`x-vmd-ref`, and the two differ, they are refused (the project owner's answer on card AR; question 22).

### 5.2 Resolving a target

`resolveReferenceUri(citingPath, uri)` follows RFC 3986, with the store as the base:

1. A scheme or an authority: outside the store, and not a reference vmd tracks (§8.2). It raises nothing and is not listed.
2. The path is merged with the citing record's path (section 5.2 of RFC 3986), or taken from the store root when it starts with
   `/` (§8.2's store-root form). Dot segments are removed by vmd's own walk, which reports a path that climbs above the root as
   outside the store: RFC 3986's `remove_dot_segments` drops the excess `..` silently, so that `../../../g` against
   `http://a/b/c/d;p?q` is `http://a/g` (D: section 5.4.2).
3. The path is percent-decoded as UTF-8 into a store path; one that does not decode is `ref-dangling` with that message. An empty
   path is the citing record; a path ending in `/` names a directory.
4. A query is ignored, so `x.md?plain=1#a` resolves as `x.md#a` (reading R6). GitHub's file views are said to use `?plain=1` to
   show a Markdown file's source (U: not checked against GitHub's documentation); the rule does not depend on it. The fragment is
   kept as written, and read as §7.1 reads an address, percent-decoding included.

What the store path is comes from the store's file list, read once per operation: a record, readable or not; an asset (an ignored
file counts as one, reading R7); a directory, which exists when a listed path is below it; or nothing.

### 5.3 Status and targets

| Target | Status (§8.5) | `targets` | Issue |
|---|---|---|---|
| nothing at the path | `dangling` | none | `ref-dangling` |
| an asset or a directory | `ok` | `{path}` (a fragment is ignored) | none |
| a record, no fragment or `#` alone | `ok`, also when the record is unreadable (J3) | the root, `{path, at: "", address: ""}` | none |
| an unreadable record, with a fragment | `unreadable` | none | `ref-target-unreadable` (warning) |
| a record, singular, not provably singular | `ambiguous` (question 3) | none | `ref-ambiguous`, with the reason |
| a record, singular, no match | `dangling`, unless an alias resolves it (section 5.5) | none | `ref-dangling` |
| a record, singular, several matches | `ambiguous` | the matches (reading R8) | `ref-ambiguous`, with the candidates |
| a record, `cardinality: many` | `ok`, also with no match (G5), unless an alias resolves it (section 5.5) | every match | none |
| through an alias, to a match | `aliased` | the alias's target | `ref-aliased` (warning) |
| `cardinality: many`, through an alias, to no match | `ok` (reading R19; card AU) | none | none |

The proof applies to every reference of cardinality one, whatever its form: a Markdown link through a level declared `multimap` is
`ambiguous` exactly as a typed string is (question 3). E1 resolves links before D exists; no level can be declared then, so the
proof would refuse nothing, and E2 adds it for every form at once (section 13).

A malformed fragment, which `resolve` would refuse with `address-malformed`, is `ref-dangling` with that message, since a
reference's issue is about the reference (reading R8). Every issue is at the reference: `path` the citing record's, `at` the node
of section 5.1, with `offset` for a link (Appendix D's note on prose).

### 5.4 `x-vmd-ref`

- **`targets`**: the target's store path must match one entry. An entry that names a collection of the configuration matches that
  collection's records; any other entry is a glob over store paths (question 9). An asset or directory target is checked by its
  path. Without `targets`, anything is allowed (J6).
- **`cardinality: many`** resolves the fragment as a selector: no proof, every match, an empty result valid in a record that
  exists (G5), and `ref-dangling` for a record that does not (decision I1.8).
- **`anchors: explicit`** (G4, G10) refuses a reference any of whose steps matched only by `key-title`, `anchor-derived` or
  `index` (section 4.2): no title-derived name, no position in a semantic or an exact path. A step that matched one node by an
  allowed way too, such as `#done` naming a heading by its explicit anchor and its derived one, is allowed. With `cardinality:
  many`, the reference is refused as soon as one target's route has such a step, and the refusal names those targets (the
  project owner's answer on card AM).
- A breach is `ref-target-not-allowed` at the reference; the status stays what resolution gave, since the target exists.
  `targets` is checked wherever something is at the path, `ambiguous` and `unreadable` references included, and not for a
  `dangling` one, which names nothing (reading R14); `anchors: explicit` where resolution reached targets.

### 5.5 Aliases

`.vmd/aliases.jsonl` is read once per operation that resolves references (C22). Each line is a JSON object with `kind` `record`
(`from`, `to`) or `anchor` (`record`, `from`, `to`), and `at`, a date-time; anything else, a malformed path or anchor name
included, is `alias-file-invalid`, an operation error, and `check` stops with it, since without the aliases some references would
be reported as dangling that are not (reading R9). A reference that resolves through no live node is tried through the aliases:

1. a record alias whose `from` is the path, followed through chains with a guard against cycles, to the first path that exists;
2. then, in the record found, an anchor alias whose `from` is the fragment's first step, the remaining steps unchanged, followed
   through chains in the same way, to the first name a first step reaches, a cycle ending as `dangling`; the anchor aliases
   recorded under the record's old paths, the paths whose record aliases lead to it, count as its own (decision Z2, Draft v0.13
   §13.6). This design first followed an anchor alias one step only, and looked only under the record's final path. A first
   step that reaches something in the record is live and is not followed through its aliases, so `#a/x` is `dangling` when `a`
   is live and `a/x` matches nothing, beside the `alias-shadowed` warning of `a` (the project owner's answer on card AG).

A live node always wins (§13.6), so an alias is consulted only when the live resolution is `dangling`, or, for a reference
declared `cardinality: many`, when it matches nothing: its first step, when it reaches no name of the record, follows the
record's anchor aliases, as it would for a single reference (the project owner's answer on card AL, which follows §13.6's "a
reference that resolves to no live node"). It is `aliased` when the alias leads to a match, and `ok` with no targets when it
leads to none, as a single reference stays `dangling` then (reading R19). The same holds where a record alias leads it to a
record in which its fragment matches nothing: it is `ok` with no targets, as for an old section name (the project owner's
answer on card AU), and its `targets` are checked against the record the alias leads to. `alias-shadowed` warns for
each live record path that equals a record alias's `from`, and for each node that a first step named by an anchor alias's `from`
reaches, the same names that stop a chain: an anchor, a key of the root, as a JSON or YAML record's top-level key or a Markdown
record's front matter key, or a child section of the root by its key (the project owner's answer on card AC). Writing the file is
I5's.

### 5.6 The reference warnings

- **`ref-derived-anchor`**: the first step matched only by `anchor-derived` or `key-title`, both title-derived (G4), and the slug
  is not repeated in the record. **`ref-derived-repeat`** in its place when another heading of the record has the same slug, so
  that `#notes` and `#notes-1` both warn while two `## Notes` exist (§6.3). That needs each heading's slug beside its derived
  anchor, which the anchor table keeps from I2.4 on. vampiredb's docs have no reference through a derived anchor (M). A reference
  declared `cardinality: many` warns as soon as its first step reached one target only that way (the project owner's answer on
  card AM).
- **`ref-retargeted`**: a reference whose resolved exact path differs from the one in the previous index (§13.5), which is the
  snapshot of section 6.2. A reference is identified across runs by its citing path, node, form, `raw`, and its rank among the
  references with the same four in that node (reading R10); offsets are not used, since an edit above it moves them.
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

### 6.2 Where the cache lives, its layout and writing

The cache is never in the store. It lives in the per-user cache directory, `$XDG_CACHE_HOME/vmd/` or `~/.cache/vmd/` on Linux and
`~/Library/Caches/vmd/` on macOS, for every store, whether it has a `.vmd/` of its own or is read with `--config` (question 4):

```
<per-user cache>/vmd/v1-<implementation id>/
  entries/parse/<2 hex>/<blob id>.<format>.jsonl
  entries/bind/<2 hex>/<blob id>.<format>.<collection>.<schema digest>.jsonl
  stores/<store id>/snapshot.json, snapshot-refs.jsonl
  last-eviction                       a timestamp, so that eviction runs at most once a day
```

- **Entries are shared** by every store and worktree of the user: they are content-addressed, and their rows carry no path, so two
  worktrees of one repository, or two stores holding one file, read one entry.
- **One snapshot per store**, under a store id that is a SHA-256 of the store root's real path (symbolic links resolved). The
  snapshot records the digest of the configuration it was made with, and a snapshot made with another configuration is treated as
  absent.
- **The implementation id** is a hash of core's sources, which the build writes into `dist/` (a small script beside
  `generate-unicode.mjs`), so that an unreleased build that changes the parser never reads another build's entries.
- **Eviction.** The cache is bounded to 512 MB by default. When a write finds the last eviction more than a day old, entries not
  read for 30 days are removed, then the least recently read ones until the cache is under its bound; a snapshot whose store root
  no longer exists is removed too, and so are the directories of other implementation ids. Reading an entry sets its modification
  time, so that "read" can be told from the file system. `vmd index` runs the same eviction at once.
- **Writes** go to a temporary file renamed into place. An entry's bytes are a function of its key, so two processes that write
  one entry at once write the same bytes; a snapshot is written whole, and the last writer wins with a consistent file.
- **Who writes**: `check`, `index`, `refs`, `ls` and `outline` read the cache and write what they parse. `get`, `cat` and `grep`
  neither read nor write it, so a plain read stays free of side effects. `--no-cache` turns it off for any command (question 4).
- **The cache interface** is core's, so that the Lambda functions of I6 and I7 can keep it elsewhere:

```ts
export interface IndexCache {
  read(key: string): Promise<Uint8Array | null>;      // an entry's JSONL, or null
  write(key: string, rows: Uint8Array): Promise<void>; // a failed write is ignored: the cache is optional
}
```

A cache that cannot be written raises no issue, since Appendix D has no code for it and nothing is wrong with the store;
`vmd index` says how many entries it could not write. This layout is the per-user cache directory of §14.3 (question 4).

#### 6.2.1 What the cache trusts, and why that is safe

An entry is a claim about a file's bytes, which `check` believes without parsing them, and a file's blob id and a released vmd's
implementation id are both public. A cache inside the checkout could therefore be forged by whoever can write to the checkout: a
pull request could add `.vmd/cache/…` with `git add -f` past a `.gitignore`, saying that a broken record is valid, and a gate's
`vmd check` (§9.4, pattern B of §16.3) would pass it. With the cache in the per-user directory, vmd never reads the checkout as
cache, so a committed `.vmd/cache/` is an ordinary ignored directory: harmless, and never read. What the cache trusts is then
exactly what the user's home directory holds, written by the user's own vmd.

**A cache directory set elsewhere** (card AT, answered by the project owner on 2026-10-20 with its option (c)). An
`XDG_CACHE_HOME` can put the cache anywhere, a CI workspace included, so the rule depends on where the directory comes from:

- **Set with `XDG_CACHE_HOME`:** not used when it lies at or below the store root, or at or below any git working tree that
  encloses the store. That is every directory from the store root up to `/` with a `.git` entry, so a submodule's working tree,
  a nested clone's and the repository that holds them all count.
- **The default** (`~/.cache/vmd/`, `~/Library/Caches/vmd/`): always used, unless it lies at or below the store root, since
  the design trusts the user's home, which is never a CI workspace. So a home kept in git for its dotfiles keeps its default
  cache, and one whose `XDG_CACHE_HOME` is set inside that checkout gets none.

No git process is run: a `.git` entry, a directory or a file, marks a working tree. The working trees looked at are those
around the store root, so with `--config` naming a configuration in another checkout, a cache set inside that other checkout is
used. That checkout's commits make no claim about the store's files, though a configuration taken from a checkout is trusted
already, with its schemas.

`check --changed` trusts the snapshot for one thing: which records cite a path, from each reference's resolved target. It loops
over the store's current file listing, not over the snapshot's rows: for each record listed now, it uses the snapshot's rows only
while that record's version in the snapshot equals the version on disk, and otherwise extracts its references again from its parse
entry, or parses it. So a record with no snapshot rows, one that existed at `REV` or one added since, is still examined, a stale
snapshot costs work and never hides a citing record, and a forged one would need a write to the user's cache directory, which can
as well replace vmd itself. That holds because what a reference reaches depends only on what is at the path its URI names or below
it (a path where no file is but files are below names a directory), at its targets and at the paths its aliases name, and a change
at a path an alias names, as an old or new path of a record alias or the record of an anchor alias, makes the scope the whole
store (#26). A change to `.vmd/aliases.jsonl`, to the configuration or to a file of its `schema/` directory makes the scope the
whole store, since any reference or binding may depend on it.

**CI.** A fresh runner has an empty cache, and the gate parses everything, which is what a gate should do. A workflow that saves
and restores the per-user cache directory between runs trusts its own earlier runs, and whether a pull request's run can write a
cache that a run of the base branch later restores depends on the CI's cache scoping; for GitHub Actions this is not checked here
(U). The guidance for `vmd check` in CI is therefore to restore no vmd cache in a gate, or to pass `--no-cache` there.

**Rejected: a MAC on each entry**, under a key kept in the per-user directory. The first version of this design proposed it, for a
cache in `.vmd/cache/`. It does not hold up: a cache that always lives in the per-user directory never reads the checkout, so
committed entries are harmless without a MAC; a CI restore of the per-user directory brings the key along with the entries, which
defeats it; a restore of `.vmd/cache/` alone misses every entry, so the MAC protects only where the cache is useless; and relying
on "never cache the key" is the same weakness as relying on a gate to pass `--no-cache`. **Rejected too**: ignoring cache files
that git tracks (it needs git, and misses everything that reaches the directory another way), and re-verifying entries by parsing
(it removes what the cache is for).

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
   resolution over parsed structures costs 14 to 19 ms for vampiredb's 1,965 references (M), less than reading a cached result
   would, and it needs no record of what each result depended on.
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
  count is the references whose target is the node or lies below it, so a record's count is the sum (reading R11).
- **`grep`** gains nothing useful from the index: its estimate depends on the pattern, which no entry can know. What helps is
  cheaper: estimate the rest at the rate of matches per byte read, from the sizes `list` already returns, rather than per file,
  which a few large files skew (I2.5 makes that change).

---

## 7. Commands (I2.6)

### 7.1 `vmd check [PATHS..] [--changed REV] [-n N | --all]`

- **Scope.** Without arguments, every record. `PATHS` are store paths or globs; only those records' issues are reported, while
  their references still resolve into the whole store, as the suite's `records` input does. `--changed REV` takes the paths that
  differ from `REV` in the working copy, from `git diff --name-status -z --no-renames REV --` and the untracked files of `git
  ls-files --others --exclude-standard -z`, mapped below the store root. `--no-renames` matters: git's rename detection is on by
  default (D: git-config, `diff.renames`), and with it `--name-only` names only the new side of a rename, so after `git mv a.md
  b.md` the old path `a.md` would be missed (reported by the review of #86, not yet probed here: U). Both sides then count: the
  paths that still exist are checked, and every path, deleted or not, selects the records whose references point to it, from the
  snapshot or, without one, from every record's cached references (§16.3's incremental pattern), since a reference into a deleted
  path is now dangling. A store without history fails with `storage-failed`, as `read(…, {at})` does (#16; reading R12). `--fix`
  is I5's.
- **Output.** Issues on stdout, since they are the result (O3), each in §12.3's format, sorted by path and position; at most 20 by
  default (`-n N`, `--all`), then the counts per code that `formatIssues` already writes; and a last line: `37 records (35 from
  the index), 1,965 references: 40 errors, 17 warnings`. Configuration issues and the Unicode warning go to stderr (O3). `--quiet`
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
37 records (0 from the index), 1,965 references: 40 errors, 17 warnings
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
`37 records (2 parsed, 35 from the index), 1,965 references; cache 1.4 MB` (illustrative). `--publish DIR` is the portable index,
which §21 puts in I7 and §19.2 in the Publish profile; until then it is `usage-invalid` with that message, a deferral (section
11). The local entries are already in its row format, so I7 concatenates them and adds the manifest.

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

- 37 Markdown records, 3.1 MB, none unreadable; the parse raises 17 warnings, all `anchor-element-ignored` (#20, open item 1).
- 2,006 links and definitions: 1,994 links and 12 link reference definitions, which 12 reference links use. 41 of the links are
  autolinks or autolink literals, which section 5.1 does not count as references, so the references are 1,965. None is in a
  heading; none targets an image, an asset or a directory.
- Their targets: 1,198 resolve through an explicit anchor and 661 through a block anchor; 53 name a record without a fragment; 12
  are absolute URIs and 1 climbs above the store root (`guidelines/Decision_Log.md:234`, `../../.github/workflows/checkers.yml`),
  so 13 leave the store; and 40 match no node. None goes through a derived anchor.
- `scripts/docs.sh` on the same checkout: "30 documents, all conforming; 438 anchors and 2168 references to them checked", no
  problem (M: [`results/vampiredb-docs-sh.txt`](../research/i2-design/results/vampiredb-docs-sh.txt)).

The 40 are the links into 12 of the 17 `<a id>` elements of `design/Minimal_Log.md` that start a list item's second or later
paragraph, which §6.2 does not make block anchors (#20, which counted them). `docs.sh` reads every `<a id="…"></a>` outside code
as an anchor, so it accepts them.

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
| a link with `#ID` to 12 of the 17 ignored anchor elements | accepted | `ref-dangling` (40), until #20's open item 1 is answered |
| a link to a missing file | only when it has a `#` | `ref-dangling` for every relative link |
| a link to a document without anchors | skipped ("its links are plain Markdown") | resolved: headings, derived anchors |
| reference links and definitions | not read (its pattern is `[text](target)`) | read |
| links and code-comment references from outside `docs/` (the repository's `README.md`, `.rs` files) | read: among its 2,168 references | outside the store, not seen |
| links from `docs/` to outside it | not checked | outside the store (13), not checked (§8.2); the 41 autolinks are not references |
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

### 8.4 The 17 anchor elements (#20, open item 1)

#20's first open item asks the owner whether the 17 anchor elements move in vampiredb's documents or §6.2 widens to accept them;
it is not in the decision log yet. I2 proceeds either way: the code does not depend on the answer, only the demonstration's
numbers do. Until it is answered, `vmd check` on vampiredb exits with 4 for the 40 links, and I2.8's record explains them. If §6.2
widens, the block anchor of a list item's later paragraph is that paragraph, which I1's ranges already define for a top-level one,
and the 40 resolve; if the documents change, it is 17 edits in vampiredb by its owner, and the 40 links resolve with them. G6
forbids lowering `ref-dangling`, and K3 forbids editing vampiredb from here, so the trial configuration cannot hide them.

---

## 9. Performance budget

The plan's exit: a warm `vmd check` over vampiredb's docs in under two seconds. Measured in one process (M). The probe ran four
times: three on a quieter machine, and the run whose output is committed under a load average of about 18, which the second figure
of each range shows.

| Step | Quieter runs | Committed run, load about 18 |
|---|---|---|
| parse every record, first time in the process | 932 to 948 ms | 1,179 ms |
| parse every record again | 863 to 882 ms | 1,115 to 1,255 ms |
| a git blob id for every file | 6 to 7 ms | 8 ms |
| `stat` of every file | 0.2 ms | 0.4 ms |
| resolve every reference, the records parsed | 14 to 15 ms; 8 to 9 ms with the resolvers' maps built | 19 ms; 11 ms |
| a second, separate Markdown parse for links (not proposed) | 849 to 878 ms | 1,174 ms |
| the validator: import, and compile one schema of 200 properties, in a fresh process | 26 ms, 12 ms | |
| validate one record against it | 25 to 36 µs | |

So a **cold check without a cache** costs about 60 ms of Node and imports (I1 §7), 40 ms for the validator, 950 to 1,250 ms of
parsing, a few milliseconds of validation and 15 to 20 ms of resolution: about 1.1 to 1.4 s (U until I2.8 measures it), within the
budget already. A **warm check** re-parses nothing: the listing and hashing (10 ms), reading 37 parse entries and 37 bindings (U:
the rows of Minimal_Log are a few hundred kilobytes), resolution (15 to 20 ms) and output. A few hundred milliseconds, including
Node's start, is the expectation (U).

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

**Crafted schemas.** These budgets hold for real schemas, which are small: the repository's 20 have at most 6 parts that hold or
lead to a vmd keyword (card AE). For now a schema is refused only by the specification's existing rules (Draft v0.15 §9.2,
decision AE), and a crafted one can make loading slow and validation slower: the check of where declarations meet takes one to
three minutes on the worst crafted schemas of 1 MiB measured (#119), and a 109-byte schema makes a 146-byte record take 6.9 s to
validate, doubling with each level of nesting (#111). The 1 MiB bound does not prevent it. A service that validates untrusted data
runs each operation with a time budget of its own; core sets none (#111 lists the directions, none decided).

---

## 10. Testing

As in I1 (I1 §8): Vitest unit tests per module, property tests with fast-check, the suite's cases, and the owner's rules.

**Property tests**, each with an oracle of its own where one exists:

1. **Keyed lists against §9.3's compilation.** Random member-keyed lists and declarations (`map` and `multimap`, `required`,
   per-key `items`, `additional`): core's native evaluation and the validator run over the standard compilation of §9.3 agree on
   validity, with core's `duplicate-key` standing for the compilation's `maxContains` failure. The oracle is the specification's
   own definition, run by a validator core does not write.
2. **Dates and times.** Strings built from random components (year, month, day, hour, minute, second, fraction, offset), valid
   exactly when the components are: the day against `Date.UTC`'s calendar for that month, a zoned time's leap second against 23:59
   UTC after the offset computed with integer arithmetic, and a local date-time's in any minute. Mutations (a separator, a digit count, a case) are checked against the ABNF.
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
- a failing `contains`, `maxContains` or `minContains` that puts no issue on its valid items; a failing `propertyNames` whose
  issue is at the member, not at `#*/…` (section 3.5);
- one store's configuration opened twice in a process, and a schema edited between two opens, with no "already registered" error
  (section 3.1.1);
- a `multimap` under an array's `items` beside `x-vmd-list`'s per-key schema, which the proof must refuse (section 4.4); two
  `patternProperties` that bring unequal declarations to one member, which must give that member a `schema-violation` and leave
  the collection's other records alone, in either order of checking (section 3.3); an unreferenced `$defs` entry with a
  declaration under `oneOf`, which is valid;
- `check --changed` after `git mv a.md b.md` with a reference to `a.md` elsewhere, which must report it as dangling (section 7.1);
- a `.vmd/cache/` committed into a store, which must never be read; a snapshot whose citing record changed, which must not hide it
  from `--changed`; eviction under the bound (section 6.2);
- `../` past the root, which RFC 3986 clamps; `%E9` and other paths that do not decode as UTF-8;
- a `$ref` beside other keywords in a YAML schema, which the record-shape code `ref-malformed` would refuse;
- `23:59:60+02:00` invalid and `01:59:60+02:00` valid; `P1Y3D`; `"-0"`; `9223372036854775808` as a string;
- `unevaluatedItems` beside `x-vmd-list`; an `x-vmd-list` under `oneOf`;
- a stale binding after a schema edit; two processes writing one entry; an entry of another build;
- the `$title` offset of a link after an anchor element, and in a setext title of two lines.

---

## 11. Readings of the specification

Where the specification is silent or ambiguous and the design chooses, each for the owner to confirm or correct. None of these
refuses what the specification allows or changes what it states; the design's choices that would are questions in section 12.

| | Reading | Where |
|---|---|---|
| R1 | Windows reserved names are compared without regard to ASCII case; case conflicts compare per-code-point lower case (§6.3 step 3) | §3.2 |
| R2 | `@collection` is absent for a record in no collection, as `@key` is for the root | §5.10 |
| R3 | one `schema-violation` per failing value, by the folding rules of section 3.5, so that no issue lands on a valid value | §9.2, Appendix D |
| R4 | the proof of §7.4 looks the first step's anchors up in the record, and, where the schema alone cannot prove the address, all of the first step's matches (card AO), then works from the schema alone | §7.4 |
| R5 | a typed string that is not a valid `uri-reference` is a `schema-violation` and no reference | §8.1 |
| R6 | a query in a reference is ignored for resolution | §8.2 |
| R7 | a reference to an ignored file is checked like one to an asset, for existence | §3.3, §8.2 |
| R8 | an ambiguous reference lists its candidates as `targets`; a malformed fragment is `ref-dangling` | §8.5, conformance README `refs` |
| R9 | an invalid alias file stops `check`, as an operation error does | §13.6, Appendix D |
| R10 | a reference is identified across runs by citing path, node, form, raw text and rank, for `ref-retargeted` | §13.5 |
| R11 | a node's refs-in count includes the references into nodes below it | §12.1, §12.2 |
| R12 | `check --changed` on a store without history fails with `storage-failed` | §12.1, §11.2 |
| R13 | `path-invalid` is raised once per path, naming every rule it breaks, not once per rule | §3.2, Appendix D |
| R14 | `x-vmd-ref`'s `targets` is checked wherever something is at the path, `ok`, `aliased`, `ambiguous`, `unreadable` and an empty `many` reference, and not for a `dangling` one; the path checked is the one after record aliases; confirmed by the project owner on card W9 | §9.3 |
| R15 | a record that two collections claim (`collection-conflict`) matches no collection entry of `targets`, as it is read as a record of none; confirmed by the project owner on card W9 | §9.1, §9.3 |
| R16 | `targets: []` allows no target; without `targets`, any is allowed; confirmed by the project owner on card W9 | §9.3 |
| R17 | `anchors: explicit` on a reference resolved through an anchor alias checks the route after the alias renamed the first step; confirmed by the project owner on card W9 | §9.3, §13.6 |
| R18 | under `anchors: explicit`, a step through a title-derived name raises both `ref-target-not-allowed` and `ref-derived-anchor`; confirmed by the project owner on card W9 | §9.3, Appendix D |
| R19 | a `cardinality: many` reference whose anchor alias leads to a name where the later steps match nothing is `ok` with no targets, as a single reference through it stays `dangling`; the other reading is `aliased` with no targets (confirmed by the project owner on card W9). A record alias that leads a `many` reference to a record where its fragment matches nothing leaves it `ok` with no targets too, as for an old section name, a single reference through it staying `dangling` (the project owner's answer on card AU, 2026-10-20); one whose fragment matches there is `aliased` | §8.5, §13.6 |
| R20 | a typed reference that leaves the store, a URL or a path above the store root, is not checked against `targets`, as §8.2 tracks nothing outside the store, so `targets: [tickets]` accepts `https://…`; confirmed by the project owner on card W9 | §8.2, §9.3 |
| R21 | a `$ref` object's declaration and its `$ref` member's are compared as written, as declarations that meet at one location are, so `{}` and `{cardinality: one}` differ, the rule card AR keeps (question 22); confirmed by the project owner on card W9 | §9.3 |
| R22 | Agent's reading, for the owner to confirm: a node's refs-in count counts the references whose status is `ok` or `aliased` and that have a target at the node or below it, each reference once per node however many of its targets are there; an `ambiguous` reference's candidates do not count (I2.5) | §12.1, §12.2 |
| R23 | Agent's reading, for the owner to confirm: a `PATHS` argument of `vmd check`, a store path or a glob, that matches no record fails the check with `address-not-found`, naming every such argument, and for a path that is a directory, with a hint giving the glob that checks the records below it, as `ls` gives one; an asset is no record. A check that says "0 records, 0 errors" for a mistyped path would read as a pass (I2.6) | §12.1 |
| R25 | Agent's reading, for the owner to confirm: `vmd index --no-cache` is `usage-invalid`, since the command's purpose is to write the local index that the option turns off; `vmd index` where the cache cannot be used (no build id, or a cache directory refused inside the store or a working tree around it) still checks the whole store, prints its counts and a line saying why nothing was kept, and exits 0. Draft v0.18 §14.3 says a cache that is not used is as if `--no-cache` were given; for `index` that would make an unusable cache a usage error the user did not cause, so `index` reports it instead, as Appendix D has no code for a cache (I2.6) | §12.1, §14.3 |

The first version listed 20 readings. Seven of them (its R1 and R4 to R8, and R20) refused or moved what the specification allows,
and are now questions, with the value of `x-vmd-summary`, which no reading named: collection names (question 10), the schema
directory (13), `$id` (14), YAML anchors in schemas (15), `unevaluatedItems` beside `x-vmd-list` (16), `$sections` keyed by `@key`
alone (17), `x-vmd-ref` without `format` (18), the value of `x-vmd-summary` (19), the size of schema files (20) and unknown
configuration members (21). One was not a reading but a deferral: `vmd index --publish`, a command of §12.1, is refused until I7
builds the portable index, as `check --fix` is until I5.

---

## 12. Open questions

Each with its options, a recommendation and what follows from it. Those marked *spec* change the specification if answered as
recommended, and go into a Draft v0.11 with their decision records before the pull request that needs them (section 13).

1. **The validator.** (a) `@hyperjump/json-schema` 1.18.0; (b) Ajv 8.20.0 with `ownProperties: true`, core checking a `properties`
   entry named `__proto__` itself, `$dynamicRef` refused, and its wrong verdicts on `unevaluated*` listed as known deviations: 13
   of 199 such tests here (M: [`unevaluated-cases.mjs`](../research/i2-design/unevaluated-cases.mjs)); (c) json-schema-library
   11.6.5, its unescaped locations worked around; (d) `ata-validator`, not probed. Recommended: (a), narrowly: it is the one
   without wrong verdicts, and the `unevaluated*` ones are Ajv's that vmd cannot correct; against it weigh its experimental APIs
   and process-wide state (section 3.1). Consequence: core depends on hyperjump and its peer; Appendix C and the plan's §1.2 name
   it in place of Ajv and `ajv-formats` (*spec*, Appendix C). Under (b) the design keeps its shape and loses section 3.1.1.
2. **Where `x-vmd-list` and `x-vmd-ref` may stand.** (a) on the spine of section 3.3, `schema-invalid` when reached only off it;
   (b) anywhere, with annotation semantics, which (a) of question 1 can give, and a proof of §7.4 that then cannot be static for
   those levels; (c) anywhere, applied wherever the keyword is met, failing branches included, which is what a custom keyword in
   Ajv does. Recommended: (a): a reference's meaning never depends on which branch of a `oneOf` its record satisfies, and the
   proof stays before evaluation. Whether Python's `jsonschema` can collect annotations, which (b) would need of a Python
   implementation, is U. Consequence: §9.3 says where the keywords may stand, and that two `patternProperties` that bring unequal
   declarations to one member in the data are a `schema-violation` at that member (section 3.3) (*spec*, §9.3). Allowing the
   keywords off the spine later relaxes a refusal that fails every read of the collection under question 12's answer, so it is an
   addition under question 21's (a); otherwise it needs a new `x-vmd-*` keyword or a major version.
3. **A reference through a level declared `multimap`**, which §7.4 says cannot be singular, but §8.5 gives no status for. (a)
   status `ambiguous`, issue `ref-ambiguous` saying it cannot be proved singular; (b) a new code `ref-not-singular`, status
   `ambiguous`; (c) evaluate it, and accept it when one node matches. Recommended: (a): the reference may match several nodes by
   declaration, and it keeps one code per status. (c) contradicts §7.4. The rule is the same for every form of reference: Markdown
   links, `$ref` objects and typed strings. Consequence: §8.5 and Appendix D's `ref-ambiguous` row name the case (*spec*, §8.5,
   Appendix D); E2 applies the proof to every reference, E1 having resolved links before any level could be declared (section 13).
4. **Where the cache lives.** (a) always in the per-user cache directory (`$XDG_CACHE_HOME/vmd/` or `~/.cache/vmd/`,
   `~/Library/Caches/vmd/`), with entries shared by every store and worktree, one snapshot per store's real path, eviction to a
   bound (section 6.2), and a global `--no-cache`; (b) `.vmd/cache/` in a store that has a `.vmd/`, and the per-user directory
   only for a store read with `--config`, which is what the first version proposed, and which reads the checkout as cache and
   needed a MAC that does not hold up (section 6.2.1); (c) no persistent cache unless a new `--cache DIR` says where. Recommended:
   (a): nothing in a checkout is ever read as cache, worktrees share their entries, and reading vampiredb's `docs/` writes nothing
   there (K3). Consequence: §14.3's "a cache in `.vmd/cache/`, which is never committed" becomes a cache in a per-user directory
   outside every store; §12.1 gains `--no-cache`; §17's table of git paths drops `.vmd/cache/` from its row of untracked paths
   (*spec*, §12.1, §14.3, §17).
5. **A record that two collections match.** (a) a new validation error, `collection-conflict`, at the record, which is then read
   unschematized; (b) `config-invalid`, failing every command once such a file exists; (c) the first collection by name. (b) lets
   one new file break the store, and (c) depends on names. Recommended: (a). Consequence: Appendix D gains the code, and §9.1 says
   what a conflict does (*spec*, §9.1, Appendix D).
6. **`issues` entries for codes whose severity depends on context.** Appendix D already says that structural and operation codes
   cannot be configured and that a validation error stays an error. Open is what an entry does to `duplicate-key`,
   `duplicate-anchor`, `path-invalid`, `path-case-conflict` and `not-representable`, which are errors in some contexts and
   warnings in others. (a) the entry applies to the code's warnings only, and never touches its errors; (b) the entry sets every
   occurrence, which would lower errors that G6 keeps. Recommended: (a). Consequence: Appendix D's "Configuring severities" states
   it (*spec*, Appendix D).
7. **Images.** §8.1 names inline links and link reference definitions. (a) an image is a reference too, so a missing image is
   `ref-dangling`; (b) images are not references. vampiredb's docs have none (M); tickets with screenshots will. Recommended: (a),
   since a broken image is the broken link a reader sees first. Consequence: §8.1's table gains a row (*spec*, §8.1).
8. **Keyed-list keys.** (a) one key member per list, several being `schema-invalid`; a key is a string; an item without one, or
   with a key that is not a string, is a `schema-violation` at the item in a declared list, and is reached only by its `$anchor`
   or its exact path, since no step indexes a keyed list (§7.3); (b) composite keys now, with a rule for which member a step
   matches, which §9.3's "a semantic path step matches a single key member" leaves open. Recommended: (a); no case needs composite
   keys. Consequence: §5.6 and §9.3 state it (*spec*). Allowing several key members later relaxes a `schema-invalid`, an addition
   under question 21's (a) once question 12's answer makes it fail every read.
9. **`targets` entries.** §9.3's example mixes `tickets`, a collection, and `docs/**`, a glob. (a) an entry naming a collection of
   the configuration is that collection, and any other entry is a glob; (b) a prefix such as `collection:tickets`, explicit but
   changing Appendix A's schema. Recommended: (a), which with question 10's names never confuses a collection with a glob holding
   `/` or `*`. Consequence: §9.3 states it (*spec*, §9.3).
10. **Collection names.** §9.1 allows any string. (a) names match `[A-Za-z][A-Za-z0-9_-]*`, so that a name never holds `/`, `*` or
    `:` and stays usable in `targets` (question 9) and in §7.6's `collection:key`; (b) any string, with `targets` and the
    shorthand escaping. Recommended: (a). Consequence: §9.1 states the pattern, and a configuration with another name is
    `config-invalid` (*spec*, §9.1).
11. **The strict read mode now, and a global `--strict`.** (a) core's mode in I2.3, and `--strict` for `get`, `outline`, `ls` and
    `refs` in I2.6; (b) as the plan says, in I3.4 with `query`. Recommended: (a): its inputs all exist in I2, and an agent reading
    a store that does not validate can use it before queries exist. Consequence: §12.1 gains `--strict`, and the plan's I3.4 loses
    the mode (*spec*, §12.1).
12. **A collection whose schema is invalid.** (a) `schema-invalid` is reported once; `check` goes on with the other collections,
    and checks that collection's records for everything but their schema; every reader refuses that collection's records: a
    single-record read (`get`, `outline`, `resolve`) fails with `schema-invalid`; a multi-record read leaves them out, as it
    leaves out records with structural errors (§9.5), so a query returns the other collections' matches with one `schema-invalid`
    issue counting the records left out, and fails as a whole only in the strict read mode, where refused records are errors; `ls`
    counts them as unreadable; and a reference with a fragment into one has the status `unreadable`. (b) as (a) for `check`, but
    reads go on without the schema. (c) every command that opens the store fails. Recommended: (a). (b) is what the first version
    proposed, and it misreads: an older reader that does not know a construct of a newer schema (an unknown `x-vmd-*` keyword,
    which §9.1 already relies on to be detectable, or a relaxation under question 21) would read the collection without its
    schema, and its typed references and logical types would silently become plain strings. (c) refuses everything, including
    `check` and the collections whose schemas are fine, where (a) refuses only the affected collection's records and only to
    readers.

    **(a) reverses recorded decisions**, and the owner should take it as such: C2 as F1 narrowed it, that structural errors alone
    make a record unreadable, and the correction of Draft v0.4, "Whether a record is readable never depends on its schema". Under
    (a), a record without a structural error is still refused by readers when its collection's schema cannot be used. The reason
    is the one F1 gave for readers in the first place, read the other way: a reader must not return a value it would read wrongly,
    and without its schema it would. Consequence (*spec*): §5.4's sentence gains "provided the collection's schema can be used";
    §9.5 item 1, "reads a record as long as it has no structural error", gains the same condition; §8.5, J3's rule and Appendix
    D's `ref-target-unreadable` row, which tie `unreadable` to a structural error, extend it to a record of a collection with an
    invalid schema; Appendix D's `schema-invalid` row says what it refuses; the count of records `ls` and `query` could not read
    includes them; and §9.1 says what "is an error" does for such a collection. Question 21's (a) depends on this answer: it is
    what keeps every reader from returning data under a schema the reader cannot use.
13. **Where a configuration's schemas are.** §9.1 says `.vmd/schema/`. (a) in `schema/` beside the configuration file, which is
    `.vmd/schema/` for the store's own configuration and for the suite's `config` input, and `examples/vampiredb/schema/` for
    `--config examples/vampiredb/config.yaml`; (b) always the store's `.vmd/schema/`, so that a store read with `--config` and no
    `.vmd/` of its own, vampiredb's `docs/`, has no schemas; (c) a `schemas` member of the configuration naming the directory.
    Recommended: (a): it changes nothing for a store's own configuration, and it is what lets I2.7 work without modifying
    vampiredb. Consequence: §9.1's comment and §12.1's `--config` say it (*spec*, §9.1, §12.1).
14. **`$id` in a schema file.** It is valid 2020-12. (a) refused (`schema-invalid`) in I2; (b) allowed, with every file still
    reachable by its name as well as by its `$id`. Recommended: (a) for now: a base URI of its own changes what a relative `$ref`
    in that file means, and no schema of the suite or Appendix A needs one. Consequence: §9.2 says that vmd's schemas are 2020-12
    without `$id` (*spec*, §9.2); allowing it later is an addition under question 21's (a).
15. **YAML anchors, aliases and tags in schema files.** They are valid YAML, and some authors share definitions with them. (a)
    schema files follow vmd's YAML rules, so they are `schema-invalid`; (b) schema files are read with plain YAML 1.2.
    Recommended: (a): one YAML reader with one set of rules for every file vmd reads (J5's spirit), and `$defs` with `$ref` does
    what anchors do. Consequence: §9.2 says so (*spec*, §9.2).
16. **`unevaluatedItems` beside `x-vmd-list`.** The validator does not know that `x-vmd-list` evaluates the items, so
    `unevaluatedItems: false` beside it would fail valid data. (a) `schema-invalid`; (b) core tells the validator, by compiling
    the declaration's per-key schemas into the schema it hands over, which the native evaluation of section 3.3 avoids.
    Recommended: (a). Consequence: §9.3 says so (*spec*, §9.3).
17. **`$sections` keyed by `@key` alone.** §9.3 allows `@key` only on `$sections`, but does not forbid other keys there. (a) a
    `$sections` list is keyed by `["@key"]` only, since `$sections` is keyed by the section key by definition (§5.6); (b) other
    keys allowed on `$sections`, keying sections by a field. Recommended: (a). Consequence: §9.3 says so (*spec*, §9.3).
18. **`x-vmd-ref` on a string schema without `format: uri-reference`.** §8.1 makes a typed reference a string whose schema has
    both, and does not say what `x-vmd-ref` alone is. (a) `schema-invalid`; (b) no reference, silently. Recommended: (a): a
    declaration that does nothing is a mistake to report. Consequence: §8.1 or §9.3 says so (*spec*, §9.3).
19. **The value of `x-vmd-summary`.** §9.3 gives none. (a) a boolean, anything else `schema-invalid`; (b) any value, counted as
    true. Recommended: (a), so that `x-vmd-summary: false` means what it says. Consequence: §9.3's table gives the value (*spec*,
    §9.3).
20. **The size of a schema file.** (a) at most 1 MiB, the bound I1.8 set for the configuration (a deviation recorded in #17); (b)
    no bound. Recommended: (a): a schema of more is a mistake or an attack on a validating service. Consequence: §9.1 states both
    bounds (*spec*, §9.1).
21. **Unknown configuration members, and what §9.1 counts as an addition.** §9.1 allows a minor version to add only a new `$`
    member, a new `data` info string or a new `x-vmd-*` keyword. That leaves out a new configuration member, and every relaxation
    of a refusal (questions 2, 8, 14). (a) §9.1's list becomes "any construct the previous minor version refuses so that no reader
    returns data that holds it": a structural error, which makes the record unreadable; an operation error that fails the
    operation, such as an invalid configuration; or, under question 12's answer, an invalid schema, whose records every reader
    refuses (a single read fails, a multi-record read leaves them out and counts them). A relaxation of what is today a validation
    error does not qualify, since a best-effort reader reads past validation errors (§9.5): if 1.1 accepted a space in
    `date-time`, a 1.0 reader's `check` would report a `schema-violation`, but its `query` would return the record and compare the
    value wrongly; such a change needs a major version. An unknown configuration member is then `feature-unsupported`, whose
    message names the store's declared version. (b) the three forms stay, an unknown configuration member is `config-invalid`, and
    a new member or a relaxation needs a major version or a new keyword; (c) unknown configuration members are ignored, which
    would misread a newer store silently. Recommended: (a). Its reason is the one §9.1 gives for the three forms, that an older
    reader fails rather than misreads, and the narrowing keeps it. The existing `x-vmd-*` form has the same exposure as any schema
    construct, since an unknown keyword only makes the schema invalid; question 12's (a) is what keeps every reader from returning
    the collection's data, and with (b) of question 12 it would not be detectable either. Consequence: §9.1's "Every addition is
    detectable" and Appendix D's `feature-unsupported` row change (*spec*, §9.1, Appendix D), and the answer depends on question
    12's.
22. **A `$ref` object whose schema and whose `$ref` member's declare unequal `x-vmd-ref`.** Card AN makes the
    object the one reference, with its member's declaration, and does not say which applies when both declare. (a) They are
    refused: `schema-invalid` where the schema alone brings them together (the spine's check, section 3.3), and a
    `schema-violation` at the object, which then gets neither, where only a member name in the data does, as §9.3 has it for
    other declarations that meet in the data; (b) the member's wins; (c) the object's wins. Recommended: (a), which the code
    does, so that no record is read under a choice nobody made; recorded on #24
    (https://github.com/nosferatech/vollmond/issues/24#issuecomment-6295156256). Consequence: §9.3 and Appendix D's
    `schema-invalid` row name the case (*spec*, §9.3, Appendix D). **Answered:** the project owner chose (a) on card AR, and
    Draft v0.17 states it in §9.3.

Not a question but pending with the owner: #20's open item 1, the 17 anchor elements of `design/Minimal_Log.md` (section 8.4). The
design does not depend on it; I2.8's numbers do.

---

## 13. Task order

Each row is one pull request (plan §1.3). Letters continue I1's scheme. "Questions" are those whose answers the pull request
implements; a *spec* answer is in Draft v0.11 before the pull request starts.

| PR | Task | After | Questions | Done when |
|---|---|---|---|---|
| A | I2.1 configuration (#21), with `check` in core and the runner's `check` | (none) | 5, 6, 10, 13, 21 (and 12, on which 21 depends) | the 41 cases of section 7.6 pass; a `config-invalid` test per member and limit, each with its near miss; path rules and `filename-mismatch` with cases added to the suite; `ls`'s collection column; `--config` with its `schema/`; Stryker's survivors listed |
| Y | YAML ambiguity warnings (#21) | A | (none) | `values/yaml-scalars` passes; `yaml_quoting` and an `issues` entry over them |
| C | I2.2 schemas (#22) | A | 1, 2, 8 (the keyword checks), 12, 14 to 20 | `values/logical-types` and `validation/bom-config` pass; property test 2; each `schema-invalid` and `feature-unsupported` fires once; the predicted bugs of section 10 for schemas |
| E1 | I2.4 references: extraction, resolution, statuses, aliases, warnings, `refs` in the runner, `@refs` (#24) | A | 7 | the five `references/targets` cases of section 7.6 pass; property tests 3 and 4; a suite case per status and warning |
| D | I2.3 keyed lists, uniqueness, the proof, canonical addresses, strict read in core (#23) | C | 8 (resolution), 11 (core's mode) | the rest of `addresses/cardinality` passes; property tests 1 and 6; #15's first deviation removed |
| E2 | I2.4 typed references, `x-vmd-ref`, and the proof of §7.4 for every reference, links included (#24) | D, E1 | 3, 9 | the other `references/targets` cases and `addresses/explicit-refs` pass: all 108 Validate cases pass |
| F | I2.5 local index (#25) | E2 | 4 | property test 5; the CI guard of section 9; the per-user cache with its eviction, and a test that nothing in the checkout is read or written as cache; `ls`'s store-wide count and `outline`'s refs-in counts |
| G | I2.6 commands `check`, `refs`, `schema`, `index` (#26) | F | 4 (`--no-cache`), 11 (`--strict`) | command tests over a fixture store for each option, stream and exit code of section 7.5; `--changed` in a temporary git repository, a `git mv` among them |
| H | I2.7 vampiredb trial (#27) | C (draft), G (final) | (none) | `examples/vampiredb/` holds the configuration and schema of section 8.2; `vmd check` runs over the store with them |
| K | I2.8 demonstration (#28) | G, H | (none; #20's open item 1 sets its numbers) | `check-demo.mjs` and its record in #28: the comparison of section 8.3, the planted faults, cold and warm timings, the store unchanged |

A starts at once. After A, C, E1 and Y run in parallel, and D follows C. **The critical path is A, C, D, E2, F, G, K**: the
binding needs schemas, typed references need the binding, the index caches what the binding gives, and the commands read the
index. H's schema can be written as soon as C lands, and only its run waits for G.

So the answers are needed in this order: 5, 6, 10, 12, 13 and 21 before A; 1, 2, 8 and 14 to 20 before C; 7 before E1; 11 before
D; 3 and 9 before E2; 4 before F. Draft v0.11 can take them in one round before A, or in two, the second before C.

The phase's exit, as the plan states it: the I0 fixtures for §8 and §9 pass (the 108 cases, and those the pull requests add), and
a warm `vmd check` over vampiredb's docs takes under two seconds.

---

## 14. Documents to update

With the owner's answers, in the same pull request as the answers they follow from (`AGENTS.md`, "Documents are a set"):

- **The implementation plan**: §1.2 (the validator, if question 1 is (a), and no `ajv-formats`); I2.2 (keyed lists evaluated
  natively, with the compilation as a test oracle); I2.5 (every reference re-resolved, section 6.4); I2.6 (`index` added, as §12.1
  lists it); I3.4 (the strict read mode, if question 11 moves it).
- **The proposal**:
  - §21's I2 row: "over vampiredb's docs and tickets" predates the move of the tickets to eternal-circle (the plan, 2026-10-10),
    so it says docs only, as the plan's I2.8 does; "`x-vmd-list` compilation" becomes its native evaluation; and its command list,
    "`check`, `refs`, `schema`", gains `index`;
  - §14.3: the sentence on `git ls-files -s`, which contradicts I1 §2.6's hashing of the bytes the backend returns (section 6.3),
    and "a cache in `.vmd/cache/`, which is never committed", which becomes a per-user cache outside every store (question 4);
    §17's table, whose row of untracked paths names `.vmd/cache/` (4);
  - §12.1: `--no-cache` (question 4), `--strict` (question 11), and `--config`'s schema directory (question 13);
  - §9.1: the schema directory (question 13), collection names (10), a record two collections match (5), a collection with an
    invalid schema (12), the bound on schema files (20), and the list of additions (21);
  - for question 12, which reverses C2 as F1 narrowed it and Draft v0.4's correction: §5.4's sentence on readability and the
    schema; §9.5 item 1; §8.5 and J3's rule on `unreadable`; the counts of records `ls` and `query` could not read (§9.5, §12.2);
    and a decision record that names both reversed decisions;
  - §9.2: `$id` (question 14) and YAML anchors in schemas (15); §9.3: the spine and overlapping patterns (2), keys (8), `targets`
    (9), `unevaluatedItems` (16), `$sections` keys (17), `x-vmd-ref` without `format` (18), `x-vmd-summary` (19); §5.6 (8); §8.1,
    images (7); §8.5 (3);
  - Appendix C, the validator row (question 1); Appendix D: `collection-conflict` (5), `ref-ambiguous` (3), `feature-unsupported`
    (21), "Configuring severities" (6), and the `ref-target-unreadable` and `schema-invalid` rows (12).
- **The conformance README**: the `refs` operation's `targets` for an ambiguous reference (R8), once confirmed.
- **This design**: section 12's answers, as the I1 design records card K in its section 9.

A validation pass over those documents closes that pull request, naming each and what changed.
