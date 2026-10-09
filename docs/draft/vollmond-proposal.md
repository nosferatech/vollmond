# Vollmond MD (vmd): Records, Addresses, Queries and Storage

Status: Draft v0.3 (2026-10-09). Supersedes Draft v0.2 (commit `5998461`) and Draft v0.1 (commit `b7c8a52`). The review of v0.1 and
the decisions taken while discussing v0.2 are in [vollmond-proposal-review.md](vollmond-proposal-review.md).

Vollmond MD is a record format and an access framework over Markdown, YAML and JSON files. It is meant to be used by agents,
humans and programs alike, from a plain directory, a git repository, or a service that stores records in a database.

---

## 1. Goals and principles

### 1.1 Goals

1. **One data model, three formats.** Markdown, YAML and JSON records map to one tree, and the mapping is lossless in both
   directions (§5).
2. **Idiomatic syntax.** Every construct vmd reads is already idiomatic in its format, renders sensibly on GitHub and in common
   editors, and needs no vmd tooling to read. A plain `.md`, `.yaml` or `.json` file is a valid record.
3. **Economical access for agents.** A client can learn the shape and size of a record or a store before reading it, select one
   node, project fields, filter at the source, and page through results (§12).
4. **Stable addresses and safe refactors.** Any node can be addressed. Renaming an anchor or moving a record rewrites every
   reference to it (§13.4).
5. **Validation.** Collections bind records to JSON Schemas. Duplicate keys and unresolved references are errors in the default,
   strict mode (§5.7, §9).
6. **Backend independence.** All vmd semantics run in a client library over a small storage contract (§11). A filesystem, a git
   working copy, the GitHub API and a database service are all backends.
7. **Portability.** The data model, the query language (§10) and the published index (§14) are specified precisely enough to
   implement in any language, and a shared conformance suite (§19.1) checks implementations.
8. **Plain tools stay first-class.** Editing files with an editor, `sed` or an agent's edit tool is always allowed. vmd checks the
   result afterwards (§13.1).
9. **Extensibility.** Custom backends, custom query languages over the data model (GraphQL, for example), additional formats,
   value types, views and reference extractors plug in through defined interfaces (§18).

### 1.2 Non-goals

- High write throughput. GitHub-backed stores assume a low commit rate; a heavier workload needs a specialized backend.
- The git wire protocol. Git is the model for versions and history, not the interface (§11).
- Binary content. Non-record files can be stored, listed and linked, but vmd does not interpret them.
- References across stores, and transactions across backends. A link that leaves the store is an ordinary, untracked link (§8.2).
- Real-time collaborative editing.

### 1.3 Agent principles

These shape the CLI and API, and are normative where §12 says so:

- **Size before content.** Every listing carries sizes and approximate token counts.
- **Filter at the source.** Queries, projections and limits run in the backend or the library, never in the agent's context.
- **Bounded by default.** Every command that can return a lot has a default limit and a continuation cursor.
- **Terse by default, structured on request.** One line per item, and the record's own format for content; `--json` for the
  full form.
- **Errors say where and what to do next** (§12.3).
- **No shell traps.** CLI syntax avoids characters a shell expands inside double quotes (§12.4).

---

## 2. Terminology

- **Store**: a tree of files with a `.vmd/config.yaml` at its root.
- **Record**: a file in the store with a record extension (§3.1).
- **Asset**: any other file in the store. It can be listed, read and linked, but is not parsed.
- **Collection**: a named set of records sharing a schema and naming rules (§9.1).
- **Value view**: the JSON value of a record (§5). Schemas, queries and paths operate on it.
- **Section**: an object of the value view with the section shape (§5.2). Every record root is a section.
- **Node**: any value in the value view (a section, an object, an array, a scalar), or an anchored block of prose (§6.2).
- **Key**: what identifies a node within its parent: a member name, a section key (§5.5), a keyed-list key (§5.6), or an index.
- **Anchor**: a name that identifies one node within a whole record (§6).
- **Tag**: a name that may label several nodes (§6.4).
- **Address**: a record path with an optional fragment, resolving to one node (§7).
- **Selector**: an address or query that may resolve to several nodes (§7.4).
- **Reference**: a value in a record that contains an address (§8).
- **Version token**: a hash identifying the content of a file or a node, used for optimistic concurrency (§11.3).
- **Source map**: optional positions of nodes in a source file (§5.9).
- **Index**: derived data about records, nodes and references, rebuildable from the files at any time (§14).

---

## 3. Records and record paths

### 3.1 Record identity

A record's ID is its path relative to the store root, `/`-separated, **including the extension**:
`tickets/0171-clean-root-in-scattered-record.md`. Links use file paths with extensions, so record IDs match what links already say.
Changing a record's format is a move.

Record extensions: `.md`, `.yaml`, `.yml`, `.json`.

### 3.2 Path rules

These hold on GitHub, on macOS, Windows and Linux filesystems, and in URLs without escaping:

- Segments match `[A-Za-z0-9][A-Za-z0-9._-]*`, at most 255 bytes each. No spaces.
- Paths are NFC-normalized and at most 1024 bytes long.
- Two paths that differ only by case are an error.
- Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with any extension) and segments ending in
  `.` are an error.
- A collection may narrow these rules with a filename pattern (§9.1).

Assets outside collections get these checks as warnings only.

### 3.3 Store root and ignored paths

The store root is the directory containing `.vmd/config.yaml`. In a git repository it is usually the repository root.
`.vmd/` itself, dotfiles, and paths listed under `ignore` in the config are not records.

---

## 4. Value types

### 4.1 The core types

The value view uses the JSON data model, restricted as I-JSON (RFC 7493) restricts it:

| Type | Notes |
|---|---|
| null | |
| boolean | |
| string | valid Unicode (no unpaired surrogates); not normalized |
| number | §4.2 |
| array | ordered |
| object | string keys, unique; **member order is not significant** |

**Member order is not part of the data model.** Two objects with the same members in a different order are equal, and a backend or
query engine may return members in any order. A backend that stores the original bytes keeps the original order with them
(§13.3), but nothing may depend on it: a result served from a covering index, or from a relational store, has no original order
to return. (MongoDB's documents went the other way, and queries that could be answered from an index still fetch the document to
return its fields in their stored order.) Order that matters is expressed with arrays, which is why sections are an array (§5.2).

YAML values outside this model are errors: `.inf` and `.nan`, non-string keys, duplicate keys, anchors and aliases, merge keys
(`<<`), custom tags, and multiple documents in one file.

### 4.2 Numbers

Numbers are where common JSON parsers disagree (Appendix B): JavaScript reads every number as an IEEE 754 double and silently
rounds integers beyond 2^53; Python keeps integers exact; Go's default decoder reads every number into a float64. The rules:

- A number's **meaning** is its decimal value. `1`, `1.0` and `10e-1` are the same number. Integer-ness is a schema property
  (`type: integer`), as in JSON Schema, not a separate type.
- **Exact range.** Implementations must handle integers in ±(2^53−1) exactly, and every other number at least as an IEEE 754
  double.
- **No silent rounding.** An implementation that cannot represent a number exactly must say so when it compares, sorts or
  validates it against an exact type (§4.3), rather than proceed with a rounded value.
- **No rewriting.** A number the client did not change is never re-serialized. Edits splice only the changed span (§13.3), so
  `12345678901234567890` survives an edit elsewhere in the file, even in JavaScript.
- **Canonical form** for new values: the shortest decimal that round-trips, without a fractional part for integers, without a
  leading `+`, without leading zeros. YAML's `0o17` and `0x1F` are read as integers and written back in decimal.

### 4.3 Standard logical types

Further types are declared in the schema with JSON Schema's `format` keyword, which OpenAPI also uses (`format: int64`). They are
stored as ordinary JSON strings or numbers in every representation, with a canonical lexical form, and the schema tells
comparisons, sorting and validation how to read them. These are on by default; vmd turns `format` from an annotation into an
assertion for them.

