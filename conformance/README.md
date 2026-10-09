# Conformance suite

Status: design proposal for issue #4 (I0.3), awaiting the project owner's approval. Until it is approved, the suite holds only
the three sample case files listed under [Samples](#samples). The fixture tasks (#5 to #8) and the TypeScript runner (#19)
follow the format once it is approved.

The suite checks that an implementation of vmd behaves as [the proposal](../docs/draft/vollmond-proposal.md) specifies
(§19.1). It is language-neutral. It holds data files only, and each implementation brings a runner in its own language that
reads the cases, calls its library, compares the outcomes and writes a report in the common format below. Sections of the
proposal are cited as §n.

In brief:

- **Inputs are files.** Every record a case reads is a real file in a fixture store, so the bytes under test are exactly the
  bytes checked in ([Inputs](#inputs)).
- **Cases are JSON.** A case file holds the cases of one topic. Each case names an operation, its inputs, and the expected
  result or issues ([Case files](#case-files), [Operations](#operations)).
- **Results are compared by value**, as §5.8 defines equality and with types kept apart, after each operation maps its output
  to a fixed shape ([Comparing results](#comparing-results)).
- **Issues are compared by code, severity and location**, never by message ([Expected issues](#expected-issues)).
- **An implementation declares what it supports**, and every case it skips appears in its report with the reason
  ([Running a subset](#running-a-subset), [Reporting results](#reporting-results)).
- **The suite's version is the spec's version plus a release number** ([Versioning](#versioning)).

Each major choice below is followed by the alternatives that lost, with the reason.

---

## Directory structure

```
conformance/
  README.md                  this document
  suite.json                 the suite's version and the case format's version
  .gitattributes             turns off line-ending conversion for the whole suite
  .editorconfig              asks editors not to trim whitespace or touch final newlines
  cases/
    <topic>/
      <name>.cases.json      a case file
      <name>/                the fixture store that case file uses, by convention
        .vmd/config.yaml
        ...                  records, assets, and schemas in .vmd/schema/
      <name>.versions.json   the input versions of that store, where its bytes matter
  stores/
    <name>/                  fixture stores shared by several case files, such as the VQL stores
    <name>.versions.json
```

The topics to start with, each a directory under `cases/`:

| Topic | Sections | Contents |
|---|---|---|
| `values` | §4 | the I-JSON subset, constructs outside the data model, numbers, logical types |
| `markdown` | §5.3 | front matter, the title heading, sections, data blocks, `$body`, container blocks |
| `data` | §5.4 | JSON and YAML records |
| `uniqueness` | §5.7 | strict and lenient modes |
| `anchors` | §6 | explicit, derived and block anchors, and tags |
| `addresses` | §7 | exact and semantic paths, cardinality, canonical addresses |
| `references` | §8 | reference forms, resolution and status |
| `validation` | §9 | schemas, the extension keywords, logical types as assertions |
| `vql` | §10 | queries over fixture stores, in both targets |
| `serializer` | §5.8 | round trips, and values that are not representable |
| `edits` | §13.3 | edits with expected bytes (I4) |
| `selftest` | §5.8 | the runner's own comparison ([Runner self-test](#runner-self-test)) |

A fixture task adds a topic when none of these fits. The capture of GitHub's heading slugs under `docs/research/` (#37) is
converted into `anchors` cases later, by #8, once this format is approved.

### Rules

- A **case file** is a file under `cases/` whose name ends in `.cases.json`. A runner finds case files by walking `cases/` and
  does not descend into fixture stores, so a record in a store is never taken for a case file.
- A **fixture store** is a directory containing `.vmd/config.yaml`, which is how §3.3 defines a store. Its records, assets and
  schemas are ordinary files. A store that one case file uses sits next to it under the case file's name, and a store that
  several use sits under `stores/`.
- **Every path in the suite follows §3.2**, so that the suite checks out unchanged on macOS, Windows and Linux. The exceptions
  are segments beginning with `.`, such as `.vmd`, `.gitattributes`, `.editorconfig` and the dotfiles that §3.3 cases need.
  Cases that need a path §3.2 forbids cannot be written as files ([open question 16](#open-questions)).
- **Nothing may rewrite the suite's bytes.** `.gitattributes` turns off git's line-ending conversion for every file under
  `conformance/`, and `.editorconfig` asks editors that follow the EditorConfig specification (editorconfig.org) to leave
  whitespace and final newlines alone. Formatters and linters (Biome in this repository) must exclude `conformance/`, since
  they would reformat the inputs. Input versions ([Inputs](#input-versions)) then catch any remaining change to the files they
  list.

### Paths

There are three kinds of path, each with one rule:

- **`store`** names a directory relative to the case file's directory. It may use `..` to reach `stores/`, and must stay
  inside `conformance/`.
- **Store paths** name files inside a store, as §3.1 defines record IDs. They are relative to the store root, use `/`, and
  have no leading `/` and no `.` or `..` segments. `record`, `records`, the keys of a versions manifest, and `path` in results
  and issues are store paths.
- **`config`** is a file name, without `/`, in the store's `.vmd/` directory. A file there is never a record (§3.3), so
  `check` never reads an alternative configuration as one.

`expect.bytes`, reserved for I4, will be relative to the case file's directory like `store`.

### Choices

**Topics, not section numbers or profiles.** Directories named after sections (`05.3-markdown/`) would move whenever the
proposal is renumbered, which `AGENTS.md` expects to happen. Directories per profile (§19.2) do not fit a case that needs two
profiles, such as a query over a store with schemas. Topics are stable names. The sections and profiles a case needs are data
in the case, and selection uses them ([Running a subset](#running-a-subset)).

**Many cases per file, not one directory per case.** Address, uniqueness and VQL cases come many to one input, such as twenty
addresses into one record or thirty queries over one store. A directory per case would repeat the reference to the input in
each, multiply the number of files, and scatter cases that a reviewer wants to read together. One file for the whole suite was
rejected too. The fixture tasks #5 to #7 run in parallel and would conflict in it, and it would be too long to review. This is
the shape of the JSON-Schema-Test-Suite (github.com/json-schema-org/JSON-Schema-Test-Suite), whose files each hold an array of
test groups that share one schema.

**Runners live with their implementations, not in the suite.** The TypeScript runner belongs to the TypeScript workspace, and
a Python runner to the Python implementation. `conformance/` then holds data only, and another implementation can copy the
directory without taking any code. (A git submodule would bring the whole repository with it.) The JSON-Schema-Test-Suite
works this way, leaving the runner to each implementer. The alternative is a single shared runner that drives each
implementation through a process protocol, as toml-test (github.com/toml-lang/toml-test) does. Its runner sends TOML to an
implementation's decoder on standard input and compares the JSON that comes back, with every value tagged by type and written
as a string. That keeps the comparison in one place. It was rejected because every implementation would have to build and
maintain an adapter program, numbers and bytes would cross one more serialization boundary that needs its own exactness rules,
and checking a Python implementation would need the runner's language as well. The comparison rules here are short, and the
[self-test](#runner-self-test) checks each runner's copy of them. This differs from the plan's §1.1, which places a TypeScript
runner in `conformance/` ([open question 20](#open-questions)).

---

## Inputs

### Records and stores

Every record a case reads is a file in a fixture store, never a string inside the case file. A case names the store (`store`)
and, where the operation reads one record, the record (`record`). A runner gives the store to its implementation through any
backend it likes, a filesystem backend being the obvious one, as long as the implementation receives each file's bytes
unchanged.

**Inline inputs were rejected**, for three reasons:

- A record's format comes from its extension, and its references resolve against its path (§3.1, §8.2). It needs a file name
  and a place in a store anyway.
- In a YAML block scalar, CRLF line breaks become LF and the final newline depends on the chomping indicator, so the bytes
  under test would change without notice. A JSON string keeps every byte, but a Markdown record written as one escaped line
  can be neither reviewed nor checked against GitHub's rendering of it.
- Two ways to state an input would mean two code paths in every runner.

### Configuration override

`config` is optional. It names a configuration file in the store's `.vmd/` directory, such as `config-lenient.yaml`, which the
implementation uses in place of `.vmd/config.yaml`. It exists so that one store serves both uniqueness modes (§5.7), with the
same records read under `uniqueness: strict` and under `uniqueness: lenient`. It does what `vmd --config PATH` does in the
plan's I2.1.

**Two copies of the store were rejected.** They state each record twice, and the copies drift apart when one is edited.

### Input versions

A store whose bytes matter has a **versions manifest** next to it, named after the store directory with `.versions.json`
added, such as `line-endings.versions.json` beside `line-endings/`. It is a JSON object from store paths to file versions
(§11.3), each the git blob id that `git hash-object --no-filters FILE` prints. Before running a case on a store, the runner
computes the blob id of each listed file, SHA-1 over `"blob " + length + "\0" + content` with the length in decimal bytes.
When one differs, every case on that store is reported as `error`.

A manifest lists every file whose point is a property of its bytes that a tool could change unnoticed, such as line endings, a
missing or an extra final newline, trailing whitespace, tabs or a byte order mark. Without it, an editor that converts CRLF to
LF turns a CRLF case into a second LF case, which still passes, and CRLF handling goes untested. Files the manifest does not
list are not checked. A mismatch is reported, never repaired. The fix is to restore the file or, when the change was intended,
to update the manifest in the same change.

**Versions in each case were rejected.** Every case on a store would repeat the same ids, and a change to one file would touch
every case that reads it.

### Values and strings

Inputs that are not records are given in the case file, an address or a query as a string and a value for the serializer as
JSON.

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
      "input": { "record": "crlf.md" },
      "expect": { "result": { "$title": "Flusher stalls under load", "status": "Open", "...": "..." } }
    }
  ]
}
```

The `result` is abridged here, and [the sample](cases/markdown/line-endings.cases.json) has it whole. The members of a case
are these seven:

| Member | Meaning |
|---|---|
| `id` | the case's local id, `[a-z0-9][a-z0-9-]*`, unique within its file |
| `description` | one sentence on what the case checks, and why when that is not obvious |
| `spec` | the sections the case checks, as strings without `§`, such as `"5.3"` or `"A"` for Appendix A |
| `profiles` | every profile the case needs (below) |
| `operation` | what the runner asks its implementation to do ([Operations](#operations)) |
| `input` | the operation's inputs |
| `expect` | the expected outcome (below) |

`profiles` lists profiles of §19.2 in lower case, from `read`, `validate`, `query`, `write`, `refactor` and `publish`. It is
empty for the runner's self-test.

All seven members are required once defaults are applied. `defaults` may give `spec`, `profiles`, `operation` and `input`. A
case's own member replaces the default one, except `input`, whose members are merged one level deep, so that a member of the
case's `input` replaces the default member of the same name.

**Unknown members are errors.** A member this README does not define, in a case or its `input` or `expect`, makes that case an
`error`. One at the top of a case file or in `defaults` makes every case of the file an `error`. An unknown member may come
from a newer case format and change a case's meaning, so it is never ignored.

A case's **global id** is the case file's path under `cases/` without `.cases.json`, then `/`, then the local id, as in
`markdown/line-endings/crlf-no-final-newline`. Reports and skip lists use global ids. Moving a case file changes the ids of
its cases, and a skip entry that then matches nothing is reported ([Reporting results](#reporting-results)).

The members of `expect`:

- **`result`** is the operation's result, for an operation that returns one, compared by value
  ([Comparing results](#comparing-results)).
- **`fails`** is `true` when the operation must fail.
- **`issues`** lists the issues the operation must report ([Expected issues](#expected-issues)). Absent means none.
- **`bytes`** is reserved for the serializer and edit cases of I4 ([Operations](#reserved-for-i4)).

For an operation that returns a result, `expect` has exactly one of `result` and `fails`. An operation without a result
(`check`, `round_trip`) must succeed unless `fails` is given, so a `round_trip` that must succeed is written `"expect": {}`. A
`check` never takes `fails`, since its issues are its whole outcome.

### Reading case files

Case files are UTF-8 JSON as RFC 8259 defines it. They are not I-JSON (RFC 7493), which says numbers beyond the precision of a
double should not appear, while the suite uses them on purpose. A runner reads case files with two rules:

- **Duplicate member names are rejected.**
- **Every number is kept exactly**, as its decimal source text or as an arbitrary-precision decimal.

A runner that reads numbers into doubles turns `9007199254740993` into `9007199254740992`, and every case about §4.2 then
passes or fails by accident. The self-test cases catch it. In JavaScript, `JSON.parse` alone is not enough, and a reviver that
reads each number's source text is one way. How `@vollmond/core` keeps exact numbers is the subject of the parser survey (#3),
and the TypeScript runner can use the same means.

A case file the runner cannot read, or a case that breaks the rules of this section, gives `error` for each case concerned, or
for every case of the file when the file cannot be read at all.

**YAML case files were rejected.** YAML is easier to write by hand and allows comments. But Python's usual YAML reader,
PyYAML, reads YAML 1.1, so it reads `2026-10-09` as a date and `yes` as a boolean, and the suite is full of such values on
purpose. Exact numbers are also harder to get from YAML readers than from JSON ones, and §19.1 already says the expected
outputs are JSON. A case's `description` does the work of a comment.

**Typed values, as in toml-test, were rejected.** Writing every expected value as `{"type": ..., "value": "<text>"}` would
spare runners the exact reading of numbers. It would also make every expected value view unreadable and unlike the value views
the spec shows, while an exact JSON reader is a small requirement.

---

## Operations

The operations are the contract between the suite and a runner. Each one says what the runner asks of its library, which
inputs it takes, and the shape its result is mapped to before comparison. One shape recurs.

A **target** is `{"path": <store path>, "at": <exact path>, "address": <canonical address>}`:

- `at` is an RFC 6901 JSON Pointer over the record's value view, written raw rather than percent-encoded, and `""` for the
  root.
- `address` is the node's canonical address (§7.5) as a fragment with its `#`, such as `"#done"`. For the root it is `""`,
  read from §7.1 and §7.5 as the shortest form ([open question 10](#open-questions)).
- A block anchor's target adds `"range": [start, end]`, a range of offsets into the `$body` that `at` names
  ([open question 6](#open-questions)).
- A target that is an asset or a directory has `path` only.

| Operation | Profiles | Spec | Input | Result |
|---|---|---|---|---|
| `parse` | `read` | §4, §5 | `store`, `record` | the value view |
| `source_map` | `read` | §5.9 | `store`, `record` | a byte range per node |
| `anchors` | `read` | §6 | `store`, `record` | the record's anchors and tags |
| `resolve` | `read`, or more | §7 | `store`, `address`, `as` | the targets |
| `check` | `validate` | §5.7, §9 | `store`, optional `records` | none, the issues being the outcome |
| `refs` | `validate` | §8 | `store`, optional `record` | the references |
| `query` | `query` | §10 | `store`, `query`, parameters | the matches |
| `round_trip` | [question 14](#open-questions) | §5.8 | `value`, `format` | none |
| `compare` | none | §5.8 | `a`, `b`, optional `unordered` | a boolean |
| `serialize`, `edit` | `write` | §5.8, §13 | reserved for I4 | bytes |

Every operation that takes `store` also takes `config` ([Inputs](#configuration-override)).

**Which issues an operation reports.** `check` reports every issue for the store, or for the records listed in `records`, at
every severity. Every other operation reports only the issues that make it fail, so when it succeeds its issues are empty, and
warnings are tested through `check`. A `parse` case about one construct then does not have to list every warning its record
also raises.

**Failing is not crashing.** An operation fails when the implementation reports failure through its normal error channel with
issues, as an error result or as the error type its API documents. Anything else is a crash, such as an unexpected exception,
a panic, or a hang that the runner stops after a time of its choosing. A crash is a `fail` verdict even when the case expects
`fails`.

`outline` and `get`, which the Read profile also requires (§19.2), have no operation yet. §19.1 does not list them, and the
source form of `get` depends on the spans of [open question 5](#open-questions).

### parse

The result is the record's value view (§5.1), including the computed `$key` members (§5.5). The operation fails when the
record has no value view, and its issues are the errors that prevent one. Which errors those are is
[open question 2](#open-questions). An input that fails should contain exactly one error, so that the case does not depend on
whether an implementation reports every error or stops at the first.

### source_map

The result is an object whose member names are exact paths of nodes in the value view, and whose values are `[start, end]`,
zero-based byte offsets into the file with the end exclusive. Lines and columns follow from the offsets and the file, so they
are not compared. Which nodes have an entry and which bytes each one covers is not specified yet
([open question 5](#open-questions)), and `source_map` cases wait for that answer.

### anchors

The result is `{"anchors": [...], "tags": [...]}`, both compared unordered:

- Each item of `anchors` is `{"name": ..., "kind": "explicit" | "derived" | "block", "at": ...}`, with `"range"` for a block
  anchor as in a target. `explicit` is an anchor written on a heading or an object (§6.2), `derived` a heading's GitHub slug
  with its repeat suffix (§6.3), and `block` an anchor on a paragraph or list item (§6.2).
- Each item of `tags` is `{"tag": ..., "at": ...}`, one per tag and node.

A list rather than an object keyed by name, so that it can hold an explicit and a derived anchor of the same name, and
duplicates, whatever the spec decides about them ([open question 11](#open-questions)). The record is implied, so the items
have no `path`.

### resolve

`address` is a record path with an optional fragment, as the API takes it (§7.1), with characters outside `step`
percent-encoded. `as` says how the address is used, since being singular is a property of the use and not of the text (§7.4,
§8.2):

- With **`"as": "singular"`**, as for a reference or a write target, the result is a list of exactly one target. The operation
  fails when the address is malformed, when its record does not exist, when the checker cannot prove it singular before
  evaluating (§7.4), when no node matches, and when more than one node matches (§7.3, §7.4).
- With **`"as": "selector"`**, as for a query or a reference declared `cardinality: many`, the result is the list of every
  matching target, compared unordered. The operation fails when the address is malformed or its record does not exist. Whether
  a selector that matches nothing fails is [open question 9](#open-questions).

A case that needs a schema to resolve, through a keyed list (§5.6) for example, lists `validate` among its profiles.

**A separate `canonical_address` operation was rejected.** Every target carries its canonical address instead, so each resolve
case checks it too, and one operation fewer is to be implemented.

### check

`records` optionally limits the check to some records of the store. There is no result. The issues are every issue the
implementation reports for the store or for those records (§9.2).

### refs

`record` optionally limits the result to references made from that record. The result is an array, compared unordered, of
objects with these members:

- **`from`** locates the reference as `{"path": ..., "at": ...}`. For a `$ref` object or a typed string, `at` is that node.
  For a Markdown link it is the `$body` that holds the link, and `offset` gives the link's position in that `$body` (§5.9).
- **`raw`** is the reference's target as written in the record.
- **`status`** is `ok`, `dangling`, `ambiguous` or `aliased` (§8.5).
- **`targets`** is the list of resolved targets, compared unordered. A dangling reference has an empty list.

Links that leave the store are not listed (§8.2).

### query

`query` is the VQL text. The parameters of §10.5 are given by their names, as `target`, `fields`, `sort`, `limit` and
`per_record`. `fields` is a list of projection paths. `sort` is a list of `{"field": ..., "order": "asc" | "desc"}`, with
`asc` as the default order.

The result is `{"matches": [...], "more": true | false}`:

- Each match is a target. It also has `fields` when the case gives `fields`, an object from each projection path to its value.
  Matches are compared in order, since the sort order is specified (§10.5).
- `more` says whether the implementation returned a next cursor.

The other members of a result in §10.5 are left out. Titles and sizes are tested by other operations, token counts and
excerpts are approximate by definition, cursors are opaque, and what matched may be added by the VQL fixtures. Totals, the
default projection and paging past the first page are settled by the VQL fixtures (#34), with the questions of
[open question 17](#open-questions), in a revision of the case format if they need one.

### round_trip

`value` is a JSON value in the case file, and `format` is `md`, `yaml` or `json`. The runner has its implementation serialize
the value to the format and parse the bytes back, then compares the value view it gets with `value`. There is no result to
expect. The operation succeeds when the two are equal, and a difference is a `fail`. The operation fails when the serializer
rejects the value as not representable (§5.8), and its issues then have `path` null and name the offending node in `at`.

### compare

The runner's self-test, never passed to the implementation. `a` and `b` are JSON values. With `"unordered": true`, both must
be arrays, and they are compared as unordered lists. The result is `true` when `a` and `b` are equal under the rules of
[Comparing results](#comparing-results), and `false` otherwise.

### Reserved for I4

`serialize` (a value to the canonical bytes of a format) and `edit` (the semantic operations of §13.2 on a record, giving the
new bytes) compare bytes rather than values. `expect.bytes` will name a file in the suite whose exact bytes the outcome must
equal, with a version checked as for inputs. Their inputs are settled when I4's cases are written.

---

## Comparing results

**Value equality** follows §5.8, and values of different JSON types are never equal. A runner must compare types explicitly
where its language does not. In Python, `True == 1`, `True == Decimal(1)` and `[False] == [0]` all hold, and none may hold
here.

- `null` equals only `null`, and `true` and `false` equal only themselves.
- Numbers are equal when their decimal values are equal, so `1`, `1.0`, `10e-1` and `1E0` are one number (§4.2). A number the
  implementation holds as a binary floating-point value is first written as its shortest round-trip decimal, which is the
  canonical form of §4.2, and that decimal is compared. For integers beyond ±(2^53−1), see [open question 4](#open-questions).
- Strings are equal when they are the same sequence of Unicode code points, without normalization (§4.1).
- Arrays are equal when they have the same length and equal items in the same order.
- Objects are equal when they have the same member names and equal values for each, in any member order (§4.1). A member that
  one object has and the other lacks makes them unequal, even when its value is `null`.

**Unordered lists.** Where an operation says a list is compared unordered, two lists are equal when their items can be paired
one to one with each pair equal. They are compared as multisets, so `["a", "a", "b"]` and `["a", "b", "b"]` differ. Only an
operation's definition makes a list unordered, never a case, and only where the spec fixes no order.

**Whole results.** A result is compared whole. A member or an item that the case does not expect is a failure, and so is a
missing one. A member that is not reliable is kept out of the result by the operation's shape, as `query` leaves out excerpts,
not by the case.

**Partial matching was rejected**, where a case lists only the members it cares about. Each case author would decide again
what matters, and an extra wrong member or an extra query match would pass unseen.

---

## Expected issues

An expected issue has four members:

- **`code`** is the issue's code, as the CLI prints it and the index stores it (§12.3, §14.2).
- **`severity`** is `error` or `warning` ([open question 1](#open-questions)).
- **`path`** is the store path of the record the issue is about. It is `null` for an issue that belongs to no record, such as
  a query that does not parse or a value given to the serializer.
- **`at`** is the exact path of the node the issue is about, or `null` when there is none, as for a syntax error that leaves
  no value view. For a reference in prose, `at` is the `$body` that holds it, as §12.3's example locates `ref-ambiguous` in
  `#what-was-done/$body`.

For example, with a placeholder code:

```json
"expect": {
  "fails": true,
  "issues": [{ "code": "placeholder-yaml-alias", "severity": "error", "path": "aliases.yaml", "at": "/b" }]
}
```

The reported issues are mapped to these four members and compared with the expected ones as an unordered list. Every expected
issue must be reported, and every reported issue must be expected. Messages, hints, candidates, semantic paths, offsets and
`line:col` are not compared. Messages and hints are prose that is improved over time, and lines and columns wait for
[open question 6](#open-questions).

These four are the stable part of what §12.3 and the `issues` table of §14.2 give each issue. Severity is needed because the
same duplicate is an error in strict mode and a warning in lenient mode (§5.7). The location is needed so that an error found
at the wrong node does not pass.

**Codes.** The spec has no list of issue codes yet, and §12.3 shows `ref-ambiguous` only as an example. The suite needs a
fixed vocabulary, and the vocabulary belongs to the spec, since the CLI and the index print the same codes. Until the spec has
one, no case that expects an issue can be written in its final form ([open question 1](#open-questions)).

Alternatives that lost:

- **Comparing messages.** They change with their wording, and differ between implementations.
- **Comparing only that the operation failed.** A parse that fails for another reason than the one the case is about would
  pass.
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

- `profiles` lists the profiles of §19.2 the implementation claims. A case that needs a profile not listed is skipped, with
  the reason `profile <name> not declared`.
- `skip` lists entries that each have exactly one selector and a `reason`. The selector is `id`, a global id or a prefix
  ending in `/` that matches every case below it, or `operation`. A skipped case is not run, and the first entry that matches
  gives the reason.

A case whose operation the runner does not implement is an `error`, not a skip, unless a skip entry covers it. Every skip is
therefore intended and explained.

### Selecting

A run can be narrowed by three criteria, each a list:

- **Profiles.** A case is selected when its `profiles` contain at least one of the listed profiles. Selecting `query`
  therefore selects the query cases, although they also need `read`.
- **Sections.** A case is selected when its `spec` lists one of the sections or a section below it, so `7` selects `7`, `7.3`
  and `7.3.1`, while `7.3` does not select `7.31`.
- **Ids.** A case is selected when its global id equals one of the entries, or starts with one that ends in `/`.

A case must meet every criterion given, and any one entry of a criterion is enough. The [self-test](#runner-self-test) cases
are always selected. Cases outside the selection are left out of the report, and the report states the selection, so that a
partial run is never taken for a full one. Cases inside the selection that are skipped stay in the report, as `skip` with
their reason. How a runner takes the selection, by flags or otherwise, is its own affair, while the declaration and the report
are common.

**Capability flags in the cases were rejected**, such as `"requires": ["source-maps"]`. They need a vocabulary of features
that grows with every optional part of the spec, and old cases would need editing whenever one is added. Selectors on the
implementation's side need nothing from the cases.

**Expected failures are left for later.** These would be cases that run although they are known to fail, and are reported when
they start to pass. Skips suit I1 to I3, where most skipped cases exercise operations that do not exist yet and cannot run. A
skip that stands for a bug, though, stops testing whatever else the case checks and hides the fix when it comes. If skip lists
start to hold bugs rather than missing features, expected failures are the next revision of the case format.

---

## Reporting results

A runner writes its report as one JSON document:

```json
{
  "suite": { "version": "0.3.0-dev", "case_format": 1, "commit": "1ec3cc2" },
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

- **`pass`.** The outcome matched the expectation.
- **`fail`.** The outcome differs, or the implementation crashed.
- **`skip`.** The case was not run, and `reason` says why.
- **`error`.** The case could not be run as written, because an input is missing or has another version, the case is
  malformed, or the runner does not implement its operation.

The other members:

- `suite.commit` is optional. A runner that can learn the suite's git commit gives it, which matters for a development version
  ([Versioning](#versioning)).
- `selection` is `null` for a full run. Otherwise it is `{"profiles": ..., "sections": ..., "ids": ...}`, each a list or
  `null`.
- `results` are in the byte order of their global ids. `detail`, on `fail` and `error`, is free text for people and is never
  compared.
- `unused_skips` lists the skip entries that matched no case, so that stale entries are found. It is reported for full runs
  only, since a selection leaves entries unused by design.
- The report carries no totals. They follow from `results`, and a stored count could disagree with them.

`error` is kept apart from `fail` so that a broken checkout, such as a file converted to LF, is not blamed on the
implementation.

**Exit status.** The runner exits with 0 when no result is `fail` or `error`, and with 1 otherwise. It writes no report and
exits with 2 when it cannot start, which happens when `suite.json` or the declaration cannot be read or has an unknown member,
when the `case_format` is unknown, or when the selection is invalid. Besides the report, a runner may print progress, TAP or
JUnit XML for its own test framework.

**TAP or JUnit XML as the contract were rejected.** CI tools read both, and JUnit XML can carry a skip message and free-form
`<properties>`. But neither defines where the suite's version, the declared profiles or the selection go, so the suite would
define its own names inside either format, and JUnit XML comes in several dialects without one schema. A plain JSON document
is as easy to write in any language, and its members are defined here once.

---

## Runner self-test

The `selftest` cases check the runner's comparison, not the implementation. They use the `compare` operation, need no profile,
and are always selected. They exist because the likeliest runner bugs make every case pass. A comparison that reads
`9007199254740993` as a double, that lets `true` equal `1`, that ignores a member whose value is `null`, or that compares
unordered lists as sets accepts wrong results without complaint. Each self-test case pairs two values that one specific wrong
comparison would confuse.

---

## Versioning

`suite.json` holds two members:

```json
{ "version": "0.3.0-dev", "case_format": 1 }
```

- **`version`** is `<spec version>.<release>` for a release of the suite. Its first two parts are the version of the proposal
  the suite tests (Draft v0.3 gives `0.3`), and the release counts the suite's releases under that version, from 0. A release
  is cut when the project owner asks, at the end of a phase for example. It sets `version`, and tags the commit
  `conformance-<version>`. Right after a release, `version` becomes the next release with `-dev` appended, so a checkout
  between releases never claims to be one. Ordinary changes to cases and inputs leave `suite.json` alone, so that parallel
  fixture pull requests do not conflict on it. A report carries the version, and a runner adds the commit when it can, so a
  result says which suite produced it, also in a copy of the suite outside this repository.
- **`case_format`** is the version of the format this README defines. It increases only when a runner must change to read the
  suite correctly, through a new member it has to understand or a changed meaning. A runner refuses a case format it does not
  know rather than misread it. A new operation does not change the case format, since a runner that lacks it reports its cases
  as `error` until it implements them or skips them by declaration.
- **Section citations.** Cases cite sections in `spec`. A change that renumbers the proposal updates them as well, as
  `AGENTS.md` asks for every place that cites a section.

Alternatives that lost:

- **A revision number raised by every change.** Every fixture pull request would edit the same line of `suite.json`, and the
  parallel fixture tasks #5 to #7 would conflict on it.
- **An independent version for the suite.** Readers would need a table from suite versions to spec versions, since there would
  be two version lines for one contract.
- **The git commit alone.** It is lost when the suite is copied into another implementation's repository, and it does not say
  which version of the spec the suite tests.

---

## Writing a runner

1. Read `suite.json`, and exit with 2 if it cannot be read, has an unknown member, or has an unknown `case_format`.
2. Read the implementation's declaration and the selection, and exit with 2 if either is invalid.
3. Walk `cases/` for files named `*.cases.json`, without descending into fixture stores. Read each one as
   [Reading case files](#reading-case-files) requires, apply its `defaults`, reject unknown members, and form the global ids.
4. Take the selected cases in the byte order of their global ids. Skip a case if it needs an undeclared profile, or else if a
   skip entry matches it.
5. Check each store's versions manifest, and report `error` for the cases on a store with a mismatch.
6. Perform the operation with the implementation's library. A crash is a `fail`.
7. Map the outcome to the operation's shape, which gives the result, whether the operation failed, and the issues as `code`,
   `severity`, `path` and `at`.
8. Compare as [Comparing results](#comparing-results) and [Expected issues](#expected-issues) say.
9. Write the report, and exit with the status [Reporting results](#reporting-results) gives.

---

## Samples

- **`cases/selftest/compare.cases.json`** is the runner self-test. It writes the equality rules of §5.8 as data, including
  types, missing members, Unicode normalization and unordered multisets.
- **`cases/markdown/line-endings.cases.json`** shows byte-exact inputs. The example of §5.3, once with LF and a final newline
  and once with CRLF and none, gives the value view §5.3 shows. The store sits next to its case file, with its versions
  manifest.
- **`cases/addresses/appendix-a.cases.json`** applies `resolve` to the ticket of Appendix A, with the results of its address
  table. It covers every row of the table but the last, which is a VQL query. One case is a section reached by a key and a
  derived anchor that are the same node, which must not be ambiguous (§7.3).

None of them expects an issue, since no issue code is defined yet ([open question 1](#open-questions)).

---

## Open questions

These are for the project owner. Where the spec is silent on something the suite needs, this README does not decide it. Each
question carries a recommendation where there is one.

1. **Issue codes.** The suite compares issues by code, and the spec defines none (§12.3 shows `ref-ambiguous` as an example).
   The addition this implies is a normative list of codes, each with its severity in each uniqueness mode, the section that
   raises it, the node it is attached to (for a duplicate key, the object or the second member, for example), and whether it
   prevents a value view. The severities need fixing too, `error` and `warning` or more. *Recommendation.* the list goes in a
   new appendix of the spec, cited from §12.3 and §14.2. The fixture tasks propose codes as they need them, and I0.8 (#9)
   adopts them into the spec.
2. **When `parse` fails.** §5.8 says that Markdown to the value view is total, yet §5.3 (a data block right after the title
   heading, a data block that is not an object), §5.4 (`$` members outside the allowed places) and §8.1 (a `$ref` object with
   other members) define errors. Does such a record have a value view with an issue, or none? *Recommendation.* `parse` fails
   only where no value view can be built (syntax errors, values outside the data model of §4.1). Every other error is an issue
   on a value view, and the code list of question 1 marks which codes are which.
3. **When `check` fails, and complete reporting.** Does "validation failed" (exit code 4, §12.3) mean at least one issue of
   severity `error`? Must an implementation report every error, or may it stop at the first? The suite compares the whole set
   of `check` issues, so it needs every one. *Recommendation.* `check` reports every issue it can find and fails on any error,
   while `parse` may stop at its first error, which is why failing `parse` inputs hold one error each.
4. **Numbers outside the exact range.** §4.2 requires integers within ±(2^53−1) exactly, and every other number "at least as
   an IEEE 754 double". Is an implementation that parses `12345678901234567890` into the double `12345678901234567168`
   conformant for `parse`? The same holds for decimals with more digits than a double holds. §4.1 also adopts I-JSON, whose
   RFC says such numbers should not appear, while §4.2 keeps them. *Recommendation.* value views keep every number exactly, as
   `@vollmond/core` will. §4.1 then adopts I-JSON's restrictions except its limit on numbers. Otherwise the suite needs a
   second accepted value for every such case.
5. **Source map spans.** Which bytes does each node's range cover? Does a section run from its heading line to the next
   heading, with or without trailing blank lines? Is a front-matter or data-block field its value, or its key and its value?
   Do `$key` and the root have entries? And does the Read profile require source maps at all? §5.9 calls them optional, and
   §19.1 lists them in the suite. *Recommendation.* decide the spans with the Markdown parser (I1.4, #13), and make source
   maps a stated option of the Read profile rather than a requirement, since a backend without files has none (§5.9).
6. **Offsets and positions.** What is the unit of an offset into `$body`, for block anchors (§6.2) and references in prose
   (§5.9, §14.2), and the base and unit of an issue's line and column (§12.3)? *Recommendation.* offsets in UTF-8 bytes, like
   the byte ranges of source maps and of `read` (§11.2). Lines and columns from 1, with columns in code points. The suite
   compares no lines or columns until this is settled.
7. **Line endings in the value view.** Does the `$body` of a CRLF Markdown record keep `\r\n`, or read as `\n`? The answer
   decides whether the LF and CRLF forms of one record have the same value view and node versions (§11.3). The sample avoids
   the question with single-line bodies. *Recommendation.* the value view reads line breaks as `\n`, while edits keep the
   file's own line endings (§13.3). Otherwise a Windows checkout with git's line-ending conversion would change every
   multi-line value and node version.
8. **Singular addresses that fail at evaluation.** §7.4 says a singular address is valid only if each step crosses a level
   whose keys are unique, and that the checker proves this before evaluating. Two cases escape the proof. In lenient mode,
   §5.7 says a singular address fails as `ambiguous` where it hits a duplicate, so the proof cannot reject it in advance. And
   in any mode, §7.3's first step can match both a root member and the anchor of another node, which only evaluation finds.
   *Recommendation.* §7.4 states that the proof covers the levels an address crosses, and that a singular address can still
   fail as `ambiguous` at evaluation, in those two cases.
9. **A selector that matches nothing.** Is it an empty result or a failure? *Recommendation.* an empty result, as for a query
   with no matches.
10. **The canonical address of the root.** §7.5 gives none for the root. *Recommendation.* no fragment, the shortest form that
    §7.1 makes the root. The `address` of the root's target is then `""`, which the Appendix A sample assumes.
11. **Explicit and derived anchors.** Do they share one namespace, so that an explicit anchor equal to another heading's
    derived anchor is a duplicate (§9.2)? Which wins in resolution if not? And which text is a heading's derived anchor
    computed from? The capture of #37 shows GitHub deriving `what-was-done-`, with a trailing hyphen, from Appendix A's
    heading `## What was done <a id="done" class="decision"></a>`, while §6.3 applied to `$title` gives `what-was-done`. The
    `anchors` operation returns a list so that it can express any answer. *Recommendation.* one namespace per record, with a
    collision a duplicate-anchor error, and derived anchors computed as GitHub computes them, with §6.3 corrected in I0.8 from
    #37's findings.
12. **`$key` in round trips.** The value view holds the computed `$key` (§5.5), which must never be written (§5.4). Does the
    value `v` of §5.8's guarantee include `$key`, and what does the serializer do with a `$key` that disagrees with the title
    or the anchor? *Recommendation.* the serializer ignores `$key` on input, and the guarantee compares against `v` with its
    `$key` members recomputed.
13. **Where the round-trip property test lives.** §5.8 says the conformance suite tests the round trip as a property, but a
    property test generates values and is code, which the suite does not hold. *Recommendation.* each implementation runs the
    property test in its own tests (fast-check in TypeScript, plan §1.2), the suite holds example round trips and the values
    that are not representable, and §5.8 says so.
14. **The serializer's profile.** §19.2 names the serializer of §5.8 in no profile. The Read profile parses, and the Write
    profile names span-preserving edits. Which profile do `round_trip` cases need? *Recommendation.* Write, since the
    canonical serializer arrives with I4 (§21).
15. **The minimal configuration.** §5.7 makes `strict` the default and §9.1 makes a record in no collection valid. What
    remains open is whether `collections` and `ignore` may be absent, and whether `vmd: 1` is required. *Recommendation.* a
    `.vmd/config.yaml` holding only `vmd: 1` is valid, which the samples assume.
16. **Cases that cannot be files.** The path rules of §3.2 forbid names that cannot be checked out everywhere, such as two
    names differing only by case (one file on macOS and Windows file systems), Windows reserved names, and paths that a
    Windows checkout cannot hold. Windows limits paths to 260 characters unless long paths are enabled, which is less than
    §3.2's 1024 bytes once the checkout's own directory is added. Cases for these rules cannot be fixture files.
    *Recommendation.* leave them out for now. A later case format can add a manifest store, a JSON file from store paths to
    contents that the runner gives its implementation through an in-memory backend, used only for such cases.
17. **Query details.** Several points of §10 need an answer before VQL cases can be written. They are how the default `fields`
    of the `records` target are represented, whether totals that an implementation may estimate can be compared, the order of
    results with equal sort keys and across records ("by address" in §10.5, as a byte order of store paths and then of exact
    paths?), which case-insensitive comparison applies to non-ASCII strings (Unicode simple case folding?), and how full text
    is cut into tokens. *Recommendation.* settle them in the VQL fixtures task (#34) with additions to §10, ties ordered by
    store path and then by document order in bytes, and Unicode simple case folding.
18. **Gaps in addresses and references.**
    - §7.3's steps match "a field", and fields are the members not beginning with `$` (§5.2), yet `#what-is-confirmed/$body`
      is used throughout. *Recommendation.* a step also matches the reserved members `$title`, `$body` and `$sections`.
    - Is a link in a `$title`, or in the `$body` of a YAML or JSON record, a reference (§8.1)? *Recommendation.* yes for both,
      since both are Markdown.
    - §6.4 and §9.3 let tags feed references declared `cardinality: many`, and §7.4 counts a tag as a selector, but the
      address grammar of §7.1 has no syntax for a tag. *Recommendation.* add one, or say that only VQL selects by tag.
    - The `aliased` status (§8.5) needs aliases, which are in the Refactor profile, while references are in Validate (§19.2).
      *Recommendation.* reading `.vmd/aliases.jsonl` moves into Validate, and writing it stays in Refactor.
19. **When the spec's version changes.** The suite's version follows the spec's. The draft changes under one version number as
    decisions are applied (Draft v0.3 took several rounds). *Recommendation.* raise the spec's minor version at each round of
    decisions applied to it, so that a suite release always names one state of the rules.
20. **Where the TypeScript runner lives.** The plan's §1.1 places a TypeScript runner in `conformance/`. This README keeps
    runners with their implementations, so that `conformance/` stays data only. *Recommendation.* the runner goes in the
    workspace (#19), §1.1 changes accordingly, and `conformance/` needs no `package.json` (#2).
