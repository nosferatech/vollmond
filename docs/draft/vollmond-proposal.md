# Vollmond MD (vmd): Records, Addresses, Queries and Storage

Status: Draft v0.2 (2026-10-09). Supersedes Draft v0.1 (commit `3cd411f`); the review and the decisions that shaped this revision
are in [vollmond-proposal-review.md](vollmond-proposal-review.md).

Vollmond MD is a record format and an access framework over Markdown, YAML and JSON files. It is meant to be used by agents,
humans and programs alike, from a plain directory, a git repository, or a service that stores records in a database.

---

## 1. Goals and principles

### 1.1 Goals

1. **One record model, three formats.** Markdown, YAML and JSON records map to one tree. Data fields and Markdown sections are
   equivalent: `name: stuff` and a section `## Name` containing `stuff` are the same node with the same value (§5).
2. **Idiomatic syntax.** Every construct vmd reads is already idiomatic in its format, renders sensibly on GitHub and in common
   editors, and needs no vmd tooling to read. A plain `.md`, `.yaml` or `.json` file is a valid record.
3. **Economical access for agents.** A client can learn the shape and size of a record or a store before reading it, select one
   node, project fields, filter server-side, and page through results (§12).
4. **Stable addresses and safe refactors.** Any node can be addressed. Renaming an anchor or moving a record rewrites every
   reference to it (§13.4).
5. **Validation.** Collections bind records to JSON Schemas. A reference that does not resolve is an error (§9).
6. **Backend independence.** All vmd semantics run in a client library over a small storage contract (§11). A filesystem, a git
   working copy, the GitHub API and a database service are all backends.
7. **Portability.** The query language (§10) and the published index (§14) are specified precisely enough to implement in any
   language, and a shared conformance suite (§18.1) checks implementations.
8. **Plain tools stay first-class.** Editing files with an editor, `sed` or an agent's edit tool is always allowed. vmd checks the
   result afterwards (§13.1).

### 1.2 Non-goals

- High write throughput. GitHub-backed stores assume a low commit rate; a heavier workload needs a specialized backend.
- The git wire protocol. Git is the model for versions and history, not the interface (§11).
- Binary content. Non-record files can be stored, listed and linked, but vmd does not interpret them.
- Real-time collaborative editing.

### 1.3 Agent principles

These shape the CLI and API and are normative where §12 says so:

- **Size before content.** Every listing carries sizes and approximate token counts.
- **Filter at the source.** Queries, projections and limits run in the backend or the library, never in the agent's context.
- **Bounded by default.** Every command that can return a lot has a default limit and a continuation cursor.
- **Terse by default, structured on request.** One line per item; `--json` for the full form.
- **Errors say what to do next.**
- **No shell traps.** CLI syntax avoids characters a shell expands inside double quotes (§12.4).

---

## 2. Terminology

- **Store**: a tree of files with a `.vmd/config.yaml` at its root.
- **Record**: a file in the store with a record extension (§3.1).
- **Asset**: any other file in the store. It can be listed, read and linked, but is not parsed.
- **Collection**: a named set of records sharing a schema and naming rules (§9.1).
- **Node**: a part of a record: the record itself, a section, a field, an array item, or an anchored block.
- **Value view**: the JSON value of a record or node (§5). Schemas, queries and pointers operate on it.
- **Anchor**: a name that identifies one node within a record (§6).
- **Address**: a record path with an optional fragment, resolving to one node (§7).
- **Reference**: a value in a record that contains an address (§8).
- **Version token**: a hash identifying the content of a file or a node, used for optimistic concurrency (§11.3).
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

## 4. Formats

### 4.1 JSON

RFC 8259 JSON. Object member order is preserved when reading and writing.

### 4.2 YAML

YAML 1.2, read with the **core schema**: no implicit dates, and `yes`/`no`/`on`/`off` are strings. A YAML record must have a single
document whose values are representable in JSON (no anchors and aliases across nodes, no custom tags, string keys only).
Comments, key order and quoting style are preserved when writing (§13.3).

### 4.3 Markdown

CommonMark with the GitHub extensions (tables, task lists, strikethrough, autolinks), plus:

- **Front matter**: YAML between a `---` line at the start of the file and the next `---` line, as Jekyll and GitHub use it.
  GitHub renders it as a table. JSON is valid YAML 1.2, so a JSON object between the delimiters also works.
- **Data blocks**: a fenced code block whose info string is `yaml data` or `json data` (§5.3). The first word keeps syntax
  highlighting on GitHub; the second marks the block as data rather than an example.
- **Anchors**: `<a id="name"></a>` (§6.2).

Only top-level blocks of the document take part in the structure. Headings and fences inside block quotes, lists or HTML blocks
are body text.

---

## 5. The record tree and the value view

### 5.1 Overview

Every record parses to a tree of nodes. Each node has:

| Property | Meaning |
|---|---|
| `key` | its member name in the parent (an object key, an array index, or a section key) |
| `anchors` | the anchors that resolve to it (§6) |
| `title` | Markdown sections only: the heading text |
| `kind` | `record`, `section`, `field`, `item` or `block` |
| `value` | its value in the value view (§5.2–§5.5) |
| `span` | its byte range in the source file |
| `version` | its node version token (§11.3) |

