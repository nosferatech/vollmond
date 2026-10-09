# Vollmond MD (vmd): Format, Schema, Validation, Indexing and Reference Updates

Status: Draft v0.1
Scope: a file-based record format for local working copies, optionally versioned with git.

---

## 1. Goals

1. Records may be Markdown, JSON, or YAML. The format must not force a header or metadata into the file.
2. Stable addresses are opt-in. Any part of a record can be given a stable ID and addressed by it. A plain, standard `.md`, `.json`, or `.yaml` file with no VMD markup is a valid record.
3. Renaming a stable ID updates every reference to it, in every format.
4. Records are validated against schemas bound to folders. Dangling references are errors.
5. Edits are transactional, use optimistic concurrency, and can be rebased after a conflict.
6. Diffs and merges are keyed by node identity, not by line.
7. The format degrades gracefully. A plain filesystem can read it, and git or any other versioning system can store it.

Non-goals: replacing a database, handling binary assets, or defining a query language beyond addressing and selection.

---

## 2. Terminology

- **Store**: a directory tree containing records and a `.vmd/` directory.
- **Record**: one file. Its record ID is its path relative to the store root, without extension (`persons/ada`).
- **Node**: an addressable part of a record: the record root, a section, a data block, an object with `$id`, or a field.
- **Node ID**: a stable identifier within the scope of one record. Syntax in §4.
- **Address**: a string that resolves to exactly one node (§5).
- **Reference**: a value in a record that points to an address (§6).
- **Index**: a derived, rebuildable database of records, nodes, and references (§8).
- **Alias**: a recorded mapping from an old record ID or node ID to a new one (§8.4).
- **Version token**: a content hash of a record or node. Used for optimistic concurrency (§9.3).

---

## 3. Record identity

3.1 The record ID is the path without extension. The extension determines the format. Accepted extensions: `.md`, `.json`, `.yaml`, `.yml`.

3.2 Two files with the same path stem and different extensions (`ada.md` and `ada.json`) are a validation error.

3.3 The record ID is case-sensitive in the grammar, but stores MUST reject paths that differ only by case. This protects macOS and Windows filesystems.

3.4 Record IDs MUST be Unicode NFC-normalized. Path segments match `[a-z0-9][a-z0-9._-]*` by default. A binding (§7) may relax this for legacy stores.

3.5 Files that are not records (`README.md` at the store root, assets) are ignored by VMD unless bound by a schema.

---

## 4. Node IDs and the normalized tree

### 4.1 Node ID grammar

```
node-id = [a-z0-9] *[a-z0-9._-]
```

Node IDs are unique among siblings within their record. The validator rejects duplicates in the same parent. Repeated names in different parents (`Config` under two sections) are allowed, but the IDs must differ if either needs to be referenced.

### 4.2 Where IDs come from