| Type | Schema | Canonical form | Compares |
|---|---|---|---|
| date | `string`, `format: date` | RFC 3339 full-date, `2026-10-09` | chronologically (= as strings) |
| time | `string`, `format: time` | RFC 3339 full-time, `08:00:00Z`, `08:00:00+02:00` | by instant within a day |
| date-time | `string`, `format: date-time` | RFC 3339, offset required, `2026-10-09T08:00:00Z` | by instant |
| local date-time | `string`, `format: local-date-time` | `2026-10-09T08:00:00` (as TOML's local date-time) | as strings |
| duration | `string`, `format: duration` | ISO 8601, `PT10M`, `P3D` | by length; with months or years, only to equal values |
| int64 | `integer` or `string`, `format: int64` | a number within ±(2^53−1), otherwise a decimal string | exactly |
| bigint | `integer` or `string`, `format: bigint` | as int64, unbounded | exactly |
| decimal | `string`, `format: decimal` | `-?digits[.digits]`, no exponent | exactly |
| uri, uri-reference, email, uuid | as JSON Schema | as JSON Schema | as strings |

Without a schema, values are plain strings and numbers. VQL then compares strings as strings, which still orders canonical dates
and UTC date-times correctly.

The int64 rule follows Protocol Buffers' JSON mapping, which writes 64-bit integers as strings and reads either form, but writes
values within ±(2^53−1) as numbers, so that small values stay readable in YAML front matter.

### 4.4 Interoperating with YAML 1.1 readers

vmd reads YAML 1.2 with the core schema: no implicit dates, and `yes`, `no`, `on` and `off` are strings. Many tools still read YAML
1.1 (PyYAML; js-yaml's default schema; Ruby's Psych, used by Jekyll). So the serializer quotes any string a YAML 1.1 reader would
take for something else (`"2026-10-09"`, `"yes"`, `"1:30"`), and `vmd check` warns about unquoted ones in strict mode.

Further types can be added as extensions (§18).

---

## 5. The data model

### 5.1 Overview

Every record parses to a **value view**: a JSON value (§4) whose root is a section. Schemas validate the value view, queries
filter it, and paths walk it. The mapping from each format is total and lossless: the order and repeats of sections are kept, and
converting a value to any format and back yields the same value (§5.8).

### 5.2 Sections

A record and each of its sections have the same shape:

```
section = {
  "$key":      string,       computed, read-only (§5.5); not on the root
  "$title":    string,       required for a section, optional for the root
  "$anchor":   string,       optional (§6.2)
  "$tags":     [string],     optional (§6.4)
  ...fields,                 any members whose names do not begin with "$"
  "$body":     string,       optional: prose
  "$sections": [section]     optional: child sections, in order
}
```

The members above are listed in the order the serializer writes them, and the CLI prints them, when it has no other order to keep;
the order carries no meaning (§4.1). A plain string is never a section: anything that is not an
item of `$sections` is a field.

### 5.3 Markdown

CommonMark with the GitHub extensions (tables, task lists, strikethrough, autolinks). A Markdown record maps to the value view as
follows.

- **Front matter** is YAML between a `---` line at the very start of the file and the next `---` line, as Jekyll and GitHub use
  it (GitHub renders it as a table). Its members are the root's fields. JSON is valid YAML 1.2, so a JSON object between the
  delimiters also works. Other front matter forms (Hugo's `+++` TOML, a bare JSON object) are not recognized: GitHub does not
  render them, and a fenced block at the start of a file is a code block to every common renderer. The root therefore uses `---`
  and sections use fences (below); the two never compete.
- **The title heading.** When the first block after the front matter is a level-1 heading and it is the record's only level-1
  heading, it is the root's heading: its text is the root's `$title`, and its anchor and tags are the root's. Otherwise the root
  has no `$title`, and every heading is a section. Strict mode warns about several level-1 headings.
- **Sections.** Every other heading starts a section, which runs to the next heading of the same or a higher level. A section's
  parent is the nearest preceding heading of a lower level, or the root. Skipped levels are allowed.
- **A section's data block** is a fenced code block whose info string is `yaml data` or `json data`, placed immediately after the
  heading (only blank lines between). It must hold an object, its top-level keys must not begin with `$`, and its members are the
  section's fields. There is at most one. A fenced block anywhere else is prose. The first word of the info string keeps GitHub's
  syntax highlighting; the second marks the block as data rather than an example. The marker was chosen over two alternatives
  (the schema naming the sections that carry data, and the first YAML or JSON fence after a heading always being data): both
  turn ordinary examples into data, and the first makes a file's value depend on its collection.
- **The root's fields** come only from the front matter. A data block right after the title heading is an error.
- **`$body`** is the text after the heading (and the data block) up to the first child heading. Leading blank lines and trailing
  whitespace are removed. It is raw Markdown, not an AST.
- **`$title`** is the heading's inline Markdown source, trimmed, without a closing `#` sequence and without the `<a>` element
  that carries the anchor and tags.
- **Container blocks are prose.** Headings and fences inside list items, block quotes and HTML blocks are part of `$body`. A list
  item has no key, so a data block inside one would have no unambiguous place in the tree, and fenced examples inside list items
  are common. Tables, lists and similar structures inside `$body` can be exposed later as views (§18).
- **`---` inside a body is not a data delimiter.** CommonMark reads it as a thematic break, or turns the line above it into a
  setext heading. Only the front matter, at byte 0, uses `---`.

An example, and its value view:

````markdown
---
status: Open
---

# Flusher stalls under load

Seen twice on the perf box.

## What is confirmed

```yaml data
runs: [R0007, R0009]
```

The flusher waits on a barrier that never completes.
````

```json
{
  "$title": "Flusher stalls under load",
  "status": "Open",
  "$body": "Seen twice on the perf box.",
  "$sections": [
    {
      "$key": "what-is-confirmed",
      "$title": "What is confirmed",
      "runs": ["R0007", "R0009"],
      "$body": "The flusher waits on a barrier that never completes."
    }
  ]
}
```

### 5.4 JSON and YAML

A JSON or YAML record's value view is the parsed data. The section members apply to the root object and to items of `$sections`.
Anywhere else, a member whose name begins with `$` is an error, with three exceptions:

- `$anchor` and `$tags` may label any object (§6),
- `$ref` forms a reference object (§8.1),
- a member's name may begin with `$` inside a field's value when the schema allows it, since that is data and not vmd syntax.

`$key` is computed and must not be written. To set a section's key, give it an `$anchor`.

### 5.5 Section keys

A section's `$key` is its `$anchor` if it has one, and otherwise the GitHub slug of its `$title` (§6.3), without the `-1`, `-2`
suffixes GitHub adds to repeats. `$key` is present in the value view, so schemas, queries and output can use it, but it is never
stored.

### 5.6 Keyed lists

A keyed list is an array whose items are identified by a key, so that a semantic path (§7.3) can select an item by name.
`$sections` is a keyed list by definition, keyed by `$key`. Any other array becomes one when its schema declares it with
`x-vmd-list` (§9.3), modeled on Kubernetes' `x-kubernetes-list-type: map` and `x-kubernetes-list-map-keys`:

```yaml
benchmarks:
  type: array
  x-vmd-list: { type: map, keys: [name] }
```

With that schema, `#benchmarks/append-4k/p99_us` selects the `p99_us` field of the item whose `name` is `append-4k`. Without a
schema, data items are reachable by their `$anchor` and by exact paths. Resolution therefore depends on the schema, which is
accepted: queries and validation depend on it anyway, exact paths never do, and the index records every reference's resolved
exact path, so `vmd check` reports a reference whose target moved after a schema change.

### 5.7 Uniqueness

- **One namespace per level.** In a section, field names and child section keys share one namespace. A front-matter `status` and
  a `## Status` section are therefore duplicates, just as two `## Notes` sections are. In a keyed list, the item keys form the
  namespace.
- **Declared per list.** `x-vmd-list: {type: map}` requires unique keys; `type: multimap` allows repeats. The same keyword on
  `$sections` declares whether a record's sections may repeat.
- **A store default** covers every level a schema does not declare. It is `strict` unless `.vmd/config.yaml` says otherwise:
  - `strict`: duplicates are validation errors, so every semantic step is unique by construction.
  - `lenient`: duplicates are warnings. A singular address that hits a duplicate fails as `ambiguous` where it is used, and a
    selector takes all matches.
- **No "first occurrence wins".** A reference that silently retargets when someone inserts an earlier duplicate is the failure
  strict mode exists to prevent. GitHub's derived anchors (`#notes`, then `#notes-1`) are unique by construction and still apply
  (§6.3). Escape hatches for ingesting data that cannot be cleaned up may be added later; they are not normal operation.

### 5.8 Round trips and representability

- **Markdown to the value view is total and lossless**: every Markdown record has a value view, and it keeps the order and
  repeats of sections, which are array items. The order of front matter and data block members is presentation (§4.1).
- **The value view to Markdown** is total for every value that meets these conditions; the serializer rejects any other value
  with an error naming the path:
  - every item of `$sections` is an object with a non-empty, single-line `$title`;
  - a `$body` has no leading blank lines, no trailing whitespace, no line that would parse as a heading outside a container
    block, and does not begin with a `yaml data` or `json data` fence;
  - sections nest no deeper than heading level 6 allows (five levels below a root title, six without one);
  - the root has `$anchor` or `$tags` only if it has a `$title`.
- **Every value converts to JSON and YAML.**
- **The guarantee**: for every representable value `v` and every format `f`, `parse(serialize(v, f)) == v`, where `==` is JSON
  value equality: numbers by value (§4.2), arrays in order, objects regardless of member order. The conformance suite tests it as
  a property.
- **Byte fidelity comes from editing, not from conversion.** Edits splice the source of the changed node and leave every other
  byte alone (§13.3). A conversion between formats keeps the value but not presentation: blank lines, YAML comments, quoting
  style, link reference definitions.

### 5.9 Source maps

A node's identity is its path. Positions in a source file are not part of the data model. They are an optional **source map** that
file-based parsers produce, giving each node its byte range and line and column. The library uses the source map to:

- splice edits without reformatting the rest of the file (§13.3),
- report `line:col` in errors (§12.3),
- print a node's exact source (§5.10),
- locate references inside prose. A link inside `$body` is not a node; its position is (the node's path, an offset into its
  `$body`), which a backend without files can use too.

A backend that does not store files produces the source view by serializing, and reports errors by path alone. Byte and line
ranges of whole files remain part of the storage contract (`read`, §11.2).

### 5.10 Reading a node

An address picks a node, and the reader picks the form:

| Form | Returns | For a Markdown section |
|---|---|---|
| source (CLI default) | the node in its record's format: its source span, or its serialization | the heading line and everything under it |
| value (`--value`, `--json`) | the node's value view as JSON | the section object |
| body (`--body`) | `$body` only | the prose |
| outline (`outline`) | the subtree's keys, titles and sizes, without content | |

The CLI defaults to source because a Markdown section is shortest, and easiest to read, as Markdown; JSON would escape every
newline. Programs default to the value.

---

## 6. Anchors and tags

### 6.1 Purpose

An **anchor** names one node, independent of where it sits, and is unique within its record. References should use anchors to be
stable. A **tag** labels any number of nodes, for selection. The two follow HTML's `id` (unique, `#id` selects one element) and
`class` (repeatable, `.class` selects a set).

### 6.2 Explicit anchors and tags

| Where | Syntax | Labels |
|---|---|---|
| Markdown heading | `## What was done <a id="done" class="decision review"></a>` | the section (or the root, on the title heading) |
| Markdown block | `- <a id="room"></a>**Room.** ...`, at the start of a paragraph or list item | the block |
| JSON / YAML object | `"$anchor": "done"`, `"$tags": ["decision", "review"]` | the object |

- An anchor name matches `[A-Za-z][A-Za-z0-9_-]*`; so does a tag.
- In Markdown, the `<a>` element goes at the end of the heading; the parser accepts it anywhere in the heading line. It has no
  content and no attributes besides `id` and `class`. GitHub keeps `id` working as a link target; other renderers treat it as
  plain HTML.
- Tags are written as HTML's `class` in Markdown, and as `$tags` in data, where `$class` or `$type` would clash with the names
  serialization frameworks commonly use.
- A **block anchor** names a paragraph or list item inside a `$body`. It is not a member of the value view: it resolves to a range
  of the `$body` text, which `get` returns and which body edits change. A block cannot carry tags.

### 6.3 Derived anchors

Every Markdown heading also has a **derived anchor**: GitHub's heading slug. Lower-case the title; remove every character that is
not a letter, a digit, a space, `-` or `_`; replace each space with `-`. A repeated slug in the same record gets `-1`, `-2`, and
so on, in document order. vmd pins this algorithm as normative and tests it against GitHub, since GitHub does not formally
specify it.

Derived anchors make links such as `file.md#what-is-confirmed` work on GitHub and in vmd with no markup. They change when the
title changes; renaming through vmd rewrites references (§13.4), and `vmd check` detects a retitle made with plain tools (§13.5).
Strict mode warns when a reference uses a derived anchor that has suffixed repeats (`#notes` while `#notes-1` exists), since
inserting an earlier `## Notes` would retarget it.

Derived anchors exist only for Markdown headings. JSON and YAML have no headings, so their objects have only explicit anchors.

### 6.4 Tags

Tags select sets of nodes. They appear in VQL (`@tags:decision`, §10.3) and in references declared to have several targets
(`cardinality: many`, §9.3). A tag never resolves a singular address.

---

## 7. Addresses

### 7.1 Grammar

```
address   = record-ref [ "#" [ fragment ] ]      ; no fragment, or an empty one, is the root
fragment  = exact / semantic
exact     = 1*( "/" reference-token )            ; RFC 6901 JSON Pointer
semantic  = step *( "/" step )
step      = 1*( ALPHA / DIGIT / "-" / "_" / "." / "$" / pct-encoded )
```

- **record-ref** is a store path in the API and CLI (`tickets/0171-x.md`), and a URI reference inside a record (§8.2).
- **No fragment, or `#` alone**, is the record's root. Note that `#/` is not the root: as a JSON Pointer it is the member whose
  name is the empty string.
- Characters outside `step` (a space in a field name, for example) are percent-encoded, as in any URI fragment. The CLI also
  accepts them raw.

### 7.2 Exact paths

An exact path is an RFC 6901 JSON Pointer over the value view, with its standard meaning: `#/$sections/1/$body`,
`#/benchmarks/0/p99_us`. It reaches every node, needs no schema, and always resolves to at most one node. It is unstable: inserting
an earlier section changes the index. Tools use exact paths internally, and the index records every reference's exact target.

### 7.3 Semantic paths

A semantic path is a sequence of keys. Each step matches, in the current node:

- in a section: a field with that name, or a child section with that `$key` (one namespace, §5.7);
- in an object: the member with that name;
- in a keyed list: the item with that key;
- in an array that is not a keyed list: the item at that decimal index.

The **first step** may also match a record-wide anchor: an explicit anchor, or a derived one (§6.3). A plain GitHub link,
`file.md#what-is-confirmed`, therefore reaches a heading at any depth. If the first step matches both a root member and the anchor
of a different node, the address is ambiguous.

| Address | Resolves to |
|---|---|
| `tickets/0171-x.md` | the record |
| `tickets/0171-x.md#status` | the `status` field |
| `tickets/0171-x.md#what-is-confirmed` | the section, by its key or its derived anchor |
| `tickets/0171-x.md#what-is-confirmed/$body` | its prose |
| `tickets/0171-x.md#done` | the node anchored `done`, at any depth |
| `docs/design/Minimal_Log.md#room` | the block anchored `room` |
| `perf/runs/R0007.yaml#benchmarks/append-4k/p99_us` | a field of a keyed-list item (§5.6) |

### 7.4 Cardinality

An address is **singular** when it must resolve to exactly one node: every reference, and the target of every write. It is valid
only if each of its steps crosses a level whose keys are unique, by declaration (`type: map`) or by the strict default. The checker
proves this from the schema before evaluating anything.

A **selector** may resolve to several nodes: a semantic path through a `multimap` level, a tag, or a query. Selectors are used by
queries and by references declared `cardinality: many`, and never as write targets.

A singular address that matches more than one node fails as `ambiguous`, and the error lists each match's exact path and, for
headings, its GitHub anchor.

### 7.5 Canonical addresses

Wherever vmd prints a node (query results, `outline`, `refs`, errors), it uses the node's **canonical address**: the shortest form
that is singular and stable.

1. The node's explicit anchor, if it has one: `#done`.
2. Otherwise, a semantic path whose first step is the nearest ancestor's explicit anchor, or that starts at the root:
   `#done/notes`, `#what-is-confirmed`.
3. If that path is ambiguous (repeats allowed in `lenient` mode, §5.7): the derived anchor if it is unique (`#notes-1`), and
   otherwise the exact path.

The exact path is always available in `--json` output.

### 7.6 Shorthands (CLI only)

- `collection:key`, such as `tickets:171`, names a record by its collection key (§9.1).
- A path without its extension resolves when exactly one record matches.

Shorthands are never written into records.

---

## 8. References

### 8.1 Forms

| Context | Form | Example |
|---|---|---|
| Markdown | an inline link, or a link reference definition | `[§11.4](../design/Minimal_Log.md#tail-and-flusher)` |
| JSON / YAML | an object whose only member is `$ref` (JSON Reference) | `{"$ref": "../persons/ada.yaml#contact"}` |
| JSON / YAML, typed | a string whose schema has `format: uri-reference` and `x-vmd-ref` (§9.3) | `parent: 0158-implement-the-v3-log.md` |

A `$ref` object with other members is an error, so references are detectable without a schema. Wikilinks are not supported:
GitHub does not render them.

### 8.2 Resolving targets

The target is a URI reference, resolved by RFC 3986 against the citing record's path:

- **Relative**, `../design/x.md#a`, is relative to the citing file. It works on GitHub, in editors and on any filesystem, and is
  the recommended form.
- **Store-root**, `/docs/design/x.md#a`, is resolved against the store root. GitHub resolves it against the repository root; some
  local previewers do not.
- **Inside the store**, a target that is a record must resolve as a singular address (§7.4), unless the schema declares
  `cardinality: many`. A target that is an asset or a directory must exist.
- **Outside the store** (an absolute URL, or a relative path that climbs above the store root), a link is an ordinary link. vmd
  does not check it, rewrite it, or track it. A user who wants references tracked and kept up to date brings the collections into
  one store, preferably on one backend, since there are no transactions across backends.

### 8.3 Programmatic access

Programs use store paths, not relative paths. The library converts both ways:

- `refs` results carry both the raw text and the resolved store address, with its exact path.
- `link(from, to)` returns the relative URI reference from one record to an address, for writing into a record.
- `new` and `set` accept a store address where a reference is expected, and write it relative to the record.

### 8.4 Labels

Rewriting a reference changes only its target. The link text is kept. Label templates, which recompute a link's text from its
target (as vampiredb's section numbers are), are deferred; their syntax is open (open question 4).

### 8.5 Status

Each reference inside the store resolves to one of `ok`, `dangling` (no target), `ambiguous` (several targets for a singular
reference), or `aliased` (resolved through an alias, §13.6).

---

## 9. Collections, schemas and validation

### 9.1 Configuration

`.vmd/config.yaml`:

```yaml
vmd: 1
uniqueness: strict                           # or lenient (§5.7)
collections:
  tickets:
    match: ["tickets/*.md"]                  # globs over record paths; * is one segment, ** any depth
    exclude: ["tickets/README.md"]
    schema: ticket.schema.yaml               # in .vmd/schema/
    filename: "^[0-9]{4}-[a-z0-9-]+\\.md$"
    key: { filename: "^([0-9]{4})-" }        # or { field: status-id }; gives tickets:171
  docs:
    match: ["docs/**/*.md"]
    schema: doc.schema.yaml
    query: { target: nodes }                 # §10.4
ignore: ["drafts/**"]
```

A record belongs to at most one collection. A record in no collection is valid and unschematized; its references are still
checked.

### 9.2 Validation

The collection's schema, a JSON Schema 2020-12 document in JSON or YAML, validates the record's value view, including the
computed `$key` members. Because schemas see values, not syntax, one schema covers a Markdown ticket and a YAML ticket with the same
content.

`vmd check` reports, per record:

- parse errors, and values outside the data model (§4.1),
- schema violations, including the logical types of §4.3,
- path and filename rule violations,
- duplicate keys (§5.7) and duplicate anchors,
- references that are dangling or ambiguous, or that point where the schema does not allow,
- values the Markdown serializer could not represent (§5.8), where the record is Markdown.

### 9.3 Extension keywords

| Keyword | Where | Meaning |
|---|---|---|
| `x-vmd-list` | an array | a keyed list (§5.6, below) |
| `x-vmd-ref` | a `$ref` object, or a `uri-reference` string | `{"targets": ["tickets", "docs/**"], "cardinality": "one" \| "many"}`; `one` is the default |
| `x-vmd-summary` | any property | included in default listings and query results |
| `x-vmd-ordered` | an `enum` | `asc` or `desc`: the order in which the enum lists its values, for `<` and `>` in queries |

`x-vmd-list` has these members:

```yaml
x-vmd-list:
  type: map                    # map: unique keys | multimap: repeats allowed
  keys: [$key]                 # the item member(s) that form the key; $key for $sections
  required: [what-is-confirmed]
  items:                       # a schema per key value
    what-is-confirmed: { $ref: "#/$defs/prose-section" }
  additional: true             # true, false, or a schema for items with other keys
```

It compiles to standard JSON Schema 2020-12, so any validator can check it:

- **Per-key schemas**: `items: {allOf: [{if: {properties: {K: {const: k}}, required: [K]}, then: S_k}, ...]}`.
- **`required`**: one `contains` per required key, matching `K: k`.
- **Uniqueness of declared keys**: `contains` with `maxContains: 1`.
- **`additional: false`**: `items: {properties: {K: {enum: [declared keys]}}}`.

Only uniqueness across keys that `items` does not name has no standard form. That needs a custom keyword, about ten lines in Ajv or
in Python's `jsonschema`, comparable to `ajv-keywords`' `uniqueItemProperties`. Several key members form a composite key, which
enforces uniqueness, but a semantic path step matches a single key member.

### 9.4 Validation modes

Where validation runs is a deployment choice, not a format rule:

| Mode | Who validates | Invalid data can be stored? |
|---|---|---|
| Client | the writing client's library, before it writes | yes, by a client that skips it |
| After commit | a service checking each new commit, and reporting on it (§16.3, pattern A) | yes, and it is reported |
| Gate | a required check before merge (pattern B), a gatekeeper branch (pattern C), or the backend itself | no |

In every mode, **validation does not gate the index.** Invalid records are indexed with their issues attached, so they are
visible rather than missing (§14).

---

## 10. Query language (VQL)

### 10.1 Design

VQL is a filter language in the style of GitHub and Lucene search syntax. It has a small grammar, it evaluates over the value
view, and every backend can run it by scanning records. A backend with an index can compile it to SQL or another engine instead.
Sorting, projection and paging are parameters, not part of the language. Other query languages can be added as engines (§18.2).

### 10.2 Grammar

```
query     = or-expr
or-expr   = and-expr *( ws "OR" ws and-expr )
and-expr  = unary *( ws [ "AND" ws ] unary )         ; juxtaposition means AND
unary     = [ "-" / "NOT" ws ] primary
primary   = "(" query ")" / term
term      = field ":" [ cmp ] value / value          ; a bare value is full text
cmp       = ">=" / "<=" / ">" / "<"
value     = quoted / range / word / "*"
range     = word ".." word                            ; inclusive; either side may be "*"
field     = name *( "." name ) / exact / "@" name
name      = 1*( ALPHA / DIGIT / "-" / "_" / "$" )
exact     = 1*( "/" reference-token )                 ; a JSON Pointer
quoted    = DQUOTE *( escaped / not-dquote ) DQUOTE
word      = 1*( any character except space, parentheses, DQUOTE )   ; may end in "*" for a prefix
```

A dotted field is a semantic path (§7.3) with `.` for `/`: `benchmarks.append-4k.p99_us`.

### 10.3 Semantics

- **`field:value`** is true when the field equals the value. String comparison ignores case. When the field is an array, or a
  selector reaches several nodes, any of them may match. When the field is a section, its `$body` is compared, so `status:open`
  matches a `status` field or a `## Status` section that says "Open". `value*` matches a prefix.
- **`field:*`** is true when the field exists. `what-is-confirmed:*` means "has that section".
- **Comparisons** (`>`, `>=`, `<`, `<=`, ranges) use the field's logical type (§4.3) where the schema gives one, enum order where
  the schema gives `x-vmd-ordered`, numbers numerically, and other strings lexicographically.
- **A missing field** makes a term false, so `-field:x` is true.
- **Full text** (`word`, `"phrase"`) matches case-insensitively against titles and every string in scope (§10.4). A word matches
  whole tokens; a phrase matches a substring.
- **Pseudo-fields:**
  - `@path` matches the record path against a glob; `@collection`, the collection name.
  - `@tags` matches a tag.
  - `@title` matches `$title`; `@text` limits full text to prose (`$title` and `$body`).
  - `@refs` matches nodes containing a reference that resolves to the given address.
  - `@depth` is a section's depth (0 for the root); `@issues`, the number of validation issues.

Examples:

```
status:open component:log-v3 severity:>=high
-status:closed (barrier OR fsync) @path:tickets/*
@refs:docs/design/Minimal_Log.md#room
opened:2026-10-01..* type:bug
benchmarks.p99_us:>50
```

### 10.4 Records or nodes

A query matches either records or sections:

- **`target: records`**: each record is a candidate. Full text covers the whole record.
- **`target: nodes`**: each section, and each record root, is a candidate, and a result is the section's address. Full text
  covers only the section's own `$title` and `$body`, not its subsections, so a parent does not match just because a child does.
  A field term resolves on the section first, then on each ancestor up to the root, so `component:log-v3 fsync` finds sections
  mentioning fsync in records whose root has `component: log-v3`.

The default is `records`, and a collection may change it (`query: {target: nodes}` in §9.1). For long documents, nodes are the
useful unit: a match on a 600 KB design document says little, and a match on one of its sections can be read whole.

### 10.5 Parameters

| Parameter | Meaning | Default |
|---|---|---|
| `target` | `records` or `nodes` (§10.4) | the collection's, else `records` |
| `fields` | paths to project (below) | records: the key, title and `x-vmd-summary` fields; nodes: none |
| `sort` | fields with `asc` or `desc`; ties broken by address | records by address; nodes in document order within each record |
| `limit` | results per page | 20, at most 200 |
| `per_record` | `nodes` only: matches shown per record; the rest are counted | 5 |
| `show` | `nodes` only: `excerpt`, `body` (the match's own `$body`), `source` (the whole section) or `none` | `excerpt` |
| `max_chars` | the cap per match when `show` is `body` or `source` | 1,000 |
| `cursor` | an opaque continuation token from the previous page | |

Results carry totals (records, and in `nodes` mode, matches; each exact or marked as an estimate) and the next cursor. In `nodes`
mode, each result also carries its canonical address (§7.5), its exact path, its title, its size, what matched (`title`, `body`
with a hit count, or `field`), and an excerpt of about 100 characters around the first body hit.

The core defines no relevance ranking. An engine may offer one as `sort: score`.

**Projection paths** resolve as field terms do (§10.4): in `nodes` mode, on the match first, then on its ancestors. Two context
names make the choice explicit: `@match` is the matched node and `@record` is the record's root, as in
`fields: [@match.$body, @record.status]`. They use `@`, the pseudo-field prefix, because names beginning with `$` are members of
the value view.

### 10.6 Portability

The grammar, semantics and conformance suite are the specification. A scanning interpreter is a few hundred lines in Python or
TypeScript. An optional **SQL profile** (read-only SQL over defined index views, §14.2) is allowed for index-backed
implementations, but it is not part of the core and clients must not depend on it.

---

## 11. Storage contract

### 11.1 Principle

A backend implements only the operations below. Everything else in this document (parsing, the value view, validation, queries,
references, refactors) is computed by the vmd library on top of them, on the client or in a service. A new backend therefore
needs no knowledge of Markdown or schemas.

### 11.2 Operations

| Operation | Meaning |
|---|---|
| `list(prefix, glob?, limit, cursor)` | paths with size, version and modification time |
| `stat(path)` | size, version and modification time, without content |
| `read(path, range?, at?)` | content, optionally a line or byte range, optionally at a past revision, with its version |
| `grep(pattern, glob?, mode, context, limit)` | matching lines with paths and line numbers; `mode` is `literal` or `regex` |
| `write(path, content, if_version \| if_absent)` | replace or create a file |
| `edit(path, edits[], if_version)` | exact-string replacements (§11.4) |
| `append(path, text, if_version?)` | add text at the end |
| `move(from, to, if_version)` / `delete(path, if_version)` | |
| `apply(ops[], if_head?)` | several of the above, atomically, as one new version of the store |
| `head()` | the store's current version (a commit, or a sequence number) |
| `changes(since, limit, cursor)` | paths added, modified, moved or deleted since a head, with their versions |
| `log(path?, limit, cursor)` | history entries: version, author, time, message, paths |

### 11.3 Version tokens

- A **file version** is the git blob ID of the file's content: SHA-1 over `"blob " + length + "\0" + content`. Any backend can
  compute it. It equals what `git hash-object` prints and what the GitHub API returns as a file's `sha`, so tokens mean the same
  thing locally and remotely. A SHA-256 git repository uses the SHA-256 form.
- A **node version** is a SHA-256 over the RFC 8785 (JCS) canonical JSON of the node's value, truncated to 16 hex digits.
  Editing one section does not change another section's version.
- Every write takes `if_version` (or `if_absent`). A mismatch fails with a `conflict` that carries the current version.
- `if_head` on `apply` makes the whole batch conditional on the store not having changed at all.

### 11.4 Edit and the portable regex

`edit` is the "core of sed" every backend supports. It is the primitive agents already use:

```json
{"path": "tickets/0171-x.md", "if_version": "3f2a...", "edits": [
  {"old": "status: Open", "new": "status: In progress"},
  {"old": "TODO", "new": "done", "all": true}
]}
```

Each `old` must occur exactly once in the current text, unless `all` is set. Edits apply in order, and the call is all-or-nothing.

`grep` in `regex` mode uses the **portable regex** subset that RE2, Python `re` and ECMAScript all accept: literals and escapes,
classes, `.`, anchors, groups, alternation, and greedy and lazy quantifiers, with flags `i` and `m`. Backreferences and lookaround
are excluded, so matching runs in linear time everywhere.

### 11.5 Atomicity

`apply` either takes effect completely or not at all, and produces exactly one new head:

- **Git working copy**: one commit.
- **GitHub**: one `createCommitOnBranch` call, whose required `expectedHeadOid` makes the commit conditional on the branch head.
- **Database service**: one transaction.
- **Plain filesystem**: a journal plus atomic renames. There is no history, so `log` and `at` are not available.

### 11.6 Automatic rebase

When `apply` fails only because the head moved, the library re-reads the files it touches. If every file version still matches,
it retries against the new head. If a file changed but every node an operation targets still has its old node version (§11.3),
it recomputes that file's edits and retries. Otherwise it reports the conflict. Two agents editing different sections of one
record therefore never see a conflict.

### 11.7 HTTP binding

A service backend exposes the contract over HTTP: one endpoint per operation, JSON in and out, version tokens in `ETag` and
`If-Match` where they fit, and errors as `{"error": code, "message": ..., "current_version": ...}`. The exact binding is specified
in implementation phase I6 (§21).

---

## 12. Command line

### 12.1 Commands

```
vmd ls [glob] [-n N]                          list records and assets with size, ~tokens, collection
vmd cat PATH [--lines A:B]                    raw content, optionally a range
vmd grep PATTERN [GLOB] [-F] [-C N] [-n N]    search file text
vmd outline ADDR [--depth N]                  keys, anchors, titles, sizes, refs-in counts; no content
vmd get ADDR [--value|--body] [--fields F,..] [--max-chars N]
vmd query [COLLECTION] 'VQL' [--nodes|--records] [--fields F,..] [--sort F[:desc]] [-n N] [--cursor C]
vmd refs ADDR [--to|--from] [--context N]     backlinks (default) or outgoing references
vmd schema [COLLECTION]                       fields, types, enum values, required sections, in one screen
vmd check [PATHS|--changed REV] [--fix]       validate; issues grouped and capped
vmd new PATH [--set K=V].. [--body-file F]    create a record
vmd set ADDR VALUE [--json] / vmd delete ADDR / vmd body ADDR --file F
vmd rename ADDR NEW-ANCHOR|--title TITLE      rename an anchor or retitle, and rewrite references
vmd mv PATH NEW-PATH                          move a record and rewrite references
vmd apply OPS.json                            a batch of storage or semantic operations
vmd index [--publish DIR]                     build the index, or write the portable index (§14.4)
vmd sync / vmd push                           working copy of a remote store (§15.3)
```

Global options: `--store` (a path, `github:owner/repo@branch`, an HTTP URL, or a published index URL), `--json`, `--quiet`.

### 12.2 Output

- One line per item, with sizes in bytes and approximate tokens (bytes ÷ 4, marked `~`).
- `ls` and `grep` default to 100 and 50 items, `query` to 20. When more remain, the last line says how many and gives the
  `--cursor`.
- `get` prints the node's source (§5.10) and stops at 20,000 characters unless `--max-chars` says otherwise; the cut says what
  remains and suggests `outline`.
- `--json` prints the library's result objects unchanged.
- `-l` prints only full addresses, one per line, as `grep -l` does, for piping into `vmd get` or `xargs`.

Query results in `nodes` mode are grouped by record, so a record's path is printed once. Each match is one line: its canonical
address, title, size, what matched, any `--fields` as `key=value`, and the excerpt. With `--show body` or `--show source`, the
content follows, indented and capped by `--max-chars`. `--all` lifts the per-record and size caps; paging still applies. An
example (the figures are illustrative):

```
$ vmd query docs 'fsync barrier' --nodes
docs/design/Minimal_Log.md  ~166k tok  7 sections
  #tail-and-flusher        11.4 The tail and the flusher   ~1.2k tok  body ×3  "…issues one fsync barrier per…"
  #recovery/reads          7.2 Recovery reads              ~800 tok   title
  #room                    Room                            ~90 tok    body     "…the barrier a room leaves…"
  … 4 more in this record (--per-record 10)
docs/design/Paged_Log.md  ~40k tok  2 sections
  #holds                   3 Holds                         ~800 tok   body ×1  "…before the barrier, a hold…"
  #holds/release           3.2 Release                     ~300 tok   body ×2  "…waits for the barrier that…"
9 sections in 2 records
```

An outline (the figures and anchors are illustrative):

```
$ vmd outline docs/design/Minimal_Log.md --depth 2
docs/design/Minimal_Log.md  ~166k tok  1,204 refs-in
  #overview            1 Overview                          ~2.1k tok   14 in
  #log-format          4 The log format                   ~31k tok    88 in
    #contiguous-at-rest  4.6 Contiguous at rest            ~1.9k tok   12 in
  ...
```

### 12.3 Errors and exit codes

Each issue names where it is, as precisely as the backend can: `path:line:col` where a source file exists, then the semantic path
and the exact path. Each issue gives the code, a message, and a hint; an ambiguity also lists its candidates:

```
tickets/0171-x.md:14:3 error ref-ambiguous: #notes matches 2 sections
  in   #what-was-done/$body  (exact #/$sections/1/$body)
  candidates  #/$sections/2 (line 20, GitHub #notes)
              #/$sections/4 (line 31, GitHub #notes-1)
  hint add <a id="..."></a> to one heading, or link #notes-1
```

At most 20 issues are printed by default, followed by the counts per code. Exit codes: `0` ok, `1` error, `2` usage, `3` conflict
(re-read and retry), `4` validation failed.

### 12.4 Shell safety

Addresses use `#`, `/` and, for reserved members, `$`. A shell expands `$body` inside double quotes, so the CLI offers flags in
place of the `$` members (`--body`, `--title`), and single quotes are recommended for VQL and for any address containing `$`.

### 12.5 Agent integration

vmd ships a short skill file (one screen) for coding agents, describing the commands above and when to prefer them over plain
reads. An MCP server is optional. It is worth building only for agents that have no shell, and then as four tools (`query`, `get`
with `outline`, `refs`, `apply`): every tool schema is paid for in every session.

---

## 13. Writing

### 13.1 Three ways to write

1. **Plain tools.** Edit files directly in a working copy, then run `vmd check`. This is always allowed.
2. **Semantic operations.** `set`, `insert`, `delete`, `body`, `new`, `rename` and `mv` name a node and an intended change. The
   library turns them into storage `edit`, `write` and `move` operations on the affected source.
3. **Storage operations.** `write`, `edit`, `apply`, used directly, for example by a program that generates whole files.

All three are checked by version tokens, and all three are followed by validation in whatever mode the deployment uses (§9.4).

### 13.2 Semantic operations

| Operation | Effect |
|---|---|
| `set(addr, value)` | set a field, or replace a node's value |
| `insert(parent, value, key?, before? \| after?)` | add a field, a section (into `$sections`), or an array item. For an array, `before` and `after` set the position. For a field, they are only a hint to a file-backed record's writer, since member order carries no meaning (§4.1) |
| `delete(addr)` | remove a node |
| `body(addr, text)` | replace a section's `$body` |
| `new(path, value)` | create a record. Choosing the path, and a collection key such as the next ticket number, is the client's job; `if_absent` catches a collision |
| `rename(addr, anchor \| title)` | change an anchor, or a title and so its derived anchor, and rewrite references |
| `mv(path, new_path)` | move a record and rewrite references |

Every target is a singular address (§7.4), and each operation carries the node version it was based on. `vmd apply` takes a JSON
list of them, mixed with storage operations if needed.

### 13.3 Format fidelity

These rules apply where a backend stores the original file. They keep diffs small; they do not make member order meaningful
(§4.1).

- Bytes outside an edited node's source do not change. Line endings, encoding (UTF-8) and the trailing newline are kept as found.
  New files use LF.
- YAML is written with a round-trip writer that keeps comments, key order and quoting.
- JSON keeps key order and the indentation detected in the file.
- A Markdown edit changes only the heading, data block or prose it targets. A new section is written with an ATX heading at the
  level its position requires, and its anchor and tags as an `<a>` element at the end of the heading.
- Setting a value to its current value writes nothing.

### 13.4 Reference rewriting

`rename` and `mv`:

1. resolve the target and check the new anchor, title or path against the rules,
2. find every reference to the target through the index, by its resolved exact path, whatever form the reference uses,
3. build edits: the anchor or title itself, and the target part of each reference, with the relative path recomputed for each
   citing file,
4. apply them as one `apply`,
5. re-check, and roll back the batch if any reference no longer resolves.

Link text is left alone. A move that changes a record's format (`.md` to `.yaml`) also rewrites references through derived
anchors into semantic paths, since derived anchors exist only in Markdown (§6.3).

### 13.5 Retitles and moves made with plain tools

When a heading's title changes in a plain edit, its derived anchor changes and references to it break. `vmd check` compares
against the previous index. If a section disappeared and a new one appeared at the same exact path with the same node version
apart from its title, it suggests the rename, and `vmd check --fix` applies it. A file moved with `git mv` is detected the same way,
by an unchanged file version at a new path.

### 13.6 Aliases

`.vmd/aliases.jsonl` records old record paths and anchors:

```json
{"kind": "record", "from": "tickets/0171-old-slug.md", "to": "tickets/0171-new-slug.md", "at": "2026-10-09T08:00:00Z"}
{"kind": "anchor", "record": "docs/design/Minimal_Log.md", "from": "room", "to": "room-rule", "at": "2026-10-09T08:00:00Z"}
```

`rename` and `mv` add an entry with `--keep-alias`. Aliases resolve old addresses for published URLs, the website's redirects, and
links outside the store that the owner chooses to repair. Resolution through an alias is reported as `aliased`.

---

## 14. Index

### 14.1 Principle

The index is derived. It can be rebuilt from the files at any time, and nothing in it is authoritative.

### 14.2 Contents

| Table | Columns |
|---|---|
| `records` | path, version, collection, key, title, size, ~tokens, summary fields, issue count |
| `nodes` | path, exact path, semantic path, key, anchors, tags, kind, title, depth, size, ~tokens, node version; source lines if known |
| `refs` | source path and exact path, offset in `$body` if in prose, raw text, target address, resolved exact path, status |
| `issues` | path, exact path, line and column if known, severity, code, message |

### 14.3 Local index

The local index is a cache in `.vmd/cache/`, which is never committed. Entries are keyed by file version, so an unchanged file is
never re-parsed, a checkout of an old commit reuses every entry it can, and branches share the cache. In a git working copy,
`git ls-files -s` and git's stat cache supply file versions without hashing. The storage engine is an implementation choice;
SQLite is the reference.

### 14.4 Portable index

`vmd index --publish DIR` writes the index in a form any client can read without vmd's storage engine:

```
manifest.json                    {"format": "vmd-index/1", "store": ..., "head": ..., "generated": ..., "files": {...}}
records-<hash>.jsonl             one line per record
nodes-<hash>.jsonl               one line per node
refs-<hash>.jsonl
issues-<hash>.jsonl
content/<record path>            the raw files (optional)
values/<record path>.json        the value views (optional)
```

Data files are named by content hash and never change, so they can be cached indefinitely. The manifest is written last and
switches readers to the new set atomically. A client that only needs listings reads `records-*.jsonl`; a website with a few
thousand records can load it whole and run VQL in the browser.

---

## 15. Backends

### 15.1 Local filesystem and git working copy

The default. Agents use their own tools on the files, and vmd adds outline, query, refs, check and refactors. In a git working
copy, `log`, `at` and `changes` come from git, and `apply` can commit (`--commit`) or leave the changes staged.

### 15.2 GitHub API

For programs without a clone:

- **Reads**: the trees API to list, blobs to read, and `changes` from the compare API. Compare lists at most 300 changed files per
  comparison, so beyond that the library diffs the two trees itself.
- **Writes**: GraphQL `createCommitOnBranch`, with the head read as `expectedHeadOid`.
- **Scale**: GitHub's content-creation limits (80 requests a minute and 500 an hour at the time of writing, shared with web
  actions, and subject to change) are far above the rate of ticket edits. They make GitHub unsuitable as a high-throughput
  backend.

A repository used only as a store can accept direct pushes. A repository whose branch is protected (docs next to code) takes
changes through pull requests: `apply` then targets a branch, and the backend can open the pull request.

### 15.3 Database service

A service implements §11 over its own storage, for example DynamoDB for content and versions with an append-only audit table.
Agents get a local working copy with `vmd sync`, which writes the files and records their versions in `.vmd/base`, and send
changes with `vmd push`, which turns the local diff into an `apply` with those versions. Agents therefore keep grep and their edit
tools against a store that is not git.

### 15.4 Published index (read-only)

`--store https://.../manifest.json` gives read-only access to a published index: `ls`, `get`, `outline`, `query` and `refs` work,
and writes are refused. This is the cheapest way for agents and programs to read a remote store.

---

## 16. Reference architecture: a GitHub store with a website on AWS

### 16.1 Reading: publish on push

```
git push (any client, any author)
   └─▶ GitHub push webhook ──▶ receiver (Lambda function URL)
                                  verify the signature, queue the event, answer 202
                              ──▶ SQS ──▶ worker Lambda
                                  1. ignore other branches
                                  2. changes(stored head .. pushed head) via compare
                                  3. fetch changed blobs, parse, validate (never gating)
                                  4. write new content-hashed files, then the manifest, to S3
                                  5. post the vmd/check status on the pushed commit (§16.3)
   scheduled reconciler (every few minutes) ──▶ same steps, when the stored head ≠ the branch head

website (static, S3) ──▶ manifest.json ──▶ records-*.jsonl (list, VQL filtering in the browser)
                                       └─▶ content/<path> or values/<path>.json (one record)
```

- **Every commit is indexed, whoever made it.** A direct push, a merged pull request, an API commit and a web edit all trigger
  the webhook.
- **The website never reads GitHub.** The indexer publishes content alongside the index, so reads cost only S3 requests.
- **Ordering and loss.** Webhooks can arrive late, twice or not at all. GitHub waits 10 seconds for a response, counts a slower
  one as failed, and never redelivers a failed delivery on its own; hence the receiver only queues. The worker always diffs from
  the head it last published to the head it is told about, so duplicates are harmless. The reconciler covers lost deliveries: it
  compares branch heads, and can list failed deliveries through the REST API and redeliver them.
- **Latency.** A webhook-triggered Lambda needs a few GitHub API calls and a few S3 writes, so a target of a few seconds from push
  to visible is realistic. The figures should be measured in phase I7. A GitHub Actions workflow could do the same job but adds a
  runner's start-up time.
- **Size.** At a few hundred tickets, `records-*.jsonl` is tens of kilobytes. Past several thousand records, or for full-text
  ranking, a query Lambda over a SQLite build of the same index replaces filtering in the browser.

### 16.2 Writing: creating a ticket from the website

```
browser ──▶ API Lambda (authenticated user)
              1. choose the path and key (the client's job; for tickets, the next number)
              2. serialize and validate (gate mode)
              3. createCommitOnBranch(expectedHeadOid = the head read in step 1), the file created if absent
              4. on a head mismatch: re-read, choose again, retry (bounded)
              5. return the record; the page shows it at once, and the index catches up through the webhook
```

The Lambda authenticates to GitHub as a GitHub App installed on the store repository, scoped to that repository's contents. Key
allocation stays a client concern; if the write language later gains computed values, allocation may move into it.

### 16.3 Validating without Actions runners

A GitHub Actions job running `vmd check` works, but every run waits for a runner to start, and the minutes are billed. The same
GitHub App that publishes the index can validate instead, driven by webhooks, in seconds and at negligible Lambda cost. The one
thing github.com cannot do is reject a push synchronously: pre-receive hooks exist only on GitHub Enterprise Server. Three patterns
follow from that, one per validation mode (§9.4):

**Pattern A: check after commit.** For stores that accept direct pushes. The worker of §16.1 validates every pushed commit and
posts a `vmd/check` commit status on it, success or failure with the first issues in its description and the rest in the
published index. Invalid data can land, but it shows as a red ✗ on the commit and as issues in the index, and `vmd check` before
pushing (client mode) catches most of it first. **The tickets store uses this pattern.**

**Pattern B: a required check.** For stores that change through pull requests, with or without a merge queue. The app also
subscribes to `pull_request` and `merge_group` (`checks_requested`) events, validates each head commit, and reports a check run.
A ruleset makes `vmd/check` required and can require that it come from this app, so nobody else with write access can set it.
The merge queue waits for the check on its temporary commit; set a check timeout, so that a failed Lambda fails the check rather
than stalling the queue. After the merge, pattern A's push handling publishes the index. A repository whose required checks already
include Actions jobs (vampiredb's Rust CI) does not merge faster this way, but vmd needs no runner of its own.

**Pattern C: a gatekeeper branch.** For stores that want gate mode while people and agents still use `git push`. A ruleset's
"Restrict updates" rule on the main branch lists only the vmd app in its bypass list. Clients push to `incoming/<name>`; the worker
validates the incoming commits against the main branch and, if they pass, advances it with a conditional ref update (rebasing as
in §11.6 if it moved), deletes the incoming branch, and posts a status. `vmd push` waits for that status. Writes through the vmd
API (§16.2) commit to the main branch directly. The cost is more moving parts, and conflicts that surface after the push rather
than during it.

| Pattern | Blocks invalid data? | App permissions besides the push webhook |
|---|---|---|
| A | no; reports it | statuses: write; contents: read |
| B | yes, at merge | checks: write; pull requests and merge queues: read |
| C | yes, at push | contents: write; the app in the ruleset's bypass list |

**Incremental validation.** The worker loads the index it published for the base commit from S3, fetches only the changed blobs,
and re-validates the changed records and those whose references point into them (the `refs` table, §14.2). Without a saved index,
one tarball download of the repository gives a full validation.

---

## 17. Git integration

| Path | Tracked |
|---|---|
| records and assets | yes |
| `.vmd/config.yaml`, `.vmd/schema/` | yes |
| `.vmd/aliases.jsonl` | yes |
| `.vmd/cache/`, `.vmd/base`, `.vmd/journal/` | no; add to `.gitignore` |

- **Validation on GitHub** runs in the vmd GitHub App, one of the patterns of §16.3. Elsewhere, any CI can run
  `vmd check --changed <base>`. Hooks (`pre-commit` running `vmd check --staged`) are a local convenience, not a guarantee: a clone
  does not install them, and API commits do not run them.
- **`git mv`** works. `vmd check` detects the move and suggests the reference rewrite (§13.5). `vmd mv` does both in one step.
- **Merge drivers and semantic diff** are deferred. Custom merge drivers run only in local git, never in GitHub's merge button or
  merge queue, so their value for GitHub-hosted stores is small. Until then, a conflicted record is resolved as text and re-checked.

---

## 18. Extensibility

### 18.1 Principle

The data model (§4–§7) is the contract between extensions. An extension reads and produces value views, addresses and version
tokens; it does not depend on the CLI, on VQL, or on a backend's storage. Every extension may read freely, and every write goes
through `apply`, so version tokens and validation hold whichever extension made the change.

### 18.2 Extension points

| Point | Interface | Examples |
|---|---|---|
| Backend | the storage contract (§11) | a database service, S3, a different forge |
| Query engine | `compile(query, schemas) → plan`; `execute(plan, snapshot) → results`. The snapshot gives value views and the index; results are addresses with projected values and a cursor | GraphQL, SQL over the index, JSONPath (RFC 9535) |
| Format | `parse(bytes) → value view + source map`; `serialize(value) → bytes`; `edit(bytes, source map, operation) → bytes` | TOML, CSV |
| Logical type | a name, a lexical grammar, a canonical form, a comparator, a validator | `money`, `semver` |
| View | a read-only projection of `$body` content, addressable under its section | GFM tables as rows, task lists as items |
| Reference extractor | a glob and a pattern that find references in non-record files | doc citations in code comments |
| Schema keyword | a compile step to standard JSON Schema, or a custom validator | |

### 18.3 Example: GraphQL

A GraphQL engine generates its GraphQL schema from the collections' JSON Schemas: one object type per collection, fields from
properties, a `sections` field typed from `x-vmd-list` items, and reference fields resolved to their target types through
`x-vmd-ref`. Its query results are addresses, so a client can follow them with `get`. A mutation compiles to an `apply` of semantic
operations.

---

## 19. Conformance

### 19.1 Conformance suite

A language-neutral directory of fixtures, each with inputs and expected outputs in JSON:

- records in each format with their expected value views, anchors, tags and source maps,
- values outside the data model (§4.1) and the numbers of §4.2, including integers beyond 2^53,
- addresses with their expected resolution and cardinality,
- uniqueness cases in strict and lenient modes,
- references with their expected resolution and status,
- VQL queries over fixture stores, in both targets, with their expected results,
- serializer round-trip cases, and values that are not representable,
- edit cases with expected bytes.

### 19.2 Profiles

An implementation or backend states which profiles it supports:

| Profile | Requires |
|---|---|
| **Read** | the value types, parsing all three formats, the value view, anchors and tags, addresses, `outline` and `get` |
| **Validate** | collections, schemas with the extension keywords, logical types, uniqueness, reference resolution, `check` |
| **Query** | VQL core and the parameters of §10.5 |
| **Write** | the storage contract with version tokens, semantic operations with span-preserving edits |
| **Refactor** | `rename` and `mv` with reference rewriting, and aliases |
| **Publish** | the portable index |

A backend conforms to the storage contract (§11) separately, and states whether it supports history (`log`, `at`, `changes`).

---

## 20. Open questions

1. **Relevance ranking.** The core returns matches in document order (§10.5). Whether a standard `score` sort is worth
   specifying, or is left to engines.
2. **The parser survey** behind §4.2 and Appendix B: confirm each parser's number handling, and how JavaScript implementations
   preserve large integers (source-text access in `JSON.parse` revivers, or a parser with offsets).
3. **Lists as data.** Whether a Markdown list (for example a checklist) should ever map to an array in the core. Recommended: no;
   lists become structure through views (§18.2).
4. **Label templates** (§8.4): link text derived from the target, such as section numbers. The syntax is open; deferred to I8.
5. **Escape hatches** for messy data (§5.7), such as a resolution policy for ingesting stores that cannot be cleaned up. Deferred
   until a case needs one.
6. **The browser-side index limit**: at what size the website switches from filtering in the browser to a query service (§16.1).

---

## 21. Implementation plan

The implementation is in **TypeScript**: one codebase for the CLI (Node), the Lambda functions and the browser. Python consumers use
`vmd --json` or the HTTP binding, and a native Python implementation of the Read and Query profiles may follow, checked by the
conformance suite. Phases I0 to I3 are planned task by task in [the implementation plan](../plan/implementation-plan.md), and
vollmond's own work is tracked in GitHub issues.

Each phase ends with its part of the conformance suite passing and a demonstration on real data.

| Phase | Builds | Done when |
|---|---|---|
| **I0** Spec and suite | this document reviewed; the parser survey (open question 2); the conformance suite's layout and first fixtures; the GitHub slug algorithm pinned with test cases | fixtures for §4–§7 exist, and the parser survey has answered open question 2 |
| **I1** Read | the value types; parsers for Markdown, YAML and JSON with source maps; the value view; anchors and tags; exact and semantic paths; the local backend's read operations; `ls`, `cat`, `grep`, `outline`, `get` | `vmd outline` and `vmd get` work on all of vampiredb's docs; Minimal_Log.md outlines in well under a second |
| **I2** Validate and refs | config and collections; schemas, `x-vmd-list` compilation, logical types; uniqueness modes; reference extraction and resolution; the local index cache; `check`, `refs`, `schema` | `vmd check` over vampiredb's docs and tickets reports every broken link that `docs.sh` reports |
| **I3** Query | the VQL parser and scanning evaluator; both targets; projection, sort, paging; full text | the queries vampiredb's `+index.md` and `index.html` answer today run as `vmd query` |
| **I4** Write | the storage write operations with version tokens on the local and git backends; semantic operations; the span-preserving writer; the canonical serializer with round-trip property tests | an agent can create and update tickets with `vmd new` / `vmd set` and with plain edits, and both pass `vmd check` |
| **I5** Refactor | `rename`, `mv`, relative-path rewriting, aliases, retitle and move detection, `check --fix` | an anchor in Minimal_Log.md is renamed with every reference rewritten, in one commit |
| **I6** Remote | the GitHub backend; the HTTP binding with an in-memory reference server; `sync` and `push`; automatic rebase | an agent without a clone edits a ticket through the GitHub backend, and two agents edit different sections of one ticket without conflict |
| **I7** Publish | the portable index; the GitHub App with its receiver, queue, worker and reconciler, publishing the index and posting pattern A statuses (§16.3); the static site with browser-side VQL; the create-ticket endpoint | a push is visible on the site, and has its `vmd/check` status, within the target latency; a ticket created on the site appears in the repository |
| **I8** Later | validation patterns B and C (§16.3); MCP server if justified; label templates; views; reference extractors; the query-engine interface with a GraphQL engine; semantic diff; merge driver; the SQL profile; a Python implementation | |

---

## 22. Rollout plan

| Step | Customer | Uses | Changes for users |
|---|---|---|---|
| **R1** | vampiredb docs, read-only | I1–I3 | agents gain `outline`, `get`, `query`, `refs`; vampiredb's existing Actions CI, which its merge queue runs anyway, runs `vmd check` next to `scripts/docs.sh`. The docs' header tables move to front matter, mechanically |
| **R2** | vampiredb docs, refactors | I4–I5 | `vmd rename` and `vmd mv` replace hand edits and `docs.sh --fix-refs`'s link checking; the rule "an anchor is never renamed" is relaxed to "renamed only through vmd" |
| **R3** | tickets, in their own repository | I2–I4 | `tickets/` moves to a separate repository with direct pushes, validated by `vmd check` before pushing, and by pattern A (§16.3) once R4 brings the GitHub App. Header tables become front matter (`Status` and its note become `status` and `status_note`). `+index.md` and `index.html` give way to `vmd query`. vampiredb's `CLAUDE.md` and `tickets/README.md` are updated. Links from tickets into vampiredb's docs leave the store, so they become ordinary GitHub URLs that vmd does not track (§8.2) |
| **R4** | tickets website | I6–I7 | the read-only site, then ticket creation |
| **R5** | Belfry | I6–I7 | Belfry becomes a vmd client. Perf runs can be published as a store (a run is a record with its measurements in front matter and its files as assets), so the same `query`, `get` and bundle download apply |

---

## Appendix A. One ticket in each format

Markdown, `tickets/0171-clean-root-in-scattered-record.md`:

````markdown
---
status: In progress
severity: High
type: Bug
component: [log-v3]
opened: "2026-10-05"
parent: 0158-implement-the-v3-log.md
---

# A crash inside a contiguous transition can leave a clean root in a scattered record

Recovery repairs the state; the refusal in `open` is not built yet.

## What is confirmed

- A contiguous transition writes the changed units and the header into one slot range.

## What was done <a id="done" class="decision"></a>

Recovery of a clean root makes the record contiguous. See
[§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest).
````

Its value view:

```json
{
  "$title": "A crash inside a contiguous transition can leave a clean root in a scattered record",
  "status": "In progress",
  "severity": "High",
  "type": "Bug",
  "component": ["log-v3"],
  "opened": "2026-10-05",
  "parent": "0158-implement-the-v3-log.md",
  "$body": "Recovery repairs the state; the refusal in `open` is not built yet.",
  "$sections": [
    {
      "$key": "what-is-confirmed",
      "$title": "What is confirmed",
      "$body": "- A contiguous transition writes the changed units and the header into one slot range."
    },
    {
      "$key": "done",
      "$title": "What was done",
      "$anchor": "done",
      "$tags": ["decision"],
      "$body": "Recovery of a clean root makes the record contiguous. See\n[§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest)."
    }
  ]
}
```

The same record as YAML, `tickets/0171-clean-root-in-scattered-record.yaml`, has the same value view (`$key` is computed, not
written):

```yaml
$title: A crash inside a contiguous transition can leave a clean root in a scattered record
status: In progress
severity: High
type: Bug
component: [log-v3]
opened: "2026-10-05"
parent: 0158-implement-the-v3-log.md
$body: Recovery repairs the state; the refusal in `open` is not built yet.
$sections:
  - $title: What is confirmed
    $body: |-
      - A contiguous transition writes the changed units and the header into one slot range.
  - $title: What was done
    $anchor: done
    $tags: [decision]
    $body: |-
      Recovery of a clean root makes the record contiguous. See
      [§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest).
```

`parent` is a typed reference within the store. The link to vampiredb's design document leaves the store (tickets live in their
own repository from R3), so it is an ordinary link.

Addresses into the Markdown form (`…` is `tickets/0171-clean-root-in-scattered-record.md`):

| Address | Resolves to |
|---|---|
| `…` or `…#` | the root |
| `…#status`, `…#/status` | `"In progress"` |
| `…#what-is-confirmed` | the first section: its key, and its derived anchor |
| `…#what-is-confirmed/$body`, `…#/$sections/0/$body` | its prose |
| `…#done` | the second section, by its explicit anchor |
| `@tags:decision` (VQL, `target: nodes`) | the second section |

The ticket collection's schema, in part:

```yaml
type: object
required: [$title, status, severity, type]
properties:
  status: { enum: [Open, In progress, Blocked, Closed] }
  severity: { enum: [Critical, High, Medium, Low, Unknown], x-vmd-ordered: desc }
  opened: { type: string, format: date }
  parent:
    type: string
    format: uri-reference
    x-vmd-ref: { targets: [tickets] }
  $sections:
    type: array
    x-vmd-list:
      type: map
      keys: [$key]
      required: [what-is-confirmed]
      items:
        what-is-confirmed: { $ref: "#/$defs/prose-section" }
      additional: true
$defs:
  prose-section:
    type: object
    required: [$title, $body]
```

`x-vmd-ordered: desc` makes `severity:>=high` match High and Critical.

---

## Appendix B. Numbers in common parsers

Preliminary, from documentation and experience; to be confirmed by the survey in I0 (open question 2).

| Parser | Integers | Beyond 2^53 | Non-integers | Exact options |
|---|---|---|---|---|
| JavaScript `JSON.parse` | IEEE 754 double | silently rounded | double | a reviver with source-text access, in engines that support it |
| Python `json` | arbitrary precision | exact | double | `parse_float=Decimal` |
| Go `encoding/json` | float64 when decoding into `interface{}` | rounded | float64 | `Decoder.UseNumber` |
| Java Jackson | `int`, `long` or `BigInteger` by size | exact | double | `USE_BIG_DECIMAL_FOR_FLOATS` |
| Rust `serde_json` | `i64` / `u64` | beyond `u64`, double | double | the `arbitrary_precision` feature |

YAML readers differ in version as well. PyYAML and Ruby's Psych read YAML 1.1 (implicit dates, `yes`/`no` booleans). js-yaml's
default schema includes timestamps; its core schema does not. `ruamel.yaml` and the JavaScript `yaml` package default to YAML 1.2.

---

## Appendix C. Prior art and libraries

Libraries to adopt (licences to be confirmed at adoption):

| Need | TypeScript | Python |
|---|---|---|
| Markdown with source offsets | `micromark` / `mdast-util-from-markdown` (MIT) | `markdown-it-py` (MIT; line maps) |
| YAML 1.2 round-trip with comments and ranges | `yaml` (ISC) | `ruamel.yaml` (MIT) |
| JSON with offsets and edits | `jsonc-parser` (MIT) | |
| JSON Schema 2020-12 with formats | Ajv with `ajv-formats` (MIT) | `jsonschema` (MIT) |
| GitHub heading slugs | `github-slugger` (ISC) | a port of the same algorithm |
| GitHub API | Octokit (MIT) | |

Precedents this design follows:

- **JSON Schema 2020-12**: plain-name anchors next to JSON Pointer fragments; `format` for logical types.
- **Kubernetes**: `x-kubernetes-list-type` and `x-kubernetes-list-map-keys` for arrays treated as keyed maps, and merge keys.
- **OpenAPI** and **JSON Type Definition** (RFC 8927): a discriminator selecting a subschema by a property's value.
- **Protocol Buffers' JSON mapping**: 64-bit integers as strings.
- **I-JSON** (RFC 7493): the interoperable subset of JSON.
- **HTML**: `id` for unique names, `class` for repeatable ones.
- **GitHub and Lucene search syntax**: `field:value` filters.

Systems to learn from rather than adopt. Each solves part of the problem with a narrower model, which would constrain the format's
growth:

- **TinaCMS** (Apache-2.0): indexes Markdown in git into a database, with a GraphQL API and commits back through GitHub.
- **Decap CMS** and **Keystatic** (MIT): edit content in git through the GitHub API.
- **Astro content collections**: front matter validated by schemas per folder.
- **Obsidian Dataview**: queries over front matter and links.
- **Dolt** (Apache-2.0): SQL tables with clone, push and merge.
- **lakeFS**: git semantics over object storage.
- **git-bug**: issues stored in git objects, synced with GitHub.
- **Fossil**: tickets and wiki inside an SQLite VCS.