The **value view** is the record as JSON. It is what schemas validate, what queries filter, and what JSON Pointers walk. For a
JSON or YAML record it is simply the parsed data. For Markdown it is defined below.

### 5.2 Markdown: the record

A Markdown record's value is an object whose members are, in order:

1. The **front matter** members.
2. **`title`**: the text of the record's title heading. A heading is the title heading when it is the first block after the front
   matter, has level 1, and is the only level-1 heading in the record. A collection can rename this field or turn the rule off
   (§9.1).
3. **`$body`**: the prose between the title heading (or the start of the record) and the first section, if there is any.
4. One member per **top-level section**, keyed by the section key (§5.4). Top-level sections are the headings of the smallest
   level present after the title heading.

A key that appears twice (for example `status` in front matter and a `## Status` section) is an error.

### 5.3 Markdown: sections

A section is a heading and everything up to the next heading of the same or a higher level. Its value is built from three parts:

- its **data block**: a `yaml data` or `json data` block that is the first block after the heading. It must be an object, and its
  members become members of the section. At most one per section.
- its **prose**: the text after the heading (and the data block) up to its first subsection.
- its **subsections**: headings of a deeper level, keyed by their section keys. Skipped levels are allowed; nesting follows
  relative level.

Leading blank lines and trailing whitespace are removed from prose. Prose is raw Markdown text, not an AST.

The value is:

- **a string**, the prose, when the section has no data block, no subsections, and a plain title (§5.4);
- otherwise **an object** with, in order: `$anchor` if the heading has an explicit anchor, `$title` if the title is not plain, the
  data block's members, `$body` if there is prose, then the subsections.

Carrying the explicit anchor as `$anchor` makes the value view of a Markdown section identical to that of the equivalent YAML or
JSON object, where `$anchor` is how an anchor is written (§6.2).

This gives the equivalence goal 1 asks for. These three are the same value view, `{"status": "Open"}`:

````markdown
---
status: Open
---
````

````markdown
## Status

Open
````

````yaml
status: Open
````

### 5.4 Section keys and plain titles

- A section's **key** is its explicit anchor if the heading has one (§6.2), and otherwise the **slug** of its title (§6.3).
- **humanize(key)** replaces each `-` with a space and upper-cases the first character: `what-is-confirmed` becomes
  `What is confirmed`.
- A title is **plain** when `humanize(slug(title)) == title` and the section has no explicit anchor. A plain title is fully
  recoverable from the key, so the value view need not carry it. `## What is confirmed` and `## Status` are plain;
  `## API design`, ``## The `open` call`` and `## 11.4 The tail <a id="tail"></a>` are not.
- Two sibling sections with the same key are an error; give one an explicit anchor.
- A key made only of digits is an error. JavaScript orders integer-like object keys first, which would reorder the section.

### 5.5 Reserved members

Member names beginning with `$` are reserved for vmd. The reserved names are `$body`, `$title`, `$anchor` and `$ref`. A YAML or
JSON record may use `$body` and `$title` too; they then mean the same as in Markdown when the record is converted.

### 5.6 Reading a node: contents or the whole section

An address resolves to a node. What a read returns is chosen by the reader, not by the address:

| Form | Returns | For a Markdown section |
|---|---|---|
| value (default) | the node's value view | its contents: a string, or an object without the heading |
| `body` | the prose only | `$body`, or the string value |
| `source` | the exact bytes of the node's span | the heading line and everything under it |
| `outline` | the node's subtree as keys, titles and sizes, without values | |

So `tickets/0171-x.md#/what-is-confirmed` reads as the section's text, just as `#/status` reads as `"Open"`. The `source` form is
the one to use for showing a section, or for pasting it elsewhere.

### 5.7 Round-trip guarantees

vmd converts between formats through the value view:

- **Value round-trip (guaranteed).** For any value `v` that the serializer accepts, `parse(serialize(v, format)) == v` for every
  format. The conformance suite tests it as a property.
- **Byte fidelity (guaranteed) comes from editing, not from conversion.** Edits splice the source span of the changed node and
  leave every other byte alone (§13.3).
- **Presentation is not preserved by conversion.** A Markdown-to-YAML-to-Markdown trip keeps the value but may move a string from
  front matter into a section, or normalize blank lines. Presentation hints in the schema guide the serializer (§9.3).

A value is **section-representable** when it is a string (or an object of such strings and `$`-members) that:

- has no leading or trailing blank lines,
- contains no line that would parse as a top-level heading, and
- sits at a nesting depth that fits heading level 6.

The serializer writes other strings, and all non-string values, as front matter or a data block, so the value round-trip holds.

---

## 6. Anchors

### 6.1 Purpose

An anchor names one node, independent of where it sits in the tree. Anchors are unique within a record and resolve with the
fragment form `#name` (§7.2). They are what references should use to be stable.

### 6.2 Explicit anchors

| Format | Syntax | Anchors |
|---|---|---|
| Markdown heading | `## The tail and the flusher <a id="tail-and-flusher"></a>` | the section |
| Markdown block | `- <a id="room"></a>**Room.** ...` (at the start of a paragraph or list item) | the block (kind `block`) |
| JSON / YAML object | `"$anchor": "auth-config"` | the object |