| Source | Syntax | Example |
|---|---|---|
| Markdown heading | Pandoc-style attribute | `## Config {#auth-config}` |
| Markdown fenced data block | Attribute after info string | ` ```yaml {#auth-config} ` |
| JSON or YAML object | `$id` member | `"$id": "auth-config"` |
| YAML or JSON top level | Not required; the record ID identifies the root | (none) |

IDs are optional. A file with no `{#...}` attributes and no `$id` members is fully valid. Nodes without IDs can be addressed only by name or index (§5.2), and such addresses are unstable. A validator warning is issued only when a reference targets a node that has no ID, so that a plain document is never flagged for simply lacking markup.

### 4.3 Normalized tree

Every record normalizes to one tree before validation, indexing, or diffing. Formats differ only in how they are parsed into this tree.

- **JSON / YAML**: the root is the document's top-level object. Objects with `$id` become addressable nodes. Arrays of objects are addressed by `$id` where present, otherwise by index.
- **Markdown**:
  - YAML front matter becomes the root's fields.
  - Each heading becomes a child node keyed by its ID (or, if it has none, excluded from ID-keyed lookup).
  - The text under a heading, up to the next heading of equal or higher level, is the node's `$body`.
  - Nested headings are child nodes.
  - A fenced YAML or JSON block with an ID becomes a child node keyed by that ID.
  - A fenced data block without an ID merges its keys into the enclosing section. Only one such block is allowed per section.

Reserved member names: any key beginning with `$` is reserved for VMD. The current reserved names are `$id`, `$body`, `$title`, and `$ref`.

### 4.4 Example

Source `persons/ada.md`:

```markdown
---
role: engineer
team: auth
---

# Ada Lovelace {#ada}

Works on [[auth-service#auth-config]].

## Contact {#contact}

```yaml
email: ada@example.com
```
```

Normalized tree:

```json
{
  "role": "engineer",
  "team": "auth",
  "ada": {
    "$id": "ada",
    "$title": "Ada Lovelace",
    "$body": "Works on [[auth-service#auth-config]].\n",
    "contact": {
      "$id": "contact",
      "$title": "Contact",
      "$body": "",
      "email": "ada@example.com"
    }
  }
}
```

Note that the top-level heading is a child, not the root. If the heading is the only top-level element, a store MAY set `root: section` in the binding to make the heading the root.

---

## 5. Addressing

### 5.1 Grammar

```
address   = [ record ] [ "#" path ]
record    = segment *( "/" segment )
segment   = 1*( ALPHA / DIGIT / "-" / "_" / "." )
path      = step *( "/" step )
step      = node-id / name-sel / index / virtual
name-sel  = "[" "name" "=" DQUOTE text DQUOTE "]"
index     = "[" 1*DIGIT "]"
virtual   = "$body" / "$title" / "$front"
```

Examples:

| Address | Meaning |
|---|---|
| `persons/ada` | the whole record |
| `persons/ada#contact` | the `contact` node |
| `persons/ada#contact/email` | a field inside it |
| `persons/ada#contact/$body` | the body text of the section |
| `#contact` | `contact` in the current record (local form, valid only inside a record) |
| `auth-service#auth-config/session_ttl` | a field inside a node in another record |
| `auth-service#[name="Auth Service"]/$body` | escape hatch: body of a heading found by name |

### 5.2 Resolution rules

1. Resolve the record. If absent, the address is dangling.
2. Start at the record root. For each step, look up the child with that key in the normalized tree.
3. `node-id` matches a child by ID. A field name also matches a child by key. A field and a node with the same key in one parent is a validation error.
4. `name-sel` matches headings by title. If more than one sibling matches, resolution fails. It never picks the first match.
5. `index` selects by position among children. It is for arrays and escape-hatch use only.
6. The resolved node must be unique. The address resolves to exactly one node or it is invalid.

### 5.3 Stability

Addresses using `node-id` are stable. Addresses using `name-sel` or `index` are not. They are permitted, but the validator reports them as unstable references, and `vmd normalize` rewrites them to ID form where an ID exists.

---

## 6. References

### 6.1 Forms

| Context | Form | Example |
|---|---|---|
| Markdown inline | Wikilink | `[[auth-service#auth-config]]` |
| Markdown, same record | Wikilink, local | `[[#contact]]` |
| JSON / YAML | Object with `$ref` | `{"$ref": "auth-service#auth-config/session_ttl"}` |
| JSON / YAML, same record | Object with `$ref` | `{"$ref": "#contact"}` |

A `$ref` object MUST contain only the `$ref` member. Sibling members are a validation error. This keeps references detectable without a schema.

Wikilinks may include a display label: `[[auth-service#auth-config|the auth config]]`. The label is not part of the address.

### 6.2 Typing

A schema declares what a reference may target (§7.4). A reference whose target is not permitted by the schema is a validation error.

### 6.3 Resolution

A reference must resolve to exactly one node. Otherwise:

- Target missing: dangling reference, error.
- Target ambiguous (only possible with name or index steps): error.
- Target resolves but uses an unstable step: warning, unless the schema sets `allowEscapeRefs: false`, which makes it an error.

---

## 7. Schemas and bindings

### 7.1 Location

- Schemas live in `.vmd/schema/`, as JSON Schema 2020-12 documents.
- Bindings live in `.vmd/bindings.yaml`.

### 7.2 Bindings

```yaml
bindings:
  - match: persons/*              # direct children only
    schema: person.schema.json
    folder:
    subfolders: forbid            # forbid | allow | { maxDepth: N }
    filename: "^[a-z0-9-]+$"
    format: [md, yaml]            # optional whitelist
    root: record                  # record | section (see §4.4)

  - match: persons/**
    subfolders: allow
```

Rules:

- `match` is a glob over record IDs. `*` matches one path segment. `**` matches any depth.
- A record may match at most one binding with a `schema`. Multiple folder-rule bindings may apply, and they must not conflict.
- `subfolders: forbid` makes any record under a subdirectory of the matched folder an error.
- Records not matched by any binding are valid but unschematized. Their references are still checked.

### 7.3 Validation target

The schema validates the normalized tree (§4.3), not the raw source. A schema therefore works the same for a Markdown record with front matter and a YAML record with the same logical content.

### 7.4 VMD extension keywords

| Keyword | Where | Meaning |
|---|---|---|
| `x-vmd-ref` | a schema for a `$ref` object | `{"targets": ["persons/*"], "allowEscapeRefs": false}` |
| `x-vmd-id` | a schema for a node | `{"unique": "record" \| "parent"}`; default `parent` |
| `x-vmd-key` | an array schema | Field whose value identifies items, for merges (§10.3) |

### 7.5 Example

`.vmd/schema/person.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["role", "team"],
  "properties": {
    "role": { "enum": ["engineer", "manager", "designer"] },
    "team": { "type": "string" },
    "manager": {
      "type": "object",
      "required": ["$ref"],
      "x-vmd-ref": { "targets": ["persons/*"], "allowEscapeRefs": false }
    },
    "contact": {
      "type": "object",
      "properties": {
        "$id": { "const": "contact" },
        "email": { "type": "string", "format": "email" }
      },
      "required": ["email"]
    }
  },
  "additionalProperties": false
}
```

A violation example: `persons/grace.md` declares `manager: {"$ref": "teams/auth"}`. The target matches `teams/*`, not `persons/*`, so validation fails.

---

## 8. Index

### 8.1 Principle

Files are the source of truth. The index is derived and can be rebuilt from files at any time. Nothing in the index is authoritative.

### 8.2 Contents

The index has four tables:

- `records`: record ID, path, format, binding, source hash.
- `nodes`: record ID, node path, node ID, kind, parent, source span (byte offsets), node hash.
- `refs`: source node, source span, raw address, resolved target node (or null), kind (`dangling`, `ambiguous`, `unstable`, `ok`).
- `aliases`: see §8.4.

### 8.3 Storage and freshness

- Storage: SQLite is recommended for query performance. JSON Lines is acceptable for small stores and is diffable.
- Location: `.vmd/index/`. This directory is excluded from git.
- Freshness: each record's source hash is compared on use. Stale records are re-parsed. Reference resolution is recomputed for records that reference a changed node.

### 8.4 Aliases

Aliases preserve old addresses after renames, for external consumers and detached references. They are committed.

- Location: `.vmd/aliases.jsonl`, tracked by git.
- Entry format:

```json
{"kind": "record", "from": "persons/ada", "to": "persons/ada-lovelace", "at": "2026-10-09T08:00:00Z"}
{"kind": "node", "record": "auth-service", "from": "auth-config", "to": "auth-settings", "at": "..."}
```

- Resolution of an old address follows the alias and emits a warning.
- Aliases are optional. Renames that rewrite all in-store references do not need one. `vmd mv --keep-alias` and `vmd rename --keep-alias` create them.

---

## 9. Operations and transactions

### 9.1 Operations

Operations are semantic, not textual. Each one names a target node and an intended change.

| Operation | Effect |
|---|---|
| `set(addr, value, if_version)` | Set a field |
| `insert(parent, node, if_version)` | Add a child node or item |
| `delete(addr, if_version)` | Remove a node or field |
| `replace_body(addr, text, if_version)` | Replace a section's `$body` |
| `rename(addr, new_id, if_version)` | Change a node ID and rewrite references (§10.1) |
| `mv(record, new_record, if_version)` | Move a record and rewrite references (§10.2) |

Semantic operations can be replayed on a newer base. Textual patches cannot, which is why this design rejects them as the primary operation type.

### 9.2 Transaction lifecycle

```
vmd tx begin
vmd tx op ...            # stage operations
vmd tx status            # show staged ops, affected files, validation preview
vmd tx commit            # apply atomically
vmd tx amend             # edit staged ops after a failed commit
vmd tx rebase <base>     # re-check against a new base
vmd tx abort
```

A transaction is stored in `.vmd/tx/<id>.json` until it commits or is aborted. A failed commit keeps the transaction, so it can be amended or rebased.

### 9.3 Version tokens and conflicts

- A record token is the hash of the record's bytes.
- A node token is the hash of the normalized subtree rooted at that node. Editing an unrelated section does not change the token of another section.
- Each operation includes the token it was based on (`if_version`). On commit, the token is compared with the current state.
- A mismatch is a conflict. The commit stops and lists the conflicting operations.
- An operation whose token matches is applied. One whose token does not match is held for review.

### 9.4 Commit procedure

1. Acquire the store lock (`.vmd/lock`).
2. Check every operation's `if_version`. On any mismatch, stop and report.
3. Apply operations to the in-memory normalized trees of affected records.
4. Serialize each record with span-preserving writes (§11).
5. Validate the resulting trees against bindings and schemas, and check all references across the store.
6. If validation fails, stop. Leave the transaction in place.
7. Write files atomically: write to a temporary file, flush, rename over the target. For multi-file commits, write a journal (`.vmd/tx/<id>.journal`) first so an interrupted commit can be completed or rolled back on the next run.
8. Update the index.
9. Release the lock. Optionally create a git commit (§12).

### 9.5 Multi-file atomicity

Steps 6 and 7 together give all-or-nothing behavior for a local store. The journal covers crashes during step 7. Git-backed stores also get atomicity from a single commit containing all changed files.

---

## 10. Reference updates

### 10.1 Node rename

`vmd rename persons/ada#contact contact-info`:

1. Resolve the target node. Check that `contact-info` matches the ID grammar and is unique among siblings.
2. Find every reference whose resolved target is the node, using the `refs` index. Also find escape-hatch references that resolve to it.
3. Build edits:
   - the ID attribute (`{#contact}` in Markdown, `$id` in data),
   - each reference's address segment, located by its source span.
4. Check preconditions: the touched files' hashes match the index.
5. Apply as one transaction (§9.4).
6. Re-index. Run validation. Unresolved references after the rename are an error, and the transaction is rolled back.

Reference rewriting only changes the address text. Surrounding text, labels (`|label`), and formatting are preserved.

### 10.2 Record move

`vmd mv persons/ada persons/ada-lovelace`:

1. Check that the destination is unique, the binding allows it, and the new name matches the filename rule.
2. Rewrite every reference whose record part is the old ID.
3. Move the file.
4. Add a record alias if requested.

### 10.3 Escape-hatch rewriting

`vmd normalize` converts `name-sel` and `index` references to ID form where the target has an ID. Each conversion is listed. Without `--apply`, it only reports.

### 10.4 What rewriting does not cover

References from outside the store, such as URLs, external documents, or code, are not rewritten. Those are reported as potential breakage, and the alias table is the recovery path.

---

## 11. Format fidelity

These rules keep diffs small.

- Encoding: UTF-8. Preserve the original line endings. New files use LF.
- Bytes outside an edited span are not changed. Edits splice text at source spans.
- Trailing newline: preserved as found.
- YAML: use a round-trip parser that preserves comments, quoting style, and key order. Re-serialization must be stable.
- JSON: preserve key order and indentation. Re-serialization uses the indentation detected in the file.
- Markdown: only the edited heading, block, or body text is changed. Other content is left alone.
- A no-op write (a value set to its current value) produces no change.

---

## 12. Git integration

### 12.1 Tracked files

| Path | Tracked | Notes |
|---|---|---|
| Records | yes | the content |
| `.vmd/schema/`, `.vmd/bindings.yaml` | yes | |
| `.vmd/aliases.jsonl` | yes | |
| `.vmd/index/` | no | add to `.gitignore` |
| `.vmd/tx/`, `.vmd/lock` | no | local state |

### 12.2 Merge driver

Register a custom driver in `.gitattributes`:

```
persons/*.md   merge=vmd
persons/*.yaml merge=vmd
persons/*.json merge=vmd
```

Configure:

```
git config merge.vmd.driver "vmd merge-driver %O %A %B %L %P"
```

The driver performs a node-level three-way merge (§13.3). On conflict it writes a conflict record to `.vmd/conflicts/` and exits non-zero. Git then marks the file as conflicted, and the user resolves it with `vmd resolve`.

### 12.3 Hooks

- `pre-commit`: `vmd validate --staged`. Blocks commits with schema or reference errors.
- `post-checkout` / `post-merge`: `vmd index --incremental`.

### 12.4 Renames in git

`git mv` changes a path, but git's rename detection is a heuristic and does not rewrite references. Use `vmd mv` instead, which performs the reference rewrite and then stages the change. `git mv` on a record should trigger the validator, which will report broken references.

### 12.5 Checkout by SHA

Checking out an old commit requires re-indexing that tree. Index entries can be cached by tree SHA, so revisiting a commit is cheap. The aliases file at that commit defines which old addresses resolve.

---

## 13. Diff and merge

### 13.1 Semantic diff

`vmd diff <rev1> <rev2>` reports, keyed by node:

- nodes added, removed, moved (same ID, different parent),
- fields changed, with old and new values,
- body text changed, shown as a line diff scoped to the node,
- references added, removed, or retargeted,
- renames, when recorded by an `rename` operation or an alias.

Renames without an explicit record are reported as remove plus add.

### 13.2 Text diff

`git diff` remains available and is correct for raw text. The semantic diff is an addition, not a replacement.

### 13.3 Three-way merge

Merge works on the normalized tree.

- Maps: merged per key. Both sides changing the same key differently is a conflict.
- Arrays of objects with `x-vmd-key`: merged by key. Items are added, removed, or changed independently.
- Arrays without a key: treated as atomic values. Concurrent changes are a conflict.
- Section bodies: a line-based three-way merge inside `$body` only.
- Node IDs: a rename on one side and a content edit on the other is applied together, with the reference rewrite included.

### 13.4 Conflicts

Conflicts are recorded at node granularity, with base, ours, and theirs values. `vmd resolve` lets the user pick a side per node or edit the result. The result is validated before the file is written.

---

## 14. Core and extension features

This section separates what a store must provide from what VMD adds.

### 14.1 Filesystem core (required for Level 0)

- List records and directories (`ls`).
- Read a file, with a byte or line range (`cat`, `head`, `tail`).
- Atomic write (write to temp, rename).
- Delete (`rm`) and move (`mv`).
- Metadata: size, modification time, and a content hash, without reading content (`stat`).
- Create a directory (`mkdir`).

A filesystem without an atomic rename or a content hash cannot support Level 2 transactions safely.

### 14.2 Git core (used by Level 2 and 3 where git is present)

- `add`, `rm`, `reset`, `commit`, `pull`, `merge`.
- `checkout <sha>` for reading historical trees.
- `show <rev>:<path>` for reading a file at a revision.
- `log`, `diff` for history.
- Merge drivers via `.gitattributes`.

Git provides content hashes (object IDs) for free, and these serve as version tokens for committed state.

### 14.3 VMD extensions

| Command | Purpose | Level |
|---|---|---|
| `vmd validate` | Check schemas, bindings, references | 1 |
| `vmd index` | Build or update the index | 2 |
| `vmd resolve <address>` | Resolve an address to a node and source span | 1 |
| `vmd rename`, `vmd mv` | Rename with reference rewrite | 2 |
| `vmd normalize` | Convert unstable references to ID form | 2 |
| `vmd tx ...` | Transactions | 2 |
| `vmd diff` | Semantic diff | 3 |
| `vmd merge-driver` | Node-level merge | 3 |
| `vmd resolve-conflict` | Resolve a node-level conflict | 3 |

### 14.4 Conformance levels

- **Level 0, Readable**: files are ordinary `.md`, `.json`, or `.yaml` with no VMD markup required. Any tool can read them. No IDs, index, or validation are needed. Adding `{#...}` IDs or `$id` members moves a record toward Level 1 and beyond, but is never required for Level 0.
- **Level 1, Validated**: bindings, schemas, reference validation, `vmd validate` and `vmd resolve`.
- **Level 2, Refactorable**: the index, `rename` and `mv` with reference rewrite, aliases, transactions with version tokens.
- **Level 3, Mergeable**: semantic diff, node-level merge, merge driver.

### 14.5 Non-git systems

A system without git can adopt Levels 0–2 if it provides:

- a version token per file (an ETag or content hash) returned on read and checked on write,
- atomic write and atomic rename,
- a way to record the aliases file as part of its own history.

Levels 2–3 history and rebase are then the system's responsibility. A rebase without history can still re-check tokens, but it cannot compute a three-way merge.

---

## 15. Open questions

1. **Index storage.** SQLite is fast but binary and not diffable. JSON Lines is diffable but slow past about 100k records. Proposed: SQLite, derived and ignored by git.
2. **Case-insensitive filesystems.** Rejecting case-only collisions (§3.3) is the minimum. Whether to also reject them across record and folder names needs a decision.
3. **Unicode normalization.** Node IDs are ASCII by grammar. Should `$title` and name selectors be normalized, and how to match them?
4. **Body representation.** `$body` as raw Markdown text is simple and round-trips well. A Markdown AST would allow finer edits but is harder to keep byte-stable.
5. **Alias merge conflicts.** Two branches renaming the same node differently produce conflicting aliases. Proposed: report and require a manual choice.
6. **Multiple schemas per record.** §7.2 allows one schema per record. Composition (for example, a base schema plus a domain schema) might be needed.
7. **Performance targets.** Latency goals for `ls`, `resolve`, and a full-store `validate` at 10k and 100k records should be set before implementation.
8. **Escape-hatch policy.** Whether `name-sel` references should be allowed by default, or only where a schema explicitly permits them.

---

## 16. Summary

- Records are files. Format is free, and the record ID is the path without extension.
- Stable IDs are opt-in. A plain Markdown, JSON, or YAML file is valid as-is. Where IDs are added, they give stable addresses. Name and index addresses are allowed but flagged.
- References are wikilinks in Markdown and `$ref` objects in JSON and YAML. Both resolve to a unique node.
- Schemas validate a normalized tree. Bindings tie schemas and folder rules to paths.
- The index is derived and rebuildable. Aliases and the lock-free history live in git.
- Transactions are semantic, guarded by node-level version tokens, and survive failed commits.
- Renames rewrite every reference through the index, in one transaction.
- Git and a plain filesystem provide the core. VMD adds validation, indexing, rewriting, and format-aware merging on top.
