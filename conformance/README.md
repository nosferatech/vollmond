# Conformance suite

Status: design proposal for issue #4 (I0.3), awaiting the project owner's approval. The owner's decisions of phase I0 answered
the questions it raised, and this version applies them, citing each by its card (C1 to C29, F1 to F10, L1, G1 to G9), as the
[decision log](../docs/draft/vollmond-proposal-review.md#decisions-of-phase-i0) records them. Until the format is approved, the
suite holds only the five sample case files listed under [Samples](#samples). The fixture tasks (#5 to #8) and the TypeScript
runner (#19) follow the format once it is approved.

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

A fixture task adds a topic when none of these fits. The headings of the capture under `docs/research/` (#37) become `anchors`
cases later, by #8, once this format is approved. Their expected anchors are those of vmd's own rule (§6.3, decisions C12 and F5),
not GitHub's, although the two agree for most headings.

### Rules

- A **case file** is a file under `cases/` whose name ends in `.cases.json`. A runner finds case files by walking `cases/` and
  does not descend into fixture stores, so a record in a store is never taken for a case file.
- A **fixture store** is a directory containing `.vmd/config.yaml`, which is how §3.3 defines a store. Its records, assets and
  schemas are ordinary files. A store that one case file uses sits next to it under the case file's name, and a store that
  several use sits under `stores/`.
- **Every path in the suite follows §3.2**, so that the suite checks out unchanged on macOS, Windows and Linux. The exceptions
  are segments beginning with `.`, such as `.vmd`, `.gitattributes`, `.editorconfig` and the dotfiles that §3.3 cases need.
  Cases that need a path §3.2 forbids cannot be written as files, and are left out for now (decision C26, §19.1). A later case
  format may add a manifest store, a JSON file from store paths to contents that the runner gives its implementation through an
  in-memory backend, used only for such cases.
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

**Runners live with their implementations, not in the suite** (decisions C29 and L1). The TypeScript runner belongs to the
TypeScript implementation in `js/`, and a Python runner to the Python implementation in `python/`. `conformance/` then holds data
only, and another implementation can copy the directory without taking any code. (A git submodule would bring the whole repository
with it.) The JSON-Schema-Test-Suite works this way, leaving the runner to each implementer. The alternative is a single shared
runner that drives each implementation through a process protocol, as toml-test (github.com/toml-lang/toml-test) does. Its runner
sends TOML to an implementation's decoder on standard input and compares the JSON that comes back, with every value tagged by type
and written as a string. That keeps the comparison in one place. It was rejected because every implementation would have to build
and maintain an adapter program, numbers and bytes would cross one more serialization boundary that needs its own exactness rules,
and checking a Python implementation would need the runner's language as well. The comparison rules here are short, and the
[self-test](#runner-self-test) checks each runner's copy of them. `conformance/` therefore needs no `package.json`.

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

Case files are UTF-8 JSON as RFC 8259 defines it. A runner reads case files with two rules:

- **Duplicate member names are rejected.**
- **Every number is read as §4.2 reads one** (decisions F2 and G1). It means its nearest double, and `-0` is `0`. A number that
  §4.2 makes an error (a number written as an integer, with no fraction and no exponent, whose double differs from it, a number
  too large for a double, or a non-zero number that a double rounds to zero) makes the case an `error`, since no value view can
  hold it. `1e23` is not written as an integer, so it is a valid number meaning its nearest double.

The check in the second rule needs each number's source text, since a plain double has already lost the difference between
`9007199254740993` and `9007199254740992`. In JavaScript, a `JSON.parse` reviver gets it from `context.source` (the proposal's
Appendix B). Without the check, a case written with such a number would expect a value that no implementation can produce, and
could pass against the rounded one.

A case file the runner cannot read, or a case that breaks the rules of this section, gives `error` for each case concerned, or
for every case of the file when the file cannot be read at all.

**YAML case files were rejected.** YAML is easier to write by hand and allows comments. But Python's usual YAML reader,
PyYAML, reads YAML 1.1, so it reads `2026-10-09` as a date and `yes` as a boolean, and the suite is full of such values on
purpose. Exact numbers are also harder to get from YAML readers than from JSON ones, and §19.1 already says the expected
outputs are JSON. A case's `description` does the work of a comment.

**Typed values, as in toml-test, were rejected.** Writing every expected value as `{"type": ..., "value": "<text>"}` would
spare runners the reading of number text. It would also make every expected value view unreadable and unlike the value views
the spec shows, while reading each number's text is a small requirement.

---

## Operations

The operations are the contract between the suite and a runner. Each one says what the runner asks of its library, which
inputs it takes, and the shape its result is mapped to before comparison. One shape recurs.

A **target** is `{"path": <store path>, "at": <exact path>, "address": <canonical address>}`:

- `at` is an RFC 6901 JSON Pointer over the record's value view, written raw rather than percent-encoded, and `""` for the
  root.
- `address` is the node's canonical address (§7.5) as a fragment with its `#`, such as `"#done"`. For the root it is `""`,
  read from §7.1 and §7.5 as the shortest form ([open question 1](#open-questions)).
- A block anchor's target adds `"range": [start, end]`, zero-based UTF-8 byte offsets into the `$body` that `at` names, with the
  end exclusive (§5.9, decision C10).
- A target that is an asset or a directory has `path` only.

| Operation | Profiles | Spec | Input | Result |
|---|---|---|---|---|
| `parse` | `read` | §4, §5 | `store`, `record` | the value view |
| `meta` | `read` | §5.5, §5.10 | `store`, `record` | each section's computed fields `@key` and `@address` |
| `source_map` | `read` | §5.9 | `store`, `record` | a byte range per node |
| `anchors` | `read` | §6 | `store`, `record` | the record's anchors and tags |
| `resolve` | `read`, or more | §7 | `store`, `address`, `as` | the targets |
| `check` | `validate` | §5.7, §9 | `store`, optional `records` | none, the issues being the outcome |
| `refs` | `validate` | §8 | `store`, optional `record` | the references |
| `query` | `query` | §10 | `store`, `query`, parameters | the matches |
| `round_trip` | `write` | §5.8 | `value`, `format` | none |
| `compare` | none | §5.8 | `a`, `b`, optional `unordered` | a boolean |
| `serialize`, `edit` | `write` | §5.8, §13 | reserved for I4 | bytes |

Every operation that takes `store` also takes `config` ([Inputs](#configuration-override)).

**Which issues an operation reports.** `check` reports every issue for the store, or for the records listed in `records`, at
every severity. Every other operation reports only the issues that make it fail, so when it succeeds its issues are empty, and
warnings and validation errors are tested through `check`. A `parse` case about one construct then does not have to list every
warning its record also raises. Both `parse` and `check` report every error they can find, not only the first (decision C2).

**Failing is not crashing.** An operation fails when the implementation reports failure through its normal error channel with
issues, as an error result or as the error type its API documents. Anything else is a crash, such as an unexpected exception,
a panic, or a hang that the runner stops after a time of its choosing. A crash is a `fail` verdict even when the case expects
`fails`.

`outline` and `get`, which the Read profile also requires (§19.2), have no operation yet. §19.1 does not list them, and the
source form of `get` depends on the spans that the Markdown parser task fixes (I1.4, #13; decision C11).

### parse

The result is the record's value view (§5.1). It holds stored data only, so it has no `$key` members, and section keys are
tested through `meta` (decision F9). The operation fails when the record has a structural error (§9.2, decision F1), and its
issues are those errors, the codes whose class is structural in the proposal's Appendix D. Validation errors and warnings leave
the record readable, and `parse` then succeeds. An implementation reports every structural error it can find, so a failing case
may expect several.

**A rule for case authors.** An input with a syntax error holds that one error and no other, and its case expects only it. A
syntax error can hide what follows it, so an implementation that stops there and one that recovers would otherwise report
different sets.

### source_map

The result is an object whose member names are exact paths of nodes in the value view, and whose values are `[start, end]`,
zero-based UTF-8 byte offsets into the file with the end exclusive (§5.9, decision C10). Lines and columns follow from the
offsets and the file, so they are not compared. Which nodes have an entry and which bytes each one covers is fixed by the Markdown
parser task (I1.4, #13; decision C11), and `source_map` cases wait for it. Source maps are an option of the Read profile that an
implementation declares (§19.2), so an implementation without them skips these cases by declaration.

### meta

The result is two computed fields (§5.10) of each section of the record, in a fixed shape. It is an object whose member names are
the exact paths of the record's sections, the root's being `""`, and whose values are `{"@key": ..., "@address": ...}`. `@key` is
the section key (§5.5), and `null` for the root, and `@address` is the canonical address, as in a target. The `null` is this
operation's fixed shape; in a read that requests `@key`, the root has no `@key` at all. The other computed fields are left out.
Anchors have their own operation, source locations wait for the spans of I1.4, node versions belong to the cases of the Write
profile, and issues are tested through `check`.

### anchors

The result is `{"anchors": [...], "tags": [...]}`, both compared unordered:

- Each item of `anchors` is `{"name": ..., "kind": "explicit" | "derived" | "block", "at": ...}`, with `"range"` for a block
  anchor as in a target. `explicit` is an anchor written on a heading or an object (§6.2), `derived` a heading's derived anchor
  by vmd's rule, with its repeat suffix (§6.3), and `block` an anchor on a paragraph or list item (§6.2). A heading whose slug is
  empty has no `derived` item (decision C14).
- Each item of `tags` is `{"tag": ..., "at": ...}`, one per tag and node.

A list rather than an object keyed by name, so that it can hold an explicit and a derived anchor of the same name on one node,
as `## Done<a id="done"></a>` has, and the duplicates that `lenient` mode allows. Explicit and derived anchors share one
namespace (§6.1, decision C16), so an anchor that names two different nodes is also a `duplicate-anchor` issue, which `check`
reports. The record is implied, so the items have no `path`.

### resolve

`address` is a record path with an optional fragment, as the API takes it (§7.1), with characters outside `step`
percent-encoded. `as` says how the address is used, since being singular is a property of the use and not of the text (§7.4,
§8.2):

- With **`"as": "singular"`**, as for a reference or a write target, the result is a list of exactly one target. The operation
  fails when the address is malformed, when its record does not exist, when the checker cannot prove it singular before
  evaluating (§7.4), when no node matches, and when more than one node matches (§7.3, §7.4).
- With **`"as": "selector"`**, as for a query or a reference declared `cardinality: many`, the result is the list of every
  matching target, compared unordered. The operation fails when the address is malformed or its record does not exist. A
  selector that matches nothing gives an empty list (§7.4, decision C19).

A singular address can fail as ambiguous only at evaluation in two cases, which §7.4 names (decision C18), so a case for either
expects `address-ambiguous` from `resolve`, not `address-not-singular`.

A case that needs a schema to resolve, through a keyed list (§5.6) for example, lists `validate` among its profiles.

**A separate `canonical_address` operation was rejected.** Every target carries its canonical address instead, so each resolve
case checks it too, and one operation fewer is to be implemented.

### check

`records` optionally limits the check to some records of the store. There is no result. The issues are every issue the
implementation reports for the store or for those records, structural and validation alike (§9.2, decisions C2 and F1).

### refs

`record` optionally limits the result to references made from that record. The result is an array, compared unordered, of
objects with these members:

- **`from`** locates the reference as `{"path": ..., "at": ...}`. For a `$ref` object or a typed string, `at` is that node.
  For a Markdown link it is the `$body` or `$title` that holds the link, in any format (§8.1, decision C21), and `offset` gives
  the link's position in that string, in UTF-8 bytes (§5.9, decision C10).
- **`raw`** is the reference's target as written in the record.
- **`status`** is `ok`, `dangling`, `ambiguous` or `aliased` (§8.5). Reading aliases belongs to the Validate profile (§13.6,
  decision C22), so `aliased` cases need no more than `validate`.
- **`targets`** is the list of resolved targets, compared unordered. A dangling reference has an empty list, and so does a
  reference declared `cardinality: many` whose selector matches nothing, which is valid with the status `ok` (§8.5).

Links that leave the store are not listed (§8.2).

### query

`query` is the VQL text. The parameters of §10.5 are given by their names, as `target`, `fields`, `sort`, `limit` and
`per_record`. `fields` is a list of projection paths. `sort` is a list of `{"field": ..., "order": "asc" | "desc"}`, with
`asc` as the default order.

The result is `{"matches": [...], "more": true | false}`:

- Each match is a target. It also has `fields` when the case gives `fields`, an object from each projection path to its value.
  Matches are compared in order, since the sort order is specified (§10.5). Ties are ordered by store path as exact UTF-8 bytes,
  then by document order within a record (decisions C25 and F10).
- `more` says whether the implementation returned a next cursor.

The other members of a result in §10.5 are left out. Titles and sizes are tested by other operations, token counts and
excerpts are approximate by definition, cursors are opaque, and what matched may be added by the VQL fixtures. Totals, the
default projection and paging past the first page are settled by the VQL fixtures (#34), with the questions of
[open question 2](#open-questions), in a revision of the case format if they need one.

### round_trip

`value` is a JSON value in the case file, and `format` is `md`, `yaml` or `json`. The cases need the Write profile, since the
canonical serializer arrives with I4, and they are examples, while each implementation tests the round trip as a property in its
own tests (§5.8, decision C24). The runner has its implementation serialize the value to the format and parse the bytes back, then
compares the value view it gets with `value`. A value holds stored data only, so a `$key` member in it is an error like any
misplaced `$` member (§5.4, decision F9). There is no result to expect. The operation succeeds when the two are equal, and a
difference is a `fail`. The operation fails when the serializer rejects the value as not representable (§5.8), and its issue is
then `not-representable`, with `path` null and the offending node in `at`.

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
- Numbers are equal when they are the same double, since a number means its nearest double (§4.2, decision F2). So `1`, `1.0`,
  `10e-1` and `1E0` are one number, `0.1` and `0.10000000000000001` are one number, and `-0` equals `0`, while `0.1` and
  `0.10000000000000002` differ. A runner compares the doubles, never the decimal text.
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
- **`severity`** is `error` or `warning` (decision C1). A case expects the default severity that the proposal's Appendix D gives,
  under the store's uniqueness mode, unless the store's configuration sets the code's severity (`issues`, §9.1).
- **`path`** is the store path of the record the issue is about. It is `null` for an issue that belongs to no record, such as
  a query that does not parse or a value given to the serializer.
- **`at`** is the exact path of the node the issue is about, which Appendix D names for each code, or `null` when there is none,
  as for a syntax error that leaves no value view. For a reference in prose, `at` is the `$body` or `$title` that holds it, as
  §12.3's example locates `ref-ambiguous` in `#what-was-done/$body`.

For example, a YAML record `aliases.yaml` holding the two lines `a: &x 1` and `b: *x`, an anchor and an alias, each of which
is a structural error:

```json
"expect": {
  "fails": true,
  "issues": [
    { "code": "yaml-alias", "severity": "error", "path": "aliases.yaml", "at": "/a" },
    { "code": "yaml-alias", "severity": "error", "path": "aliases.yaml", "at": "/b" }
  ]
}
```

The reported issues are mapped to these four members and compared with the expected ones as an unordered list. Every expected
issue must be reported, and every reported issue must be expected. Messages, hints, candidates, semantic paths, offsets and
`line:col` are not compared. Messages and hints are prose that is improved over time. Decision C10 fixed the units of positions
(UTF-8 byte offsets, lines from 1, columns in code points, §5.9), so a later case format may compare them.

These four are the stable part of what §12.3 and the `issues` table of §14.2 give each issue. Severity is needed because the
same duplicate is an error in strict mode and a warning in lenient mode (§5.7). The location is needed so that an error found
at the wrong node does not pass.

**Codes.** The codes are those of the proposal's Appendix D, which gives each one's severity, its class (structural,
validation or operation) and the node it is attached to (decision C1). The vocabulary belongs to the spec, since the CLI and the
index print the same codes. A fixture task that needs a code the appendix lacks proposes it in its pull request, and the next
round of decisions adopts it into the appendix.

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
  "suite": { "version": "0.4.0-dev", "case_format": 1, "commit": "1ec3cc2" },
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
and are always selected. They exist because the likeliest runner bugs make every case pass, or fail, without complaint. A
comparison that compares the decimal text of numbers rather than their doubles, that tells `-0` from `0`, that lets `true` equal
`1`, that ignores a member whose value is `null`, or that compares unordered lists as sets gives wrong verdicts. Each self-test
case pairs two values that one specific wrong comparison would misjudge.

---

## Versioning

`suite.json` holds two members:

```json
{ "version": "0.4.0-dev", "case_format": 1 }
```

- **`version`** is `<spec version>.<release>` for a release of the suite. Its first two parts are the version of the proposal
  the suite tests (Draft v0.4 gives `0.4`), and the release counts the suite's releases under that version, from 0. The spec's
  minor version rises with each round of decisions applied to it (decision C27), so a suite release always names one state of
  the rules, and `version` moves to the new spec version, as `0.4.0-dev`, in the change that applies a round. A release
  is cut when the project owner asks, at the end of a phase for example. It sets `version`, and tags the commit
  `conformance-<version>`. Right after a release, `version` becomes the next release with `-dev` appended, so a checkout
  between releases never claims to be one. Ordinary changes to cases and inputs leave `suite.json` alone, so that parallel
  fixture pull requests do not conflict on it. A report carries the version, and a runner adds the commit when it can, so a
  result says which suite produced it, also in a copy of the suite outside this repository.
- **`case_format`** is the version of the format this README defines. It increases only when a runner must change to read the
  suite correctly, through a new member it has to understand or a changed meaning. A runner refuses a case format it does not
  know rather than misread it. A new operation does not change the case format, since a runner that lacks it reports its cases
  as `error` until it implements them or skips them by declaration. The phase I0 decisions changed the meaning of numbers in case
  files (decision F2) and the `parse` result (decision F9), which would raise the case format, but it stays 1 as an exception,
  because no runner had been released.
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
  numbers as doubles, types, missing members, Unicode normalization and unordered multisets.
- **`cases/markdown/line-endings.cases.json`** shows byte-exact inputs. The example of §5.3, once with LF and a final newline
  and once with CRLF and none, gives the value view §5.3 shows, which holds no `$key` (decision F9). The value view reads CRLF as
  `\n` (§5.1, decision C9); the sample's bodies are single lines, so multi-line bodies are left to the Markdown fixtures (#6). The
  store sits next to its case file, with its versions manifest.
- **`cases/addresses/appendix-a.cases.json`** applies `resolve` to the ticket of Appendix A, with the results of its address
  table. It covers every row of the table but the last, which is a VQL query. One case is a section reached by a key and a
  derived anchor that are the same node, which must not be ambiguous (§7.3). Another reaches the second section by its derived
  anchor, `what-was-done`, which the space before its `<a>` element does not change (§6.3, decision C13).
- **`cases/serializer/large-numbers.cases.json`** round-trips 2^60, an integer-valued double beyond ±(2^53−1), through each
  format, the nearest double of `1e23`, `1.2345678901234568e20` and the largest double. A round trip checks that the written
  bytes parse back to the same value, not an error, which is what writing such numbers as integers would give (§4.2, decision
  G1). It does not check which form the writer chose; that is left to the `serialize` cases of I4, which compare bytes. These
  cases need the Write profile and wait for the serializer of I4.
- **`cases/values/numbers.cases.json`** parses five YAML records with the Read profile (decision G1). `1152921504606847000`,
  `-9007199254740993` and the hexadecimal `0x20000000000001` are integers by form that a double cannot hold, so each fails with
  `number-not-representable`, while `1e23` and `9007199254740993.0` are not integers by form and give their nearest doubles.
  The value fixtures (I0.4, #5) extend it and add the other case files of `cases/values/`.

Only the last sample expects issues, with the codes of the proposal's Appendix D.

---

## Open questions

These are for the project owner. Where the spec is silent on something the suite needs, this README does not decide it. Each
question carries a recommendation where there is one.

The earlier version of this README asked twenty questions. The decisions of phase I0 answered all of them except the tenth
and part of the seventeenth, which remain below as questions 1 and 2. The answered ones, with the decisions that answered them:

| Earlier question | Decisions |
|---|---|
| 1. Issue codes | C1 |
| 2. When `parse` fails | C2, F1 |
| 3. When `check` fails, and complete reporting | C2, F1 |
| 4. Numbers outside the exact range | C4, C5, C6, F2 |
| 5. Source map spans | C11 |
| 6. Offsets and positions | C10 |
| 7. Line endings in the value view | C9 |
| 8. Singular addresses that fail at evaluation | C18 |
| 9. A selector that matches nothing | C19 |
| 11. Explicit and derived anchors | C12 to C16, F5 |
| 12. `$key` in round trips | F9, which took `$key` out of the value view |
| 13. Where the round-trip property test lives | C24 |
| 14. The serializer's profile | C24 |
| 15. The minimal configuration | C3 |
| 16. Cases that cannot be files | C26 |
| 17. Query details, for the order of ties and case folding | C25, F10 |
| 18. Gaps in addresses and references | C17, C20 with F7, C21, C22 |
| 19. When the spec's version changes | C27 |
| 20. Where the TypeScript runner lives | C29, L1 |

The two that remain:

1. **The canonical address of the root.** §7.5 gives none for the root. *Recommendation.* no fragment, the shortest form that
   §7.1 makes the root. The `address` of the root's target is then `""`, which the Appendix A sample assumes.
2. **Query details.** Before VQL cases can be written, three points of §10 still need an answer. They are how the default
   `fields` of the `records` target are represented, whether totals that an implementation may estimate can be compared, and how
   full text is cut into tokens. *Recommendation.* settle them in the VQL fixtures task (#34), as decision C25 assigns them, with
   additions to §10.