The name matches `[A-Za-z][A-Za-z0-9_-]*`. GitHub keeps `<a id>` working as a link target, and other renderers treat it as plain
HTML.

The member name follows JSON Schema 2020-12's `$anchor`, which also defines plain-name fragments alongside JSON Pointer fragments.
Block anchors do not create members in the value view; only the anchor form of an address reaches them.

### 6.3 Derived anchors

Every Markdown heading also has a **derived anchor**: GitHub's heading slug. Lower-case the title; remove every character that is
not a letter, a digit, a space, `-` or `_`; replace each space with `-`. A repeated slug in the same record gets `-1`, `-2`, and
so on, in document order. vmd pins this algorithm as normative and tests it against GitHub, since GitHub does not formally
specify it.

Derived anchors make links such as `file.md#what-is-confirmed` work on GitHub and in vmd with no markup. They change when the
title changes; renaming through vmd rewrites references (§13.4), and `vmd check` detects a plain-edit retitle (§13.5).

---

## 7. Addresses

### 7.1 Grammar

```
address   = record-ref [ "#" fragment ]
fragment  = anchor-name / json-pointer
json-pointer = *( "/" reference-token )        ; RFC 6901, over the value view
```

- **record-ref** in the API and CLI is a store path (`tickets/0171-x.md`). Inside a record it is a URI reference (§8.1).
- **No fragment**: the whole record.
- **`#name`**: the node with that anchor. Explicit anchors win over derived ones; an anchor shared by two nodes is an error when
  it is used.
- **`#/a/b`**: a JSON Pointer over the value view. It reaches every field, section and array item, anchored or not. `~0` and `~1`
  escape `~` and `/`, as RFC 6901 specifies.

| Address | Resolves to |
|---|---|
| `tickets/0171-x.md` | the record |
| `tickets/0171-x.md#what-is-confirmed` | the section, by its derived anchor |
| `tickets/0171-x.md#/what-is-confirmed` | the same section, by pointer |
| `docs/design/Minimal_Log.md#room` | the block anchored `room` |
| `services/auth.yaml#/session/ttl` | a field |
| `services/auth.yaml#auth-config` | the object with `"$anchor": "auth-config"` |

### 7.2 Stability

Explicit anchors are stable. Derived anchors and pointers are stable while titles and structure stay the same, and vmd keeps them
current when the change goes through vmd. `vmd normalize` reports pointers into Markdown and references that use a derived anchor
when the target has an explicit one.

### 7.3 Shorthands (CLI only)

- `collection:key`, such as `tickets:171`, names a record by its collection key (§9.1).
- A path without its extension resolves when exactly one record matches.

Shorthands are never written into records.

---

## 8. References

### 8.1 Forms

| Context | Form | Example |
|---|---|---|
| Markdown | an inline link or a link reference definition | `[§11.4](../docs/design/Minimal_Log.md#tail-and-flusher)` |
| JSON / YAML | an object whose only member is `$ref` (JSON Reference) | `{"$ref": "../persons/ada.yaml#/contact"}` |
| JSON / YAML, typed | a string whose schema has `format: uri-reference` and `x-vmd-ref` (§9.3) | `parent: 0158-implement-the-v3-log.md` |

A `$ref` object with other members is an error, so references are detectable without a schema. Wikilinks are not supported:
GitHub does not render them.

### 8.2 Resolving targets

The target of a reference is a URI reference, resolved by RFC 3986 against the citing record's path:

- **Relative**: `../docs/x.md#a` is relative to the citing file. It works on GitHub, in editors and on any filesystem, and is the
  recommended form inside a store.
- **Store-root**: `/docs/x.md#a`. GitHub resolves it against the repository root; some local previewers do not.
- **External store**: an absolute URL that starts with a registered store's URL prefix (§9.1), such as
  `https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#room`. It is resolved in that store when it is
  reachable, and reported as `unverified` when it is not.
- **Other URLs** are not references and are not checked.

A target that is an asset or a directory is checked for existence only. A target that is a record must resolve to exactly one
node.

### 8.3 Programmatic access

Programs use store paths, not relative paths. The library converts both ways:

- `refs` results carry both the raw text and the resolved store address.
- `link(from, to)` returns the relative URI reference from one record to an address, for writing into a record.
- `new` and `set` accept a store address where a reference is expected, and write it relative to the record.

### 8.4 Labels

