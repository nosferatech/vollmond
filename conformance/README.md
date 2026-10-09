# Conformance suite

Status: design proposal for issue #4 (I0.3), awaiting the project owner's approval. Until it is approved, the suite holds only the
three sample case files listed under [Samples](#samples). The fixture tasks (#5 to #8) and the TypeScript runner (#19) follow the
format once it is approved.

The suite checks that an implementation of vmd behaves as [the proposal](../docs/draft/vollmond-proposal.md) specifies (§19.1). It
is language-neutral. It holds data files only, and each implementation brings a runner in its own language that reads the cases,
calls its library, compares the outcomes and writes a report in the common format below. Sections of the proposal are cited as §n.

In brief:

- **Inputs are files.** Every record a case reads is a real file in a fixture store, so the bytes under test are exactly the bytes
  checked in ([Inputs](#inputs)).
- **Cases are JSON.** A case file holds the cases of one topic. Each case names an operation, its inputs, and the expected result
  or issues ([Case files](#case-files), [Operations](#operations)).
- **Results are compared by value**, as §5.8 defines equality, after each operation maps its output to a fixed shape
  ([Comparing results](#comparing-results)).
- **Issues are compared by code, severity and location**, never by message ([Expected issues](#expected-issues)).
- **An implementation declares what it supports**, and every case it skips appears in its report with the reason
  ([Running a subset](#running-a-subset), [Reporting results](#reporting-results)).
- **The suite's version is the spec's version plus a revision** ([Versioning](#versioning)).

Each major choice below is followed by the alternatives that lost, with the reason.

---

## Directory structure

```
conformance/
  README.md                this document
  suite.json               the suite's version and the case format's version
  .gitattributes           turns off line-ending conversion for the whole suite
  cases/
    <topic>/
      <name>.cases.json    a case file
      <name>/              the fixture store that case file uses, by convention
        .vmd/config.yaml
        ...                records, assets, and schemas in .vmd/schema/
  stores/
    <name>/                fixture stores shared by several case files, such as the VQL stores
```

The topics to start with, each a directory under `cases/`:

| Topic | Covers |
|---|---|
| `values` | §4: the I-JSON subset, constructs outside the data model, numbers, logical types |
| `markdown` | §5.3: front matter, the title heading, sections, data blocks, `$body`, container blocks |
| `data` | §5.4: JSON and YAML records |
| `uniqueness` | §5.7: strict and lenient modes |
| `anchors` | §6: explicit, derived and block anchors, and tags. `anchors/github-slugs` holds the slugs captured from GitHub (#8) |
| `addresses` | §7: exact and semantic paths, cardinality, canonical addresses |
| `references` | §8: reference forms, resolution and status |
| `validation` | §9: schemas, the extension keywords, logical types as assertions |
| `vql` | §10: queries over fixture stores, in both targets |
| `serializer` | §5.8: round trips, and values that are not representable |
| `edits` | §13.3: edits with expected bytes (I4) |
| `selftest` | the runner's own comparison ([Runner self-test](#runner-self-test)) |

A fixture task adds a topic when none of these fits.

Rules:

- A **case file** is a file under `cases/` whose name ends in `.cases.json`. A runner finds case files by walking `cases/` and
  does not descend into fixture stores, so a record in a store is never taken for a case file.
- A **fixture store** is a directory containing `.vmd/config.yaml`, which is how §3.3 defines a store. Its records, assets and
  schemas are ordinary files. A store that one case file uses sits next to it under the case file's name; a store that several use
  sits under `stores/`.
- **Paths inside a case file** are relative to the case file's directory, and use `/`.
- **Every path in the suite follows §3.2**, apart from `.vmd` and `.gitattributes`, so that the suite checks out unchanged on
  macOS, Windows and Linux.
- **Nothing may rewrite the suite's bytes.** `.gitattributes` turns off git's line-ending conversion for every file under
  `conformance/`. Formatters and linters (Biome in this repository, and editors that trim whitespace on save) must exclude
  `conformance/`, since they would reformat the inputs. Input versions ([Inputs](#input-versions)) catch whatever slips through.

**Topics, not section numbers or profiles.** Directories named after sections (`05.3-markdown/`) would move whenever the proposal
is renumbered, which `AGENTS.md` expects to happen. Directories per profile (§19.2) do not fit a case that needs two profiles,
such as a query over a store with schemas. Topics are stable names. The sections and profiles a case needs are data in the case,
and selection uses them ([Running a subset](#running-a-subset)).

**Many cases per file, not one directory per case.** Address, uniqueness and VQL cases come many to one input: twenty addresses
into one record, thirty queries over one store. A directory per case would repeat the reference to the input in each, multiply the
number of files, and scatter cases that a reviewer wants to read together. One file for the whole suite was rejected too. The
fixture tasks #5 to #7 run in parallel and would conflict in it, and it would be too long to review.

**Runners live with their implementations, not in the suite.** The TypeScript runner belongs to the TypeScript workspace, and a
Python runner to the Python implementation. `conformance/` then holds data only, and another implementation can copy it or add it
as a submodule without taking any code. A single shared runner that drives every implementation through a process protocol was
rejected. It would keep the comparison in one place, but every implementation would have to build an adapter process, numbers and
bytes would cross one more serialization boundary that itself needs the exactness rules below, and checking a Python
implementation would need Node. The comparison rules are short, and the [self-test](#runner-self-test) checks each runner's copy
of them. This differs from the plan's §1.1, which places a TypeScript runner in `conformance/`
([open question 10](#open-questions)).

---

## Inputs

### Records and stores

Every record a case reads is a file in a fixture store, never a string inside the case file. A case names the store (`store`, a
directory) and, where the operation reads one record, the record (`record`, a store path as in §3.1). A runner gives the store to
its implementation through any backend it likes, a filesystem backend being the obvious one, as long as the implementation
receives each file's bytes unchanged.

**Inline inputs were rejected**, for three reasons:

- A record's format comes from its extension, and its references resolve against its path (§3.1, §8.2). It needs a file name and a
  place in a store anyway.
- In a YAML block scalar, CRLF line breaks become LF and the final newline depends on the chomping indicator, so the bytes under
  test would change without notice. A JSON string keeps every byte, but a Markdown record written as one escaped line can be
  neither reviewed nor checked against GitHub's rendering of it.
- Two ways to state an input would mean two code paths in every runner.

### Configuration override

`config` is optional. It names a configuration file that the implementation uses in place of the store's `.vmd/config.yaml`. It
exists so that one store serves both uniqueness modes (§5.7), with the same records read under `uniqueness: strict` and under
`uniqueness: lenient`. It does what `vmd --config PATH` does in the plan's I2.1.

**Two copies of the store were rejected.** They state each record twice, and the copies drift apart when one is edited.

### Input versions

`versions` is optional. It maps store paths to the file version (§11.3) each file must have, which is its git blob id as
`git hash-object --no-filters FILE` prints it. Before running the case, the runner computes the blob id of each listed file, SHA-1
over `"blob " + length + "\0" + content` with the length in decimal bytes, and reports the case as `error` when one differs.

A case gives versions whenever its point is a property of the bytes that a tool could change unnoticed: line endings, a missing or
an extra final newline, trailing whitespace, tabs, a byte order mark. Without them, an editor that converts CRLF to LF turns a
CRLF case into a second LF case, which still passes, and CRLF handling goes untested. A mismatch is reported, never repaired. The
fix is to restore the file or, when the change was intended, to update the version in the same change.

### Values and strings

Inputs that are not records are given in the case file, an address or a query as a string and a value for the serializer as JSON.

---

## Case files

A case file is a JSON object with an optional `defaults` and a list of `cases`:

```json
{
  "defaults": {
    "spec": ["5.3"],
    "profiles": ["read"],
    "operation": "parse",
    "input": { "store": "line-endings" }
  },
  "cases": [
    {
      "id": "crlf-no-final-newline",
      "description": "The same record with CRLF line endings and no final newline gives the same value view.",
      "input": {
        "record": "crlf.md",
        "versions": { "crlf.md": "c4cc8cf2d7d196c8dec172f5f30e6bc83223ccd9" }
      },
      "expect": { "result": { "$title": "Flusher stalls under load", "status": "Open", "...": "..." } }
    }
  ]
}
```

The `result` is abridged here; [the sample](cases/markdown/line-endings.cases.json) has it whole. The members of a case:

| Member | Meaning |
|---|---|
| `id` | the case's local id, `[a-z0-9][a-z0-9-]*`, unique within its file |
| `description` | one sentence on what the case checks, and why when that is not obvious |
| `spec` | the sections of the proposal the case checks, as strings without `§`: `"5.3"`, or `"A"` for Appendix A |
| `profiles` | every profile of §19.2 the case needs, in lower case: `read`, `validate`, `query`, `write`, `refactor`, `publish`. Empty for the runner's self-test |
| `operation` | what the runner asks its implementation to do ([Operations](#operations)) |
| `input` | the operation's inputs |
| `expect` | the expected outcome (below) |

All seven are required once defaults are applied. `defaults` may give `spec`, `profiles`, `operation` and `input`. A case's own
member replaces the default one, except `input`, whose members are merged one level deep, so that a member of the case's `input`
replaces the default member of the same name.

A case's **global id** is the case file's path under `cases/` without `.cases.json`, then `/`, then the local id:
`markdown/line-endings/crlf-no-final-newline`. Reports and skip lists use global ids. Moving a case file changes the ids of its
cases, and a skip entry that then matches nothing is reported ([Reporting results](#reporting-results)).

The members of `expect`:

| Member | Meaning |
|---|---|
| `result` | the operation's result, for an operation that returns one, compared by value ([Comparing results](#comparing-results)) |
| `fails` | `true` when the operation must fail |
| `issues` | the issues the operation must report ([Expected issues](#expected-issues)). Absent means none |
| `bytes` | reserved for the serializer and edit cases of I4 ([Operations](#reserved-for-i4)) |

For an operation that returns a result, `expect` has exactly one of `result` and `fails`. An operation without a result (`check`,
`round_trip`) must succeed unless `fails` is given.

### Reading case files

Case files are UTF-8 JSON within I-JSON (RFC 7493). A runner reads them

- **rejecting duplicate member names**, as I-JSON requires, and
- **keeping every number exactly**, as its decimal source text or as an arbitrary-precision decimal.

A runner that reads numbers into doubles turns `9007199254740993` into `9007199254740992`, and every case about §4.2 then passes
or fails by accident. The self-test cases catch it. In JavaScript, `JSON.parse` alone is not enough; how `@vollmond/core` keeps
exact numbers is the subject of the parser survey (#3), and the TypeScript runner can use the same means.

A case file the runner cannot read, or a case that breaks the rules of this section, gives `error` for each case concerned, or for
every case in the file when the file cannot be read at all.

**YAML case files were rejected.** YAML is easier to write by hand and allows comments. But Python's usual YAML reader, PyYAML,
reads YAML 1.1, so it reads `2026-10-09` as a date and `yes` as a boolean, and the suite is full of such values on purpose. Exact
numbers are also harder to get from YAML readers than from JSON ones, and §19.1 already says the expected outputs are JSON. A
case's `description` does the work of a comment.

---

## Operations

The operations are the contract between the suite and a runner. Each one says what the runner asks of its library, which inputs it
takes, and the shape its result is mapped to before comparison. Two shapes recur:

- A **location** is `{"path": <store path>, "at": <exact path>}`. `at` is an RFC 6901 JSON Pointer over the record's value view,
  written raw rather than percent-encoded, and `""` for the root. A block anchor's location adds `"range": [start, end]`, a range
  of offsets into the `$body` that `at` names ([open question 4](#open-questions)).
- A **target list** is an array of locations.

| Operation | Profiles | Spec | Input | Result |
|---|---|---|---|---|
| `parse` | `read` | §4, §5 | `store`, `record` | the value view |
| `source_map` | `read` | §5.9 | `store`, `record` | a byte range per node |
| `anchors` | `read` | §6 | `store`, `record` | the record's anchors and tags |
| `resolve` | `read`, and `validate` where a schema is needed | §7 | `store`, `address` | cardinality and targets |
| `canonical_address` | `read` | §7.5 | `store`, `record`, `at` | an address |
| `check` | `validate` | §5.7, §9 | `store`, optional `records` | none; the issues are the outcome |
| `refs` | `validate` | §8 | `store`, optional `record` | the references |
| `query` | `query` | §10 | `store`, `query`, and parameters | the matches |
| `round_trip` | [open question 11](#open-questions) | §5.8 | `value`, `format` | none |
| `compare` | none | §5.8 | `a`, `b` | a boolean |
| `serialize`, `edit` | `write` | §5.8, §13 | reserved for I4 | bytes |

Every operation that takes `store` also takes `config` and `versions` ([Inputs](#inputs)).

**Which issues an operation reports.** `check` reports every issue for the store, or for the records listed in `records`, at every
severity. Every other operation reports only the issues that make it fail, so when it succeeds its issues are empty, and warnings
are tested through `check`. A `parse` case about one construct then does not have to list every warning its record also raises.

`outline` and `get`, which the Read profile also requires (§19.2), have no operation yet. §19.1 does not list them, and the source
form of `get` depends on the spans of [open question 3](#open-questions).

### parse

The result is the record's value view (§5.1), including the computed `$key` members (§5.5). The operation fails when the record
has no value view, because of a parse error or a value outside the data model (§4.1), and its issues are those errors. An input
that fails should contain exactly one error, so that the case does not depend on whether an implementation reports every error or
stops at the first, which the spec does not say.

### source_map

The result is an object whose member names are exact paths of nodes in the value view, and whose values are `[start, end]`,
zero-based byte offsets into the file with the end exclusive. Lines and columns follow from the offsets and the file, so they are
not compared. Which nodes have an entry and which bytes each one covers is not specified yet ([open question 3](#open-questions)),
and `source_map` cases wait for that answer.

### anchors

The result is `{"anchors": {<name>: <target>}, "tags": {<tag>: [<target>, ...]}}`, where a target is `{"at": ...}` and, for a
block anchor, `"range"` as in a location. The record is implied, so targets have no `path`. `anchors` holds the explicit anchors,
the derived anchors (§6.3) with their repeat suffixes, and the block anchors (§6.2). Each tag's list is compared unordered.

### resolve

`address` is a record path with an optional fragment, as the API takes it (§7.1), with characters outside `step` percent-encoded.
The result is `{"cardinality": "one" | "many", "targets": [<location>, ...]}`. `cardinality` is what the checker proves before
evaluating (§7.4), `one` for a singular address and `many` for a selector. `targets` is compared unordered. The operation fails
when the address is malformed, when a singular address matches nothing, and when it matches several nodes (§7.4). A case that
needs a schema to resolve, through a keyed list (§5.6) for example, lists `validate` among its profiles.

### canonical_address

The input names a node by `record` and `at`. The result is its canonical address (§7.5) as a fragment with its `#`, such as
`"#done"`.

### check

`records` optionally limits the check to some records of the store. There is no result. The issues are every issue the
implementation reports for the store or for those records (§9.2).

### refs

`record` optionally limits the result to references made from that record. The result is an array, compared unordered, of objects
with these members:

- `from`: the location of the reference. For a `$ref` object or a typed string it is that node; for a Markdown link it is the
  `$body` that holds it, and `offset` gives the link's position in that `$body` (§5.9).
- `raw`: the reference's target as written in the record.
- `status`: `ok`, `dangling`, `ambiguous` or `aliased` (§8.5).
- `targets`: the target list, compared unordered. A target that is an asset or a directory has `path` only. A dangling reference
  has an empty list.

Links that leave the store are not listed (§8.2).

### query

`query` is the VQL text. The parameters of §10.5 are given by their names: `target`, `fields`, `sort`, `limit`, `per_record`. The
result is `{"matches": [...], "totals": {"records": n, "matches": n}, "more": true | false}`:

- Each match has `path` and `at`, the canonical `address` with the `nodes` target, and `fields` when the case asks for a
  projection, an object from each projection path to its value. Matches are compared in order, since the sort order is specified
  (§10.5).
- `totals` is compared only when the implementation reports the totals as exact.
- `more` says whether the implementation returned a next cursor.

The other members of a result in §10.5 are left out. Titles and sizes are tested by other operations, token counts and excerpts
are approximate by definition, cursors are opaque, and what matched may be added by the VQL fixtures. Paging past the first page
and the per-record cap are settled by the VQL fixtures (#34), in a revision of the case format if they need one.

### round_trip

`value` is a JSON value in the case file, and `format` is `md`, `yaml` or `json`. The runner has its implementation serialize the
value to the format and parse the bytes back, then compares the value view it gets with `value`. There is no result to expect. The
operation succeeds when the two are equal, and a difference is a `fail`. The operation fails when the serializer rejects the value
as not representable (§5.8). Its issues then have `path` null and name the offending node in `at`.

### compare

The runner's self-test, never passed to the implementation. The result is `true` when `a` and `b` are equal under the rules of
[Comparing results](#comparing-results), and `false` otherwise.

### Reserved for I4

`serialize` (a value to the canonical bytes of a format) and `edit` (the semantic operations of §13.2 on a record, giving the new
bytes) compare bytes rather than values. `expect.bytes` will name a file in the suite whose exact bytes the outcome must equal,
with a version checked as for inputs. Their inputs are settled when I4's cases are written.

---

## Comparing results

**Value equality**, as §5.8 defines it:

- Null and booleans equal themselves.
- Numbers are equal when their decimal values are equal, so `1`, `1.0`, `10e-1` and `1E0` are one number (§4.2). A number the
  implementation holds as a binary floating-point value is first written as its shortest round-trip decimal, which is the
  canonical form of §4.2, and that decimal is compared. For integers beyond ±(2^53−1), see [open question 2](#open-questions).
- Strings are equal when they are the same sequence of Unicode code points, without normalization (§4.1).
- Arrays are equal when they have the same length and equal items in the same order.
- Objects are equal when they have the same member names and equal values for each, in any member order (§4.1).

**Unordered lists.** Where an operation says a list is compared unordered, two lists are equal when their items can be paired one
to one with each pair equal. Only an operation's definition makes a list unordered, never a case, and only where the spec fixes no
order.

**Whole results.** A result is compared whole. A member or an item that the case does not expect is a failure, and so is a missing
one. A member that is not reliable is kept out of the result by the operation's shape, as `query` leaves out excerpts, not by the
case.

**Partial matching was rejected**, where a case lists only the members it cares about. Each case author would decide again what
matters, and an extra wrong member or an extra query match would pass unseen.

---

## Expected issues

An expected issue has four members:

| Member | Meaning |
|---|---|
| `code` | the issue's code, as the CLI prints it and the index stores it (§12.3, §14.2) |
| `severity` | `error` or `warning` ([open question 1](#open-questions)) |
| `path` | the store path of the record the issue is about, or `null` for an issue that belongs to no record, such as a query that does not parse or a value given to the serializer |
| `at` | the exact path of the node the issue is about, or `null` when there is none, as for a syntax error that leaves no value view |

For example, with a placeholder code:

```json
"expect": {
  "fails": true,
  "issues": [{ "code": "placeholder-yaml-alias", "severity": "error", "path": "aliases.yaml", "at": "/b" }]
}
```

The reported issues are mapped to these four members and compared with the expected ones as an unordered list. Every expected
issue must be reported, and every reported issue must be expected. Messages, hints, candidates, semantic paths and `line:col` are
not compared. Messages and hints are prose that is improved over time, and lines and columns wait for
[open question 4](#open-questions).

These four are the stable part of what §12.3 and the `issues` table of §14.2 give each issue. Severity is needed because the same
duplicate is an error in strict mode and a warning in lenient mode (§5.7). The location is needed so that an error found at the
wrong node does not pass.

**Codes.** The spec has no list of issue codes yet; §12.3 shows `ref-ambiguous` only as an example. The suite needs a fixed
vocabulary, and the vocabulary belongs to the spec, since the CLI and the index print the same codes. Until the spec has one, no
case that expects an issue can be written in its final form ([open question 1](#open-questions)).

Alternatives that lost:

- **Comparing messages.** They change with their wording, and differ between implementations.
- **Comparing only that the operation failed.** A parse that fails for another reason than the one the case is about would pass.
- **The suite defining its own codes.** Two vocabularies for one thing, the suite's and the CLI's, would drift apart.

---

## Running a subset

### The implementation's declaration

Each implementation keeps a JSON file that its runner reads, wherever it likes:

```json
{
  "name": "vollmond-ts",
  "version": "0.1.0",
  "profiles": ["read"],
  "skip": [
    { "operation": "source_map", "reason": "source maps come with the Markdown parser, #13" },
    { "id": "markdown/containers/", "reason": "container blocks are not parsed as prose yet, #13" }
  ]
}
```

- `profiles` lists the profiles of §19.2 the implementation claims. A case that needs a profile not listed is skipped, with the
  reason `profile <name> not declared`.
- `skip` lists entries that each have exactly one selector and a `reason`. The selectors are `id` (a global id, or a prefix ending
  in `/` that matches every case below it), `section` (as in [Selecting](#selecting)) and `operation`. A skipped case is not run,
  and the first entry that matches gives the reason.

A case whose operation the runner does not implement is an `error`, not a skip, unless a skip entry covers it. Every skip is
therefore intended and explained.

### Selecting

A run can be narrowed by profile, by section, and by id prefix. A section selects every case whose `spec` lists it or a section
below it, so `7` selects `7`, `7.3` and `7.3.1`, while `7.3` does not select `7.31`. Cases outside the selection are left out of
the report, and the report states the selection, so that a partial run is never taken for a full one. Cases inside the selection
that are skipped stay in the report, as `skip` with their reason. The [self-test](#runner-self-test) cases are always selected.

How a runner takes the selection, by flags or otherwise, is its own affair; the declaration and the report are common.

**Capability flags in the cases were rejected**, such as `"requires": ["source-maps"]`. They need a vocabulary of features that
grows with every optional part of the spec, and old cases would need editing whenever one is added. Selectors on the
implementation's side need nothing from the cases.

**Expected failures are left for later.** These would be cases that run although they are known to fail, and are reported when
they start to pass. Skips suit I1 to I3, where most skipped cases exercise operations that do not exist yet and cannot run. A skip
that stands for a bug, though, stops testing whatever else the case checks and hides the fix when it comes. If skip lists start to
hold bugs rather than missing features, expected failures are the next revision of the case format.

---

## Reporting results

A runner writes its report as one JSON document:

```json
{
  "suite": { "version": "0.3.0", "case_format": 1 },
  "implementation": { "name": "vollmond-ts", "version": "0.1.0", "profiles": ["read"] },
  "selection": null,
  "results": [
    { "id": "addresses/appendix-a/explicit-anchor", "verdict": "pass" },
    { "id": "addresses/appendix-a/section-body", "verdict": "fail", "detail": "got /$sections/0 for /$sections/0/$body" },
    { "id": "markdown/line-endings/crlf-no-final-newline", "verdict": "error", "detail": "crlf.md: version 6c79cbf..." },
    { "id": "vql/tickets/status-open", "verdict": "skip", "reason": "profile query not declared" }
  ],
  "unused_skips": []
}
```

The verdicts:

| Verdict | Meaning |
|---|---|
| `pass` | the outcome matched the expectation |
| `fail` | the outcome differs, or the implementation crashed |
| `skip` | the case was not run; `reason` says why |
| `error` | the case could not be run as written: an input is missing or has another version, the case is malformed, or the runner does not implement its operation |

- `selection` is `null` for a full run. Otherwise it is `{"profiles": ..., "sections": ..., "ids": ...}`, each a list or `null`.
- `results` are in the byte order of their global ids. `detail`, on `fail` and `error`, is free text for people and is never
  compared.
- `unused_skips` lists the skip entries that matched no case, so that stale entries are found. It is reported for full runs only,
  since a selection leaves entries unused by design.
- The report carries no totals. They follow from `results`, and a stored count could disagree with them.

`error` is kept apart from `fail` so that a broken checkout, such as a file converted to LF, is not blamed on the implementation.

The runner exits with status 0 when no result is `fail` or `error`, and 1 otherwise. When it does not know the `case_format` of
`suite.json`, it writes no report and exits with status 2. Besides the report, a runner may print progress, TAP or JUnit XML for
its own test framework.

**TAP or JUnit XML as the contract were rejected.** CI tools read both, but neither has a place for the suite's version, the
declared profiles or the selection, so two implementations' reports could not be compared without extensions of our own. JUnit XML
is also tied to one family of test frameworks.

---

## Runner self-test

The `selftest` cases check the runner's comparison, not the implementation. They use the `compare` operation, need no profile, and
run in every run, whatever the selection. They exist because the likeliest runner bug makes every case pass. A comparison that
reads `9007199254740993` as a double, or that compares arrays as sets, accepts wrong results without complaint. Each self-test
case pairs two values that one specific wrong comparison would confuse.

---

## Versioning

`suite.json` holds two numbers:

```json
{ "version": "0.3.0", "case_format": 1 }
```

- **`version`** is `<spec version>.<revision>`. Its first two parts are the version of the proposal the suite tests (Draft v0.3
  gives `0.3`), and the revision counts the suite's changes under that version. Any change to a case, an input or an expectation
  increases the revision. A change of the spec's version resets it to 0, in the same change that moves the proposal's status line.
  Reports carry the version, so a result always says which suite produced it, including in a copy of the suite outside this
  repository, where no git history says so.
- **`case_format`** is the version of the format this README defines. It increases only when a runner must change to read the
  suite correctly, through a new member it has to understand or a changed meaning. A runner refuses a case format it does not know
  rather than misread it. A new operation does not change the case format, since a runner that lacks it reports its cases as
  `error` until it implements them or skips them by declaration.
- **Section citations.** Cases cite sections in `spec`. A change that renumbers the proposal updates them as well, as `AGENTS.md`
  asks for every place that cites a section.

Alternatives that lost:

- **An independent version for the suite.** Readers would need a table from suite versions to spec versions, since there would be
  two version lines for one contract.
- **The git commit alone.** It is lost when the suite is copied into another implementation's repository, and it does not say
  which version of the spec the suite tests.

---

## Writing a runner

1. Read `suite.json`, and stop with status 2 if its `case_format` is unknown.
2. Read the implementation's declaration and the selection.
3. Walk `cases/` for files named `*.cases.json`, without descending into fixture stores. Read each one as
   [Reading case files](#reading-case-files) requires, apply its `defaults`, and form the global ids.
4. Take the cases in the selection in the byte order of their global ids. Skip a case if it needs an undeclared profile, or else
   if a skip entry matches it.
5. Check the input versions, and report `error` on a mismatch.
6. Perform the operation with the implementation's library. A crash is a `fail`.
7. Map the outcome to the operation's shape: the result, whether the operation failed, and the issues as `code`, `severity`,
   `path` and `at`.
8. Compare as [Comparing results](#comparing-results) and [Expected issues](#expected-issues) say.
9. Write the report, and exit with the status [Reporting results](#reporting-results) gives.

---

## Samples

| Case file | Shows |
|---|---|
| `cases/selftest/compare.cases.json` | the runner self-test, and the equality rules of §5.8 as data |
| `cases/markdown/line-endings.cases.json` | byte-exact inputs. The example of §5.3, once with LF and a final newline and once with CRLF and none, each with its input version, gives the value view §5.3 shows; the store sits next to its case file |
| `cases/addresses/appendix-a.cases.json` | `resolve` over the ticket of Appendix A, with the results of Appendix A's address table |

None of them expects an issue, since no issue code is defined yet ([open question 1](#open-questions)).

---

## Open questions

These are for the project owner. Where the spec is silent on something the suite needs, this README does not decide it.

1. **Issue codes.** The suite compares issues by code, and the spec defines none (§12.3 shows `ref-ambiguous` as an example). The
   addition this implies is a normative list of issue codes, each with its severity (in each uniqueness mode, where they differ),
   the section that raises it, and the node it is attached to (for a duplicate key, the object or the second member, for example).
   The list should also fix the severities, `error` and `warning` or more. Open are where the list lives (§12.3, or an appendix),
   and how fixture tasks write expected issues before it exists. One way is for the fixture tasks to propose codes and for I0.8
   (#9) to adopt them into the spec.
2. **Numbers outside the exact range.** §4.2 requires integers within ±(2^53−1) exactly, and every other number "at least as an
   IEEE 754 double". Is an implementation that parses `12345678901234567890` into the double `12345678901234567168` conformant for
   `parse`? If it is, the suite needs a way to accept either value. If not, the spec should say that value views keep every number
   exactly. The same holds for decimals with more digits than a double holds.
3. **Source map spans.** Which bytes does each node's range cover? Does a section run from its heading line to the next heading,
   with or without trailing blank lines? Is a front-matter or data-block field its value, or its key and its value? Do `$key` and
   the root have entries? And does the Read profile require source maps at all? §5.9 calls them optional, and §19.1 lists them in
   the suite.
4. **Offsets and positions.** The unit of an offset into `$body`, for block anchors (§6.2) and for references in prose (§5.9,
   §14.2): UTF-8 bytes, UTF-16 code units or code points. The base and unit of an issue's line and column (§12.3). The suite
   compares no lines or columns until this is settled.
5. **Line endings in the value view.** Does the `$body` of a CRLF Markdown record keep `\r\n`, or read as `\n`? The answer decides
   whether the LF and CRLF forms of one record have the same value view and the same node versions (§11.3). The sample avoids the
   question with single-line bodies.
6. **Lenient mode and singular addresses.** §7.4 says a singular address is valid only if each step crosses a level whose keys are
   unique by declaration or by the strict default, proven before evaluation. §5.7 says that in lenient mode a singular address
   fails as `ambiguous` where it hits a duplicate. In a lenient store, is `#notes` rejected before evaluation, or only when a
   second `## Notes` exists? `resolve` cases in lenient mode need the answer.
7. **`$key` in round trips.** The value view holds the computed `$key` (§5.5), which must never be written (§5.4). Does the value
   `v` of §5.8's guarantee include `$key`, and does the serializer reject, ignore or check a `$key` that disagrees with the title
   or the anchor?
8. **The minimal store.** Is a `.vmd/config.yaml` holding only `vmd: 1` a valid store, and what are the defaults of its other
   members? The samples assume it is, with `uniqueness: strict` and no collections.
9. **When the spec's version changes.** The suite's version follows the spec's. The draft changes under one version number as
   decisions are applied (Draft v0.3 took several rounds). If the version moves only at milestones, the suite's revision carries
   most of the meaning. That works, but the project owner may prefer a version per round.
10. **Where the TypeScript runner lives.** The plan's §1.1 places a TypeScript runner in `conformance/`. This README keeps runners
    with their implementations, so that `conformance/` stays data only. If that is approved, §1.1 changes, #19 places the runner
    in the workspace, and `conformance/` may not need to be a workspace package (#2).
11. **The serializer's profile.** §19.2 does not name the serializer of §5.8 in any profile. The Read profile parses, and the
    Write profile names span-preserving edits. Which profile do `round_trip` cases need?