Rewriting a reference changes only the target. The link text is kept. Label templates, which recompute the text of a link from
its target (as vampiredb's section numbers are), are deferred (§19, open question 12).

### 8.5 Status

Each reference resolves to one of `ok`, `dangling` (no target), `ambiguous` (two nodes share the anchor), `unverified` (an
external store that is not reachable), or `aliased` (resolved through an alias, §13.6).

---

## 9. Collections, schemas and validation

### 9.1 Configuration

`.vmd/config.yaml`:

```yaml
vmd: 1
collections:
  tickets:
    match: ["tickets/*.md"]                  # globs over record paths; * is one segment, ** any depth
    exclude: ["tickets/README.md"]
    schema: ticket.schema.yaml               # in .vmd/schema/
    filename: "^[0-9]{4}-[a-z0-9-]+\\.md$"
    key: { filename: "^([0-9]{4})-" }        # or { field: /id }; gives tickets:171
    title: title                             # the field the title heading maps to; `none` turns the rule off
  docs:
    match: ["docs/**/*.md"]
    schema: doc.schema.yaml
stores:                                      # other stores that references may point into
  vampiredb:
    url: https://github.com/nosferatech/vampiredb/blob/main/
    backend: github:nosferatech/vampiredb@main
ignore: ["drafts/**"]
```

A record belongs to at most one collection. A record in no collection is valid and unschematized, but its references are still
checked.

### 9.2 Validation

The collection's schema, a JSON Schema 2020-12 document in JSON or YAML, validates the record's value view. Because schemas see
values, not syntax, one schema covers a Markdown ticket and a YAML ticket with the same content.

`vmd check` reports, per record:

- schema violations,
- path and filename rule violations,
- key collisions and duplicate anchors,
- dangling and ambiguous references, and references whose target the schema does not allow,
- non-representable values where the schema asks for a section (§9.3).

### 9.3 Extension keywords

| Keyword | Where | Meaning |
|---|---|---|
| `title` (standard) | any property | the heading text used when the serializer writes the property as a section |
| `x-vmd-ref` | a `$ref` object or `uri-reference` string | `{"targets": ["tickets", "docs/**"]}`: allowed target collections or globs |
| `x-vmd-form` | any property | `field`, `section` or `data`: preferred presentation in Markdown |
| `x-vmd-summary` | any property | included in default listings and query results |
| `x-vmd-ordered` | an `enum` | enum order is significant for `<` and `>` in queries (§10.3) |

### 9.4 Validation modes

Where validation runs is a deployment choice, not a format rule:

| Mode | Who validates | Invalid data can be stored? |
|---|---|---|
| Client | the writing client's library, before it writes | yes, by a client that skips it |
| CI | a job on every push | yes, and it is reported |
| Gate | the backend, or a required check on a protected branch | no |

In every mode, **validation does not gate the index.** Invalid records are indexed with their issues attached, so they are
visible rather than missing (§14).

---

## 10. Query language (VQL)

### 10.1 Design

VQL is a filter language in the style of GitHub and Lucene search syntax. It has a small grammar, it evaluates over the value
view, and every backend can run it by scanning records. A backend with an index can compile it to SQL or another engine instead.
Sorting, projection and paging are parameters, not part of the language.

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
field     = name *( "." name ) / json-pointer / "@" name
name      = 1*( ALPHA / DIGIT / "-" / "_" / "$" )
quoted    = DQUOTE *( escaped / not-dquote ) DQUOTE
word      = 1*( any character except space, parentheses, DQUOTE )   ; may end in "*" for a prefix
```

### 10.3 Semantics

- **`field:value`** is true when the field equals the value. String comparison ignores case. On an array, any element may match.
  `value*` matches a prefix.
- **`field:*`** is true when the field exists.
- **Comparisons** (`>`, `>=`, `<`, `<=`, ranges) compare numbers numerically, enum members by enum order where the schema marks
  the enum `x-vmd-ordered`, and other strings lexicographically. ISO 8601 dates therefore compare correctly as strings.
- **A missing field** makes a term false, so `-field:x` is true.
- **Full text** (`word`, `"phrase"`) matches case-insensitively against every string in the value, titles included. A word
  matches whole tokens; a phrase matches a substring.
- **Pseudo-fields:**
  - `@path` matches the record path against a glob.
  - `@collection` matches the collection name.
  - `@refs` matches records containing a reference that resolves to the given address.
  - `@issues` is the number of validation issues.
  - `@text` limits full text to prose (`$body` and section strings).

Examples:

```
status:open component:log-v3 severity:>=high
-status:closed (barrier OR fsync) @path:tickets/*
@refs:docs/design/Minimal_Log.md#room
opened:2026-10-01..* type:bug
```

### 10.4 Parameters

| Parameter | Meaning | Default |
|---|---|---|
| `target` | `records`, or `nodes` to match individual sections and return their addresses | `records` |
| `fields` | dotted paths or pointers to project | the key, title and `x-vmd-summary` fields |
| `sort` | fields with `asc` or `desc`; ties broken by path | path |
| `limit` | results per page | 20, at most 200 |
| `cursor` | an opaque continuation token from the previous page | |

Results carry a total (exact, or marked as an estimate) and the next cursor.

### 10.5 Portability

The grammar, semantics and conformance suite are the specification. A scanning interpreter is a few hundred lines in Python or
TypeScript. An optional **SQL profile** (read-only SQL over defined index views, §14.3) is allowed for index-backed
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

`edit` is the "core of sed" a non-shell backend must support. It is the primitive agents already use:

```json
{"path": "tickets/0171-x.md", "if_version": "3f2a...", "edits": [
  {"old": "| **Status** | Open |", "new": "| **Status** | In progress |"},
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
- **GitHub**: one `createCommitOnBranch` call, whose required `expectedHeadOid` makes the commit conditional on the branch head
  (§16.2).
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
in implementation phase I6 (§17).

---

## 12. Command line

### 12.1 Commands

```
vmd ls [glob] [-n N]                          list records and assets with size, ~tokens, collection
vmd cat PATH [--lines A:B]                    raw content, optionally a range
vmd grep PATTERN [GLOB] [-F] [-C N] [-n N]    search file text
vmd outline ADDR [--depth N]                  keys, anchors, titles, sizes, refs-in counts; no content
vmd get ADDR [--body|--source] [--fields F,..] [--max-chars N]
vmd query [COLLECTION] 'VQL' [--nodes] [--fields F,..] [--sort F[:desc]] [-n N] [--cursor C]
vmd refs ADDR [--to|--from] [--context N]     backlinks (default) or outgoing references
vmd schema [COLLECTION]                       fields, types, enum values, required, in one screen
vmd check [PATHS|--changed REV]               validate; issues grouped and capped
vmd new COLLECTION [--set K=V].. [--body-file F]
vmd set ADDR VALUE [--json] / vmd delete ADDR / vmd body ADDR --file F
vmd rename ADDR NEW-ANCHOR                    rename an anchor and rewrite references
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
- `get` stops at 20,000 characters unless `--max-chars` says otherwise, and the cut says what remains and suggests `outline`.
- `--json` prints the library's result objects unchanged.

Example (the figures and anchors are illustrative):

```
$ vmd outline docs/design/Minimal_Log.md --depth 2
docs/design/Minimal_Log.md  ~166k tok  1,204 refs-in
  #overview            1 Overview                          ~2.1k tok   14 in
  #log-format          4 The log format                   ~31k tok    88 in
    #contiguous-at-rest  4.6 Contiguous at rest            ~1.9k tok   12 in
  ...
```

### 12.3 Errors and exit codes

Issues are printed one per line as `path:line:col severity code: message (hint)`, at most 20 by default, followed by the counts
per code. Exit codes: `0` ok, `1` error, `2` usage, `3` conflict (re-read and retry), `4` validation failed.

### 12.4 Shell safety

Addresses use `#` and `/` but no `$` in the CLI. `--body` replaces a `$body` pointer, and `--title` a `$title` pointer. Single
quotes are recommended for VQL and for addresses that start with `#`.

### 12.5 Agent integration

vmd ships a short skill file (one screen) for coding agents, describing the commands above and when to prefer them over plain
reads. An MCP server is optional. It is worth building only for agents that have no shell, and then as four tools (`query`, `get`
with `outline`, `refs`, `apply`): every tool schema is paid for in every session.

---

## 13. Writing

### 13.1 Three ways to write

1. **Plain tools.** Edit files directly in a working copy, then run `vmd check`. This is always allowed.
2. **Semantic operations.** `set`, `delete`, `insert`, `body`, `new`, `rename` and `mv` name a node and an intended change. The
   library turns them into storage `edit`, `write` and `move` operations on the affected spans.
3. **Storage operations.** `write`, `edit`, `apply`, used directly, for example by a program that generates whole files.

All three are checked by version tokens, and all three are followed by validation in whatever mode the deployment uses (§9.4).

### 13.2 Semantic operations

| Operation | Effect |
|---|---|
| `set(addr, value)` | set a field or replace a node's value |
| `insert(parent, key, value, after?)` | add a member, section or array item |
| `delete(addr)` | remove a node |
| `body(addr, text)` | replace a section's prose |
| `new(collection, values)` | create a record, allocating its key (§16.3) and choosing a path from the filename rule |
| `rename(addr, anchor)` | change an anchor (or a section's title, which changes its derived anchor) and rewrite references |
| `mv(path, new_path)` | move a record and rewrite references |

Each carries the node version it was based on. `vmd apply` takes a JSON list of them, mixed with storage operations if needed.

### 13.3 Format fidelity

- Bytes outside an edited span do not change. Line endings, encoding (UTF-8) and the trailing newline are kept as found. New files
  use LF.
- YAML is written with a round-trip writer that keeps comments, key order and quoting.
- JSON keeps key order and the indentation detected in the file.
- A Markdown edit changes only the heading, data block or prose it targets. A new section is written with an ATX heading at the
  level its position requires.
- Setting a value to its current value writes nothing.

### 13.4 Reference rewriting

`rename` and `mv`:

1. resolve the target and check the new anchor or path against the rules,
2. find every reference to the target through the index, including references through derived anchors and pointers,
3. build edits: the anchor itself, and the target part of each reference, with the relative path recomputed for each citing file,
4. apply them as one `apply`,
5. re-check, and roll back the batch if any reference no longer resolves.

Link text is left alone. References from other stores are not rewritten; the alias (§13.6) covers them.

A move that changes a record's format (`.md` to `.yaml`) also rewrites references that use derived anchors into JSON Pointers,
since derived anchors exist only in Markdown (§6.3).

### 13.5 Retitles and moves made with plain tools

When a heading's title changes in a plain edit, its derived anchor changes and references to it break. `vmd check` compares
against the previous index. If a derived anchor disappeared and a new one appeared at the same node position with the same
content version, it suggests the rename, and `vmd check --fix` applies it. A file moved with `git mv` is detected the same way,
by an unchanged file version at a new path.

### 13.6 Aliases

`.vmd/aliases.jsonl` records old record paths and anchors:

```json
{"kind": "record", "from": "tickets/0171-old-slug.md", "to": "tickets/0171-new-slug.md", "at": "2026-10-09T08:00:00Z"}
{"kind": "anchor", "record": "docs/design/Minimal_Log.md", "from": "room", "to": "room-rule", "at": "2026-10-09T08:00:00Z"}
```

`rename` and `mv` add an entry when the target was referenced from outside the store, or when `--keep-alias` is given. Aliases
resolve old addresses for other stores, for published URLs, and for the website's redirects. Resolution through an alias is
reported as `aliased`.

---

## 14. Index

### 14.1 Principle

The index is derived. It can be rebuilt from the files at any time, and nothing in it is authoritative.

### 14.2 Contents

| Table | Columns |
|---|---|
| `records` | path, version, collection, key, title, size, ~tokens, summary fields, issue count |
| `nodes` | path, pointer, anchors, kind, title, level, span, size, ~tokens, node version |
| `refs` | source path and pointer, span, raw text, target address, resolved address, status |
| `issues` | path, line, column, severity, code, message |

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
- **Scale**: GitHub's content-creation limits (80 requests a minute and 500 an hour at the time of writing, shared
  with web actions, and subject to change) are far above the rate of ticket edits. They make GitHub unsuitable as a
  high-throughput backend.

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
   └─▶ GitHub push webhook ──▶ API Gateway ──▶ indexer Lambda
                                                 1. verify the signature; ignore other branches
                                                 2. changes(stored head .. pushed head) via compare
                                                 3. fetch changed blobs, parse, validate (never gating)
                                                 4. write new content-hashed files, then the manifest, to S3
   scheduled reconciler (every few minutes) ──▶ same steps, when the stored head ≠ the branch head

website (static, S3) ──▶ manifest.json ──▶ records-*.jsonl (list, VQL filtering in the browser)
                                       └─▶ content/<path> or values/<path>.json (one record)
```

- **Every commit is indexed, whoever made it.** A direct push, a merged pull request, an API commit and a web edit all trigger
  the webhook.
- **The website never reads GitHub.** The indexer publishes content alongside the index, so reads cost only S3 requests.
- **Ordering and loss.** Webhooks can arrive late, twice or not at all. The indexer always diffs from the head it last published
  to the head it is told about, so duplicates are harmless. The reconciler covers lost deliveries.
- **Latency.** A webhook-triggered Lambda needs a few GitHub API calls and a few S3 writes, so a target of a few seconds from push
  to visible is realistic. The figures should be measured in phase I7. A GitHub Actions workflow could do the same job but adds a
  runner's start-up time.
- **Size.** At a few hundred tickets, `records-*.jsonl` is tens of kilobytes. Past several thousand records, or for full-text
  ranking, a query Lambda over a SQLite build of the same index replaces filtering in the browser.

### 16.2 Writing: creating a ticket from the website

```
browser ──▶ API Lambda (authenticated user)
              1. vmd new tickets {...}: allocate the key, serialize, validate (gate mode)
              2. createCommitOnBranch(expectedHeadOid = head read in step 1)
              3. on a head mismatch: re-read, re-allocate, retry (bounded)
              4. return the record; the page shows it at once, and the index catches up through the webhook
```

The Lambda authenticates to GitHub as a GitHub App installed on the store repository, scoped to that repository's contents.

### 16.3 Key allocation

Sequential keys (`0194`) are allocated by reading the largest existing key. Two writers can choose the same key, and the
conditional commit is what catches it:

- **On a single-branch store with direct pushes**, the API's `expectedHeadOid` and git's own non-fast-forward rejection make the
  second writer retry with the next key. Nothing can have referenced the new record yet, so renumbering on retry is safe.
- **On branches or pull requests**, two branches can each create `0194`. `vmd check` reports the collision on merge, and
  `vmd mv` renumbers. If that happens often, random keys or keys assigned at merge are the alternatives (§19, open question 7).

---

## 17. Git integration

| Path | Tracked |
|---|---|
| records and assets | yes |
| `.vmd/config.yaml`, `.vmd/schema/` | yes |
| `.vmd/aliases.jsonl` | yes |
| `.vmd/cache/`, `.vmd/base`, `.vmd/journal/` | no; add to `.gitignore` |

- **CI** runs `vmd check --changed <base>` on pull requests and pushes. Hooks (`pre-commit` running `vmd check --staged`) are a
  local convenience, not a guarantee: a clone does not install them, and API commits do not run them.
- **`git mv`** works. `vmd check` detects the move and suggests the reference rewrite (§13.5). `vmd mv` does both in one step.
- **Merge drivers and semantic diff** are deferred. Custom merge drivers run only in local git, never in GitHub's merge button or
  merge queue, so their value for GitHub-hosted stores is small. Until then, a conflicted record is resolved as text and re-checked.

---

## 18. Conformance

### 18.1 Conformance suite

A language-neutral directory of fixtures, each with inputs and expected outputs in JSON:

- records in each format with their expected value views, node lists, anchors and spans,
- addresses with their expected resolution,
- references with their expected resolution and status,
- VQL queries over fixture stores with their expected result paths,
- serializer round-trip cases, and non-representable values,
- edit cases with expected bytes.

### 18.2 Profiles

An implementation or backend states which profiles it supports:

| Profile | Requires |
|---|---|
| **Read** | parsing all three formats, the value view, anchors, addresses, `outline` and `get` |
| **Validate** | collections, schemas, reference resolution, `check` |
| **Query** | VQL core and the parameters of §10.4 |
| **Write** | the storage contract with version tokens, semantic operations with span-preserving edits |
| **Refactor** | `rename` and `mv` with reference rewriting, and aliases |
| **Publish** | the portable index |

A backend conforms to the storage contract (§11) separately, and states whether it supports history (`log`, `at`, `changes`).

---

## 19. Open questions

Each has a recommendation; none blocks phase I0.

1. **Implementation language.** Recommended: **TypeScript** for the core library. One codebase then runs in the CLI (Node), in
   Lambda, and in the browser, where the website needs VQL, parsing for previews, and client-side validation. Python consumers use
   `vmd --json` or the HTTP binding at first. A native Python implementation of Read and Query can follow, checked by the
   conformance suite. Alternative: a Python core, with only VQL reimplemented in TypeScript for the browser.
2. **`$anchor` or `$id`** for anchors in JSON and YAML. Recommended: `$anchor`, for the JSON Schema precedent of plain-name
   fragments, and because `$id` in JSON Schema means a resource URI.
3. **How data blocks are marked.** Recommended: the `data` word in the info string. The alternative, a schema declaring which
   sections are data, keeps the Markdown cleaner but makes parsing depend on the schema.
4. **The title heading rule** (single leading H1 maps to `title`). Recommended as the default, with the collection setting to turn
   it off. The cost: a record that is one H1 and its text maps to `title` and `$body`, not to a one-member object.
5. **The prose normalization** in §5.3: leading blank lines and trailing whitespace stripped. Simple and predictable, but YAML's
   `|` (which keeps a final newline) then differs from Markdown. The serializer writes `|-` to compensate.
6. **Combining an anchor and a pointer** (`#room/field`). Not in v0.2: neither JSON Schema nor URIs define it. Revisit if agents
   ask for it.
7. **Key allocation** under concurrency (§16.3): sequential with a conditional commit, or random keys, or keys assigned at merge.
8. **Cross-store rewriting.** References from the tickets store into vampiredb's docs are absolute URLs. A rename in docs leaves
   them working only through aliases until the tickets store runs `vmd check --fix`. Is that enough, or should a docs rename open
   a change in the tickets store?
9. **Presentation defaults.** Without `x-vmd-form`, the serializer writes single-line strings as front matter and multi-line
   strings as sections. Confirm.
10. **The browser-side index limit.** At what size the website switches from filtering in the browser to a query service (§16.1).
11. **Lists as data.** Whether a Markdown list (for example a checklist) should ever map to an array. Recommended: not in v0.2; a
    list is prose.
12. **Label templates** (§8.4) for link text derived from the target, such as section numbers. Deferred to phase I8.
13. **Node-level queries** (`--nodes`). Should `@refs` and full text match per section by default for the docs collection, where
    the sections are the useful unit?

---

## 20. Implementation plan

Each phase ends with its part of the conformance suite passing and a demonstration on real data.

| Phase | Builds | Done when |
|---|---|---|
| **I0** Spec and suite | this document reviewed; the conformance suite's layout and first fixtures; the GitHub slug algorithm pinned with test cases | fixtures for §5–§7 exist and the open questions in §19 that I1 depends on (1–5) are decided |
| **I1** Read | parsers for Markdown, YAML and JSON with spans; the value view; anchors; addresses; the local backend's read operations; `ls`, `cat`, `grep`, `outline`, `get` | `vmd outline` and `vmd get` work on all of vampiredb's docs; Minimal_Log.md outlines in well under a second |
| **I2** Validate and refs | config and collections; schemas; reference extraction and resolution (relative, root, external); the local index cache; `check`, `refs`, `schema` | `vmd check` over vampiredb's docs and tickets reports every broken link that `docs.sh` reports |
| **I3** Query | the VQL parser and scanning evaluator; projection, sort, paging; full text; `--nodes` | the queries vampiredb's `+index.md` and `index.html` answer today run as `vmd query` |
| **I4** Write | the storage write operations with version tokens on the local and git backends; semantic operations; the span-preserving writer; the canonical serializer with round-trip property tests | an agent can create and update tickets with `vmd new` / `vmd set` and with plain edits, and both pass `vmd check` |
| **I5** Refactor | `rename`, `mv`, relative-path rewriting, aliases, retitle and move detection, `check --fix` | an anchor in Minimal_Log.md is renamed with every reference rewritten, in one commit |
| **I6** Remote | the GitHub backend; the HTTP binding with an in-memory reference server; `sync` and `push`; automatic rebase | an agent without a clone edits a ticket through the GitHub backend, and two agents edit different sections of one ticket without conflict |
| **I7** Publish | the portable index; the indexer Lambda and reconciler; the static site with browser-side VQL; the create-ticket endpoint | a push is visible on the site within the target latency; a ticket created on the site appears in the repository |
| **I8** Later | MCP server if justified; label templates; code-comment reference extractors; cross-store rewriting; semantic diff; merge driver; the SQL profile; a Python implementation | |

---

## 21. Rollout plan

| Step | Customer | Uses | Changes for users |
|---|---|---|---|
| **R1** | vampiredb docs, read-only | I1–I3 | agents gain `outline`, `get`, `query`, `refs`; CI runs `vmd check` next to `scripts/docs.sh`. The docs' header tables move to front matter, mechanically |
| **R2** | vampiredb docs, refactors | I4–I5 | `vmd rename` and `vmd mv` replace hand edits and `docs.sh --fix-refs`'s link checking; the rule "an anchor is never renamed" is relaxed to "renamed only through vmd" |
| **R3** | tickets, in their own repository | I2–I4 | `tickets/` moves to a separate repository with direct pushes. Header tables become front matter (`Status` and its note become `status` and `status_note`). Links into docs become GitHub URLs of the vampiredb store. `+index.md` and `index.html` give way to `vmd query`. vampiredb's `CLAUDE.md` and `tickets/README.md` are updated |
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

## What was done <a id="done"></a>

Recovery of a clean root makes the record contiguous. See
[§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest).
````

Its value view:

```json
{
  "status": "In progress",
  "severity": "High",
  "type": "Bug",
  "component": ["log-v3"],
  "opened": "2026-10-05",
  "parent": "0158-implement-the-v3-log.md",
  "title": "A crash inside a contiguous transition can leave a clean root in a scattered record",
  "$body": "Recovery repairs the state; the refusal in `open` is not built yet.",
  "what-is-confirmed": "- A contiguous transition writes the changed units and the header into one slot range.",
  "done": {
    "$anchor": "done",
    "$title": "What was done",
    "$body": "Recovery of a clean root makes the record contiguous. See\n[§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest)."
  }
}
```

The same record as YAML, `tickets/0171-clean-root-in-scattered-record.yaml`, has the same value view:

```yaml
status: In progress
severity: High
type: Bug
component: [log-v3]
opened: "2026-10-05"
parent: 0158-implement-the-v3-log.md
title: A crash inside a contiguous transition can leave a clean root in a scattered record
$body: Recovery repairs the state; the refusal in `open` is not built yet.
what-is-confirmed: |-
  - A contiguous transition writes the changed units and the header into one slot range.
done:
  $anchor: done
  $title: What was done
  $body: |-
    Recovery of a clean root makes the record contiguous. See
    [§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest).
```

`$anchor: done` in YAML and `<a id="done"></a>` in Markdown are the same fact, so `#done` resolves in both. Derived anchors exist
only for Markdown headings: `#what-is-confirmed` resolves in the Markdown form, and `#/what-is-confirmed` in both. Converting a
record's format is a move (§3.1), and the move rewrites references through derived anchors into pointers (§13.4).

Addresses into the Markdown form:

| Address | Value |
|---|---|
| `…0171-clean-root-in-scattered-record.md#/status` | `"In progress"` |
| `…#what-is-confirmed` | the string under that heading |
| `…#done` | `{"$anchor": "done", "$title": "What was done", "$body": "…"}` |
| `…#done` with `--body` | the prose only |
| `…#done` with `--source` | `## What was done <a id="done"></a>` and the text under it |

The schema fragment that makes `parent` a typed reference:

```yaml
parent:
  type: string
  format: uri-reference
  x-vmd-ref: { targets: [tickets] }
```

---

## Appendix B. Prior art and libraries

Libraries to adopt (licences to be confirmed at adoption):

| Need | TypeScript | Python |
|---|---|---|
| Markdown with source offsets | `micromark` / `mdast-util-from-markdown` (MIT) | `markdown-it-py` (MIT; line maps) |
| YAML round-trip with comments and ranges | `yaml` (ISC) | `ruamel.yaml` (MIT) |
| JSON with offsets and edits | `jsonc-parser` (MIT) | |
| JSON Schema 2020-12 | Ajv (MIT) | `jsonschema` (MIT) |
| GitHub heading slugs | `github-slugger` (ISC) | port of the same algorithm |
| GitHub API | Octokit (MIT) | |

Systems to learn from rather than adopt. Each solves part of the problem with a narrower model, which would constrain the
format's growth:

- **TinaCMS** (Apache-2.0): indexes Markdown in git into a database, with a GraphQL API and commits back through GitHub.
- **Decap CMS** and **Keystatic** (MIT): edit content in git through the GitHub API.
- **Astro content collections**: front matter validated by schemas per folder.
- **Obsidian Dataview**: queries over front matter and links.
- **Dolt** (Apache-2.0): SQL tables with clone, push and merge.
- **lakeFS**: git semantics over object storage.
- **git-bug**: issues stored in git objects, synced with GitHub.
- **Fossil**: tickets and wiki inside an SQLite VCS.
