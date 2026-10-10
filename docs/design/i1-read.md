# Design: phase I1 (read)

Status: proposal for the project owner's review, 2026-10-10. It designs tasks I1.1 to I1.11 of
[the implementation plan](../plan/implementation-plan.md) (issues #10 to #20) against Draft v0.5 of
[the proposal](../draft/vollmond-proposal.md) and the conformance suite, both at commit `d0d1424` on `main`. No code is written
until it is approved. Sections of the proposal are cited as §n, and decisions by their cards in the
[decision log](../draft/vollmond-proposal-review.md).

Claims are marked as in the parser survey. **M** is measured by a script in [`docs/research/i1-design/`](../research/i1-design/),
with its output in `results/`, on Node 24.21.0 on one laptop. **D** is documented, with the source named. **U** is unverified.

In brief:

- `@vollmond/core` holds the whole read path, including the storage contract's interface and an in-memory backend. `@vollmond/cli`
  holds the filesystem backend and the commands. The conformance runner is a third, private package.
- Values are plain JavaScript values with doubles (F2). A number's source text is read once, at parse, from the library's offsets.
- Each parser builds vmd's value from the library's syntax tree in one walk, never with the library's own conversion, and every
  check of §4.1 is a branch of that walk.
- All three libraries report UTF-16 offsets (M), so one `SourceText` per file converts them to UTF-8 bytes (C10).
- Markdown uses `mdast-util-from-markdown` with exactly the four GFM 0.29 extensions, not the `gfm()` bundle, whose footnotes
  change block structure (M). `$body` and `$title` are slices of the source.
- Derived anchors use Unicode tables generated from UCD 17.0.0, and the runtime's NFC.
- Operations return `Outcome<T>`. Exceptions are bugs.
- The runner lands first, with every case skipped by name, so each later pull request shows its cases fail before they pass.

---

## 1. Module layout

### 1.1 `@vollmond/core`

| Module (`src/`) | Responsibility |
|---|---|
| `value/` | `Value`; equality as §5.8 defines it; number literals by form (§4.2, G1); RFC 8785 canonical JSON; SHA-1 and SHA-256 (question 9); node versions and git blob ids (§11.3) |
| `text/` | `SourceText`: bytes, decoded text, UTF-16 index to UTF-8 offset, line and column (C10); line breaks read as `\n`, with a map back to the source (C9) |
| `issue/` | Appendix D as data (code, default severity, class); `Issue`; `Outcome<T>` |
| `format/json.ts`, `format/yaml.ts` | one parse unit each: value, node ranges, issues. The YAML module also serves front matter and `yaml data` blocks |
| `format/markdown/` | front matter, the block walk, headings and the anchor element, data blocks, `$body` slices, block anchors |
| `record/` | `ParsedRecord` and its `NodeIndex`; the section shape of §5.2 and §5.4, shared by every format; section keys (§5.5) and duplicates (§5.7) |
| `anchor/` | the slug (§6.3 steps 1 to 6); the anchor table (explicit, derived with repeats, block, tags); generated Unicode tables and a runtime probe |
| `address/` | the §7.1 grammar; exact and semantic resolution; the static check of §7.4; canonical addresses (§7.5) |
| `meta/` | the computed fields of §5.10 |
| `storage/` | the read side of the storage contract (§11.2); the portable regex checker (§11.4); an in-memory backend |
| `store/` | `openStore`: parse, get, outline, resolve and list over a backend; what I1 reads from `.vmd/config.yaml` (question 3) |

Runtime dependencies are `jsonc-parser`, `yaml`, `mdast-util-from-markdown` with `micromark`, and the four GFM 0.29 extensions
with their mdast counterparts, all pure JavaScript (licences to be confirmed at adoption, Appendix C). No type declaration in them
references Node's types (M), so the guard `no-node-types.typecheck.ts` holds and will catch a change. The `yaml` package's Node
build imports `node:process` to emit warnings and its browser build does not (M, `dist/log.js`); package exports pick the right
one.

**Where the filesystem lives.** `core` declares `StorageReader`. `cli` implements it over `node:fs` and runs `git` for file
versions. `core`'s memory backend lets its own tests run without Node APIs.

### 1.2 `@vollmond/cli`

| Module (`src/`) | Responsibility |
|---|---|
| `cli.ts`, `main.ts`, `arguments.ts` | `runCli` becomes async and keeps returning a `CliResult`; `util.parseArgs`; `--store`, `--config`, `--json`, `--quiet` (§12.1) |
| `store-discovery.ts` | the store root, the directory holding `.vmd/config.yaml` (§3.3), from `--store` or the working directory |
| `backend/` | `StorageReader` over `node:fs/promises`; file versions in a git working copy (section 2.6) |
| `output/` | one line per item, `~tok` as bytes ÷ 4, limits and cursors (§12.2); the issue format of §12.3; `--json` |
| `command/` | `ls`, `cat`, `grep`, `outline`, `get` |

`outline` prints no refs-in counts in I1. They need the index of I2.5.

### 1.3 `js/packages/conformance` (private)

The runner of I1.10 (section 6). It reads the suite with Node APIs, so it cannot be in `core`, and it should not ship in the `vmd`
package (question 11).

---

## 2. Public types

Short sketches. The code carries the doc comments.

### 2.1 Values

```ts
export type Value = null | boolean | number | string | readonly Value[] | ValueObject;
export interface ValueObject { readonly [name: string]: Value }      // created with a null prototype

export function valuesEqual(a: Value, b: Value): boolean;              // §5.8
export function canonicalJson(value: Value): string;                  // RFC 8785
export function nodeVersion(value: Value): Promise<string>;           // SHA-256 of canonicalJson, 16 hex digits
export function gitBlobId(content: Uint8Array): Promise<string>;      // SHA-1 of "blob <length>\0" and the content

export type NumberLiteralReading =
  | { readonly kind: "number"; readonly value: number }               // -0 reads as 0
  | { readonly kind: "not-representable"; readonly reason: "integer-changed" | "overflow" | "underflow" };
export function readNumberLiteral(literal: string, syntax: "json" | "yaml"): NumberLiteralReading;
```

- **Null-prototype objects**, so that a member named `__proto__` stays an ordinary member.
- **No number wrapper.** §4.2 needs a number's source text twice: for the representability check, which the parser does from the
  library's offsets, and to leave an unchanged number alone in an edit, which I4 does with the source map's ranges. So the value
  holds plain doubles (F2), and none of the survey's options A to C is built.
- **Canonical JSON** sorts member names by UTF-16 code units and writes primitives as `JSON.stringify` does, as RFC 8785 sections
  3.2.2 and 3.2.3 specify (D). Doubles and well-formed strings meet its preconditions by construction.

### 2.2 Source text and positions

```ts
export interface ByteRange { readonly start: number; readonly end: number }   // UTF-8 bytes, [start, end)
export interface Position { readonly offset: number; readonly line: number; readonly col: number }
export interface SourceText {
  readonly bytes: Uint8Array;
  readonly text: string;                       // fatal UTF-8 decoding; a leading BOM stays as U+FEFF
  byteOffset(utf16Index: number): number;
  position(byteOffset: number): Position;      // line from 1, column in code points from 1
}
```

- `jsonc-parser`, `yaml` and `mdast` give offsets in UTF-16 code units, and `mdast` gives columns in them too (M). One pass builds
  the line starts and a sparse table with an entry per non-ASCII character, and an ASCII-only file uses the identity.
  `Minimal_Log.md` has 2,307 non-ASCII bytes in 672,894 (M). Columns are counted only for positions that are printed.
- `TextDecoder` removes a leading BOM unless `ignoreBOM` is set (D: WHATWG Encoding Standard, `TextDecoder`). That would shift
  every offset and hide the BOM from the JSON parser, so the text keeps it and each format decides (section 3.1).
- CRLF and a lone CR read as `\n` (C9; the suite's `markdown/crlf/lone-cr`). The map back to the source serves block anchor ranges
  now and I2's link offsets later, which count the bytes of the value (§5.9).
- The API uses `ByteRange` objects; JSON output writes `[start, end]`, as §5.10 shows.

### 2.3 Records and sections

```ts
export function parseRecord(path: string, content: Uint8Array, options?: { readonly uniqueness?: "strict" | "lenient" }):
  Outcome<ParsedRecord>;                       // fails exactly when there is a structural error (§9.2, F1)

export interface ParsedRecord {
  readonly path: string;
  readonly format: "md" | "yaml" | "json";     // from the extension (§3.1)
  readonly value: ValueObject;                 // the value view (§5.1)
  readonly source: SourceText | null;          // null for a backend without files (§5.9)
  readonly nodes: NodeIndex;
  readonly anchors: AnchorTable;
  readonly issues: readonly Issue[];           // validation issues found while parsing
}
export interface NodeIndex {
  node(at: string): NodeInfo | undefined;
  children(at: string): readonly NodeInfo[];
  sections(): readonly SectionInfo[];          // document order, root first
}
export interface NodeInfo {
  readonly at: string;                         // exact path (§7.2), "" for the root
  readonly parent: string | null;
  readonly key: string | number | null;        // @key; null for the root
  readonly kind: "section" | "object" | "array" | "string" | "number" | "boolean" | "null";
  readonly range: ByteRange | null;            // the source map entry (question 1)
}
export interface SectionInfo extends NodeInfo {
  readonly depth: number;                      // @depth
  readonly heading: { readonly level: number; readonly range: ByteRange; readonly derivedAnchor: string | null } | null;
}
```

The index is built in the same pass as the value, and both are immutable. Outlines, canonical addresses and resolution all walk
parents and children, so one pass serves them all.

### 2.4 Issues

```ts
export interface Issue {
  readonly code: IssueCode;                    // a union of Appendix D's codes
  readonly severity: "error" | "warning";
  readonly class: "structural" | "validation" | "operation";
  readonly path: string | null;                // for address issues, the record the address names (H1.2)
  readonly at: string | null;                  // "" for the record (H1.1); null when there is no node
  readonly message: string;
  readonly hint?: string;
  readonly position?: Position;                // in the file, where there is one (§12.3)
  readonly offset?: number;                    // into the $body or $title that `at` names (§5.9)
  readonly candidates?: readonly Target[];     // for an ambiguity (§7.4)
}
```

- **The class is on the issue**, since two codes change class with context: `feature-unsupported` (a record or a schema) and
  `not-representable` (`check` or the serializer).
- **Severities resolve late.** Parsers give the default, with `duplicate-key` and `duplicate-anchor` set by the uniqueness mode.
  I2.1 applies the configuration's `issues` (§9.1) as a function over issues, so no parser learns about configuration.
- **Counting** follows H1.3.
- A test in the conformance package reads Appendix D's table from the proposal and compares it with `core`'s table, so the two
  cannot drift apart.

### 2.5 Computed fields and addresses

```ts
export type ComputedFieldName = "@path" | "@at" | "@address" | "@key" | "@anchors" | "@version" | "@source"
  | "@range" | "@issues" | "@refs" | "@collection" | "@depth" | "@nodes";
export function computeFields(record: ParsedRecord, at: string, names: readonly ComputedFieldName[] | "all",
  policy: UniquenessPolicy): Promise<ComputedFields>;   // an object keyed by the names, with the types of §5.10

export interface Address { readonly record: string; readonly fragment: Fragment | null }   // null: the root
export type Fragment =
  | { readonly kind: "exact"; readonly tokens: readonly string[] }       // RFC 6901, unescaped; "#/" is [""]
  | { readonly kind: "semantic"; readonly steps: readonly string[] };    // percent-decoded
export function parseAddress(text: string, options?: { readonly raw?: boolean }): Outcome<Address>;
export function formatAddress(address: Address): string;

export interface Target { readonly path: string; readonly at?: string; readonly address?: string; readonly range?: ByteRange }
export interface UniquenessPolicy {
  readonly mode: "strict" | "lenient";
  declaredListType(recordPath: string, level: readonly string[]): "map" | "multimap" | undefined;   // filled by I2.3
}
export function proveSingular(address: Address, policy: UniquenessPolicy): Outcome<void>;
export function resolveAddress(record: ParsedRecord, fragment: Fragment | null, use: "singular" | "selector",
  policy: UniquenessPolicy): Outcome<readonly Target[]>;
export function canonicalAddress(record: ParsedRecord, at: string, policy: UniquenessPolicy): string;
```

- `all` leaves out `@nodes` (§5.10). `@version` is asynchronous because of the digest. `@key` is absent for the root.
- `@refs` and `@collection` need I2.4 and I2.1. In I1 they are absent when requested, and the CLI says so. `@issues` holds the
  parse-time issues in I1.
- `raw` lets the CLI accept characters outside `step` without percent-encoding (§7.1).

### 2.6 The storage contract's read side

```ts
export interface FileInfo { readonly path: string; readonly size: number; readonly version: string; readonly modified: string | null }
export interface StorageReader {
  list(query: { prefix: string; glob?: string; limit: number; cursor?: string }): Promise<Outcome<Page<FileInfo>>>;
  stat(path: string): Promise<Outcome<FileInfo>>;
  read(path: string, options?: { range?: ContentRange; at?: string }): Promise<Outcome<FileContent>>;
  grep(query: GrepQuery): Promise<Outcome<GrepResult>>;
  head(): Promise<Outcome<string | null>>;     // null for a plain filesystem (§11.5)
  readonly history: StorageHistory | null;     // changes and log, where supported (§19.2)
}
```

- **A backend knows files, not records.** The store layer sorts them into records, assets and ignored paths (§3.3), so a backend
  needs no vmd configuration (§11.1). Cursors encode the last path, in UTF-8 byte order (C25).
- **File versions in git.** The plan says "from `git ls-files -s`", which prints the blob id of the index entry (D: git-ls-files,
  `--stage`) and is wrong for a file modified in the working tree. So the backend takes ids from `git ls-files -s -z` for files
  that `git diff-files --name-only -z` does not list, and hashes modified and untracked files, and every file outside git.
- **`grep`** checks the pattern against the portable subset (§11.4), then runs it (question 13).
- The write side of I4 extends this interface.

---

## 3. The parse pipeline

### 3.1 Common to the three formats

1. **Decode** with `TextDecoder("utf-8", { fatal: true, ignoreBOM: true })` (question 4).
2. **Parse** each unit to the library's syntax tree.
3. **Walk** the tree once. The walk builds the value with null-prototype objects, fills the `NodeIndex` with ranges in UTF-8, and
   raises the issues of §4.1 and §4.2 at each node, with its source text at hand.
4. **Check the model**, the same way for every format: the section shape (§5.2, §5.4), keys and duplicates (§5.5, §5.7), and
   anchors and tags (§6).

**Parse units and syntax errors.** A JSON or YAML file is one unit; a Markdown file has its front matter, each data block and the
Markdown itself. A unit with a syntax error gets one `syntax-error` and no value checks, since a recovering parser's tree past an
error is a guess. The other units are still parsed, so one run shows every broken unit (C2; question 2).

**Numbers by form** (§4.2, G1), for every format, from the literal's source text:

- A JSON number is an integer by form when it has no `.`, `e` or `E`.
- A YAML number is a plain scalar that the core schema reads as a number. It is an integer by form when it matches
  `[-+]?[0-9]+`, `0o[0-7]+` or `0x[0-9a-fA-F]+` (D: YAML 1.2.2, section 10.3.2). `.inf` and `.nan` are `yaml-non-finite`.
- An integer by form must equal its double, compared as `BigInt`, which reads `0x` and `0o` itself. An infinite double is an
  overflow, and a zero double from a non-zero mantissa an underflow.

### 3.2 JSON

`jsonc-parser` 3.3.1, the current release (npm, 2026-10-10) and the one the survey measured, through `parseTree` with
`disallowComments: true`, `allowTrailingComma: false` and `allowEmptyContent: false`.

- It recovers and reports several errors (M: `{"a":1 "b":2, "c" 3}` gives two), with cascades (M: `NaN` gives `InvalidSymbol`
  and `ValueExpected`). They become positions in the unit's one `syntax-error`.
- It rejects `NaN`, `+1`, `.5`, `01`, a raw control character, a trailing comma, the empty file (M), and a BOM (M; question 4).
- It does not check duplicate members or lone surrogates (survey section 3.2; M). The walk raises `duplicate-member` at each
  member after the first, and `unpaired-surrogate` through `String.prototype.isWellFormed`.
- A root that is not an object is `root-not-object` for a file and `data-block-not-object` for a `json data` block.
- A parser of vmd's own over UTF-8 bytes would give byte offsets directly. It is not proposed: `jsonc-parser` is small and has no
  dependencies, and the offset conversion is needed for the other formats anyway.

### 3.3 YAML

`yaml` 2.9.1, current and measured by the survey, through `parseDocument` with `version: "1.2"`, `schema: "core"`, `merge: false`,
`uniqueKeys: false` and `keepSourceTokens: true`. Its errors become `syntax-error`, except `MULTIPLE_DOCS`, which is
`yaml-multiple-documents` (M). The library is silent about most constructs outside the data model, so the walk raises them
(each M, here or in the survey):

| Construct | What `yaml` does | What the walk raises |
|---|---|---|
| any explicit tag, `!!str` and `!` included | sets `node.tag`, only for explicit tags; warns only for a custom tag | `yaml-tag` (H2.3) |
| anchor, alias, undefined alias | `node.anchor` and `Alias` nodes; no error for an undefined alias | `yaml-alias` (H2.5) |
| plain `<<` key | an ordinary key, with `merge: false` | `yaml-merge-key` at the mapping (H2.4) |
| key that is not a string | keeps the typed key in the tree | `yaml-non-string-key`, which also covers the survey's silent `1` and `'1'` collision |
| repeated key | no error, with `uniqueKeys: false` | `duplicate-member`, with vmd's places |
| `%YAML 1.1` | switches the document to YAML 1.1 | `yaml-version-unsupported` (H2.6) |
| `%YAML 1.3` | warns `BAD_DIRECTIVE` and reports 1.2 | the same, from the directive's own text in the tokens |
| raw U+FFFE or U+FFFF | accepted | `syntax-error`, from a scan for characters outside `c-printable` (§4.1) |
| `"\ud800"` | accepted; a pair of escapes is combined | `unpaired-surrogate` (H2.2) |

The walk also reads numbers as section 3.1 says, an empty document as `{}` (§5.4), and raises `root-not-object`. It raises the two
ambiguity warnings of §4.4 on the record, tested through `check` from I2.6 and by unit tests now.

### 3.4 Markdown

`mdast-util-from-markdown` 2.1.0 over `micromark` 4.0.3, both current, with exactly GFM 0.29's extensions (§5.3): tables,
strikethrough, task list items and autolink literals, as the separate `micromark-extension-gfm-*` and `mdast-util-gfm-*` packages.
Plan §1.2 names "the GFM and front-matter extensions". Neither package is used:

- `micromark-extension-gfm` adds GitHub's footnotes, which GFM 0.29 does not have. They change block structure: `[^1]: target.md`
  is a link reference definition, and so a reference (§8.1), under GFM 0.29, and a footnote definition with the bundle (M;
  question 8).
- `micromark-extension-frontmatter`, since vmd's rule is its own: an unclosed block is an error, and a BOM is skipped (§5.3). The
  rule is a few lines to write, and whether the extension can be made to follow it was not checked (U).

The steps:

1. **Front matter** (H3.4, H3.13). After an optional BOM, a delimiter line is `---`, then spaces or tabs, at the very start, and
   the block ends at the next delimiter line. Unclosed is `syntax-error` at `""`, and parsing stops. The block is a YAML unit,
   whose members are the root's fields (H3.5, H3.7).
2. **Masking.** The BOM and the front matter are replaced by spaces of the same UTF-16 length, line breaks kept, before the whole
   text is parsed. `mdast` positions are then file positions, and the masked lines are blank lines to CommonMark.
3. **The block walk** visits only the root's children, so headings inside lists, block quotes and HTML blocks stay prose (H3.12).
   The title heading rule and `multiple-h1` use the same top-level headings. A stack by level builds the section tree.
4. **A heading.** Its content range runs from its first child to its last, without the `#` sequences or a setext underline (U: to
   be pinned by tests against `mdast`). A small parser of CommonMark's open-tag syntax (0.31.2, section 6.6) reads the anchor
   element among its inline `html` nodes, and raises `anchor-element-invalid` for content, another attribute or a second element
   (§6.2, H4.6). `$title` is the content's source without the element, trimmed, with a multi-line setext title's lines joined by
   `\n` (H3.3). The visible text for the slug comes from the `mdast` children: text values (with references decoded and escapes
   resolved), code spans, and the children of emphasis, strikethrough and links; nothing from images, raw HTML or comments; a hard
   break gives `\n` (H5.1). Other HTML raises `heading-html` (C15).
5. **A data block** is the heading's next top-level sibling when it is a fenced code block. Its info string is read from the
   source line, not from the decoded `lang` and `meta` (H3.10). Placement errors are `data-block-misplaced` (H3.8, H3.9). An
   indented fence loses that indentation from each content line (CommonMark 0.31.2, section 4.5), so such a unit gets a per-line
   offset map.
6. **`$body`** is the source from the end of the heading, or its data block, to the next top-level heading, with leading blank
   lines and trailing spaces, tabs and line breaks removed (H3.2), and absent when empty (H3.1, H3.15). It is never re-serialized.
7. **Block anchors** are anchor elements at the start of a top-level paragraph or of an item of a top-level list (§6.2), with
   ranges as question 1 says. Any other `<a id>` in a body raises `anchor-element-ignored` (H4.5).

### 3.5 Structural and validation issues apart (F1)

`parseRecord` fails when any issue it raises is structural, and only then. Validation issues found while parsing
(`duplicate-key`, `duplicate-anchor`, `duplicate-tag`, `anchor-invalid`, `anchor-element-ignored`, `multiple-h1`, `heading-html`,
`not-representable` for a multi-line title, the YAML ambiguity warnings) go on `ParsedRecord.issues`, never fail a parse, and are
not part of the suite's `parse` results. Operation issues, such as `address-*`, come only from operations. A unit test checks the
class of every code each parser raises against Appendix D.

---

## 4. Derived anchors and addresses

### 4.1 The slug rule and its Unicode data

§6.3 reads Default_Ignorable_Code_Point and NFC (step 2), the default lower-case mapping (step 3), White_Space (steps 4 and 5),
and the general categories L, M, Nd and Pc (step 5). The suite pins Unicode 17.0.0 (conformance README, "Versioning").

**The runtime.** Node 24.21.0 bundles ICU 78.3 with Unicode 17.0 (M), which V8 uses for `normalize`, `toLowerCase` and property
escapes (U: not checked in V8's source). It gives the rule's answers, with two traps:

- `toLowerCase` on a string applies the Final_Sigma context: `"ΑΣ"` gives `ας` (M). Step 3 has no context rules, and per code
  point the same input gives `ασ` (M). Per code point it applies SpecialCasing's unconditional mappings (M: `İ` gives two units).
- `String.prototype.trim` keeps U+0085, which is White_Space (M).

**Why not the runtime alone.** `engines` admits every Node 24 release, some with older ICU (U: which release moved to ICU 78),
later Node majors move to Unicode 18, and browsers have their own data (I7). A character unassigned in one version is removed by
step 5 there and kept in another, so one heading gets two anchors.

**The proposal** (question 5): tables generated from UCD 17.0.0 for the properties and the lower-case mapping, and NFC from the
runtime.

- `js/packages/core/scripts/generate-unicode.mjs` downloads `DerivedCoreProperties.txt`, `PropList.txt`,
  `DerivedGeneralCategory.txt`, `UnicodeData.txt` and `SpecialCasing.txt` from `https://www.unicode.org/Public/17.0.0/ucd/`,
  checks SHA-256 hashes written in the script, and writes range tables to `src/anchor/unicode/unicode-17.0.0.generated.ts`. It is
  run by hand, never in CI. Size: some tens of kilobytes (U: an estimate).
- NFC can stay with the runtime because the normalization stability policy keeps the normal form of text in assigned characters
  unchanged in later versions (D: UAX #15, "Versioning and Stability"; U: the wording is to be quoted when the generator lands).

**Tests that catch other Unicode data.** A `cli` test asserts `process.versions.unicode === "17.0"`, so CI fails the day
`setup-node` brings other data. With that pinned, a `core` test compares the tables with the runtime for every code point, which
catches a table generated wrong. `core` exports `unicodeRuntimeProbe()`, which checks facts of 17.0 such as U+16EA0 being a letter
that lower-cases to U+16EBB (M), and the CLI warns when it fails. The suite's `anchors/derived/15-lowercase-unicode-versions` and
`55-case-mapping-singletons` use characters up to Unicode 17.0.

**The anchor table.** Step 7 runs over the section headings and the title heading in document order, with a set of used
candidates. Explicit anchors take no part, and a collision is `duplicate-anchor` (C16), once per node after the first (H1.3).
Section keys (§5.5) are `$anchor` or the slug of `$title`; a JSON or YAML title needs a Markdown parse for that (question 7).

### 4.2 Resolution and cardinality

- **Exact paths** are RFC 6901 over the value view. A block anchor is not a value node, so only a semantic first step reaches one.
- **Semantic steps** follow §7.3 and C17. `$sections` is the only keyed list in I1, and schema-declared lists come with I2.3.
- **The first step** may also match an anchor of any kind. It is ambiguous when it matches a root member and another node's anchor
  (C18). A key and a derived anchor of one node are one match, as the suite's Appendix A sample requires.
- **Duplicates.** A step that matches several nodes makes a singular address `address-ambiguous`, with each candidate's exact path
  and derived anchor, and a selector returns them all (H4.2, H4.3).
- **The static check** (§7.4) runs before evaluation, through `UniquenessPolicy`. Only a level a schema declares `multimap` fails
  it, so in I1, without schemas, it passes every address. The suite's `multimap-*` cases need the Validate profile. I1 builds the
  check and its interface so that I2.3 only adds declarations.

### 4.3 Canonical addresses (§7.5, H4.1)

The root's is `""`. For another node, four candidates are tried in order: its explicit anchor; the semantic path from the nearest
ancestor with an explicit anchor (the root does not count), or from the root; its derived anchor; its exact path. A candidate wins
when it resolves, as a singular address, to exactly that node. That is §7.5's definition used literally, so canonical addresses
cannot drift from resolution. An empty key cannot be a step and falls through (H4.4), and other characters outside `step` are
percent-encoded (question 6). Each attempt is a few map lookups per level.

---

## 5. Errors and results

```ts
export type Outcome<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly Issue[] }
  | { readonly ok: false; readonly issues: readonly Issue[] };

export function openStore(backend: StorageReader, options: { readMode?: "best-effort" | "strict"; config?: Uint8Array }):
  Promise<Outcome<Store>>;
export interface Store {
  parse(path: string): Promise<Outcome<ParsedRecord>>;
  get(address: string, options?: { form?: "value" | "source" | "body"; meta?: readonly ComputedFieldName[] | "all"; value?: boolean }):
    Promise<Outcome<GetResult>>;
  outline(address: string, options?: { depth?: number }): Promise<Outcome<readonly OutlineEntry[]>>;
  resolve(address: string, use: "singular" | "selector"): Promise<Outcome<readonly Target[]>>;
  list(query: ListQuery): Promise<Outcome<Page<StoreEntry>>>;
}
```

- **Expected failures are values**: a structural error, a missing record (`address-not-found`, H1.2), a malformed or ambiguous
  address, a backend that cannot read. A success can carry warnings. A thrown exception is a bug: the CLI catches it at the top
  and exits with 1, and the runner counts it as a crash (conformance README, "Failing is not crashing").
- **The read mode** (§9.5, G7). In best effort, the default, a single-record read of a record with a structural error fails with
  those errors, and a multi-record read leaves the record out and counts it. Strict mode also refuses the validation codes that
  §9.5 lists, held as a constant set in `core`. None of those occurs before I2.2 brings schemas, so in I1 strict mode only makes a
  multi-record read fail instead of counting.
- **One parse per operation.** The store caches records by path and file version within one operation. The index of I2.5 caches
  across operations.

---

## 6. The conformance runner (I1.10)

`npm run conformance` in `js/` runs `js/packages/conformance` over `../conformance` with the declaration in that package, writes
`conformance-report.json`, and follows the README's "Writing a runner" step by step.

| Operation | What the runner calls | Result |
|---|---|---|
| `parse` | `parseRecord` | the value view, or a failure with the structural issues |
| `meta` | `computeFields(…, ["@key", "@address"])` for each section | `{ at: { "@key": key or null, "@address": … } }` |
| `anchors` | the record's anchor table | `{ anchors: [{ name, kind, at, range? }], tags: [{ tag, at }] }` |
| `resolve` | `store.resolve(address, as)` | the targets |
| `compare` | the runner's own comparison | a boolean |
| `check`, `refs`, `query`, `round_trip` | none in I1 | their cases need `validate`, `query` or `write`, so the profile skips them |
| `source_map` | after question 1 | no cases yet |

- **Stores** are read byte for byte into `core`'s memory backend, so conformance tests `core` alone. A `config` input names the
  file in `.vmd/` that replaces `config.yaml`.
- **Independence from the code under test.** Case files are read with `JSON.parse` and a reviver that applies §4.2 through
  `context.source` (survey section 3.3), plus a duplicate-name check with `jsonc-parser`'s `visit`; versions manifests are checked
  with `node:crypto`; the comparison is the runner's own, checked by the `selftest` cases. A bug in `core`'s JSON parser or digest
  then cannot hide itself.
- **Profiles.** The declaration claims `["read"]`, and states that I1 produces source maps once their cases exist (§19.2).
- **Pending and skips.** A `pending` case is a `skip` with `pending: ` and its reason; two block-anchor cases are pending now.
  Cases not implemented yet are skipped by `id`, naming the task that brings them, and each pull request removes the entries it
  covers. `unused_skips` shows leftovers. A flag `--ids-failing` prints the failing ids, to help write entries.
- **CI.** The `js` job runs `npm run conformance` after `npm test`, and any `fail` or `error` fails it. The report is uploaded
  with `actions/upload-artifact`, pinned by commit hash like the workflow's other actions.

---

## 7. Performance budget (I1.11)

The target is `vmd outline docs/design/Minimal_Log.md` in well under a second. Measured on vampiredb's file, 672,894 bytes (M):

| Step | Time |
|---|---|
| importing `mdast-util-from-markdown` and the extensions, cold process | 19 to 39 ms (five runs) |
| first parse, GFM 0.29 extensions, cold process | 254 to 295 ms (five runs) |
| warm parse, GFM 0.29 extensions | 199 ms minimum, 209 ms median |
| warm parse without autolink literals | 134 ms, 139 ms |
| warm parse, CommonMark only | 108 ms, 120 ms |
| `markdown-it`, CommonMark preset, for comparison | 11 ms, 13 ms |

A cold `vmd outline` thus spends about 300 ms on Node, imports and the parse before vmd's own work. What keeps that share small:

- one parse per command, shared by the outline, the keys and the canonical addresses;
- no re-serialization: `$body`, `$title` and the source form of `get` are slices of the text;
- offsets converted through the sparse table, and columns only for printed positions;
- no hashing unless `@version` is requested, which `outline` does not;
- maps per level and a set for repeats, so keys, anchors and canonical addresses are linear in the number of sections;
- the Markdown module imports its parser on first use, so `ls`, `cat` and `grep` never load it.

**If the budget fails** elsewhere: profile vmd's own walk first, then cache outlines by file version in the index of I2.5, and
only last use a fast block scanner such as `markdown-it`, a second parser that could disagree with the first. Leaving out autolink
literals saves a third of the parse (M), but GFM 0.29 includes them, and whether that changes any value view or anchor was not
checked.

**A guard in CI** parses a synthetic document of about 700 KB, built as the measurement script builds it, and fails above 1.5 s:
loose enough for CI's variance, tight enough to catch a quadratic step. I1.11 times the real file with the built command, the
median of ten runs, and records it in #20.

---

## 8. Testing

**Unit tests** cover each module, with Vitest; `core`'s tests use the memory backend. **Property tests** with fast-check (already
a development dependency) check parse invariants; round trips through vmd's serializer come in I4:

1. number literals agree with `BigInt` arithmetic for integers by form and with `Number` otherwise;
2. JSON from `fc.jsonValue()`, printed by `JSON.stringify` with random white space, parses to what `JSON.parse` gives under §5.8,
   and each node's range slices to text that reads as that node;
3. the same for YAML printed by the `yaml` package with every string double-quoted (a test generator only);
4. Markdown documents from a small grammar (headings, paragraphs, fences, data blocks, lists, block quotes, front matter, three
   kinds of line break, non-ASCII text): section ranges tile the file, every top-level heading is a section, no `$body` has a
   leading blank line or trailing white space, and a document and its CRLF copy have equal value views;
5. `SourceText` agrees with `TextEncoder` on every prefix of random strings;
6. a record's derived anchors are distinct, and a slug holds only letters, marks, decimal digits, connector punctuation and `-`;
7. every node's canonical address and exact path resolve, as singular addresses, to that node, and
   `parseAddress(formatAddress(a))` gives `a`.

**The owner's rules:**

- **Watch the test fail first.** The runner lands before any parser, with every case skipped. Each implementation pull request
  first removes its cases' skip entries and shows them as `error` or `fail`, then implements, and its description gives both
  counts.
- **Make each guard fire, and let a legitimate input through.** Each check is shown raising its issue and accepting its near miss
  (a quoted `"<<"`, an escaped U+FFFE, `%YAML 1.2`). Each pull request also removes each of its guards once, on purpose, and lists
  the cases that then failed; a guard whose removal fails nothing gets a test.
- **A suite that passes first try is suspect.** The runner's comparison is broken once on purpose (comparing number text, letting
  `true` equal `1`) to see `selftest` fail, and the versions check is made to fire on an edited copy of a fixture.
- **Predicted bugs get a failing test first**, in the pull request that meets them: `TextDecoder` dropping a BOM; Final_Sigma in
  `toLowerCase`; `trim` keeping U+0085; UTF-16 offsets and columns; `yaml` on `%YAML 1.1` and `%YAML 1.3`; a `__proto__` member; a
  git index id for a modified file.

---

## 9. Open questions

For the project owner, each with options and a recommendation. Where the spec is ambiguous for implementation, the design does not
decide.

1. **Spans and block anchor ranges.** C11 leaves spans to I1.4, and block anchor ranges are #53 question 2, still pending in the
   suite. Sections: (a) the heading line to the start of the heading that ends the section, trailing blank lines included, so
   sections tile the file; (b) without trailing blank lines. Members: (a) the value; (b) key and value. *Recommendation.* (a) and
   (a): removing a section then leaves no stray blank lines, and an exact path names the value that `set` replaces. The root is
   the whole file; `$title` and `$body` are their source spans, which `get` prints in source form even where the value differs (a
   removed anchor element, CRLF). A block anchor takes the pending case's answer, its CommonMark block in the `$body` without the
   trailing line break. I1.4 writes the answer into §5.9 and the decision log.
2. **One syntax error per unit.** C2 asks for every error, but a recovering parser's later errors are often cascades, and the
   suite expects one issue for a syntax error. (a) One `syntax-error` per parse unit, other units still parsed; (b) one issue per
   library error. *Recommendation.* (a).
3. **What I1 reads from `.vmd/config.yaml`.** Configuration is planned for I2.1, but resolution depends on the uniqueness mode.
   Five `resolve` and `meta` cases on `config-lenient.yaml` claim only Read, six similar ones claim Read and Validate, and §19.2
   lists uniqueness under Validate. The I1.11 demonstration also needs a configuration for vampiredb, which has none, and
   `--config` is planned for I2.1. (a) I1 reads `vmd`, `uniqueness` and `ignore`, and takes `--config`; §19.2 says that Read
   honors the uniqueness mode, and the six cases drop `validate`. (b) The five cases gain `validate`, I1 assumes strict, and the
   demonstration waits for I2.1. *Recommendation.* (a): the mode changes what an address means, and three keys are a few lines.
4. **BOM and invalid UTF-8 in JSON and YAML.** H3.13 covers Markdown only, `jsonc-parser` rejects a BOM and `yaml` accepts one
   (M), and the spec says nothing on invalid UTF-8. *Recommendation.* Skip a leading BOM in every format, as RFC 8259, section
   8.1, allows a JSON parser to (D); invalid UTF-8 is `syntax-error` at `""`; fixtures for both.
5. **Unicode data.** (a) The runtime only, with the probe; (b) generated tables for all of §6.3, NFC included; (c) tables for the
   properties and the lower-case mapping, NFC from the runtime. *Recommendation.* (c), which removes the runtime from the rule
   where versions differ most, at a small size; (b) if a runtime's NFC is ever found to differ.
6. **Address text.** H4.4 left open how a canonical address percent-encodes characters outside `step`. Also unstated: whether an
   exact path is decoded before it is split, and whether an index step may have leading zeros. *Recommendation.* Encode every code
   point outside `step` as UTF-8 with upper-case hex digits (RFC 3986, section 2.1), after RFC 6901's escapes in an exact path;
   decode an exact path before splitting, as RFC 6901, section 6, does, and a semantic path after; no leading zeros, as RFC 6901
   requires of indexes. Fixtures for each.
7. **The slug of a JSON or YAML section's title.** §6.3 starts from a heading's visible text, and a data title is a string. (a)
   Parse it as the content of an ATX heading, `## ` and the title; (b) as a paragraph's inline content. *Recommendation.* (a), so
   a section keeps its key across formats. It shows a gap in §5.8: a title that does not read back from `## ` and itself (one
   ending in ` #`, one with outer spaces, one holding an anchor element) should be not representable.
8. **GFM footnotes.** GFM 0.29 has none, and GitHub renders them. Under the pin, `[^1]: x.md` is a link reference definition, so a
   reference that `check` may report as dangling. *Recommendation.* Keep the pin, look for footnotes in vampiredb's docs during
   I1.11, and decide before I2.4.
9. **Hashing.** `crypto.subtle` is asynchronous and, in browsers, limited to secure contexts (D: MDN, `SubtleCrypto`); a small
   synchronous implementation is the alternative. *Recommendation.* `crypto.subtle`, since every read is asynchronous anyway.
10. **`ls` and unreadable records.** §12.2 asks `ls` to count records it could not read, which needs a parse of every record: a
    quarter to a third of a second per 700 KB of Markdown without the index (M). *Recommendation.* Parse and count in I1, measure
    on vampiredb in I1.11, and cache by file version from I2.5.
11. **A third package for the runner.** (a) A private `js/packages/conformance`; (b) a hidden `vmd` subcommand; (c) a Vitest suite
    in `cli`. *Recommendation.* (a), which keeps it out of the published command and lets it import `core` alone.
12. **Storage failures.** Appendix D has no code for a read the backend cannot complete, such as a permission error.
    *Recommendation.* An operation code `storage-failed`, added in the I1.7 pull request with its decision-log entry.
13. **The portable regex and linear time.** §11.4 says that excluding backreferences and lookaround makes matching linear
    everywhere. That holds for RE2, but JavaScript's and Python's engines backtrack, and `(a+)+$` needs neither feature to take
    exponential time. (a) `re2js`, a pure JavaScript port of RE2 (npm 2.8.6; U: licence, maintenance and speed not reviewed); (b)
    the JavaScript engine with a time limit per file; (c) only correct the wording. *Recommendation.* (a) if it holds up, with
    §11.4 corrected; otherwise (b) and (c).

---

## 10. Task order

Each task is its own pull request (plan §1.3).

| PR | Task | After | Done when |
|---|---|---|---|
| A | I1.10 runner (#19) | (none) | CI runs it; `selftest` passes, and fails when the comparison is broken on purpose; the versions check fires on an edited fixture; every other case is skipped with a reason |
| B | I1.1 values (#10), with `SourceText`, issues and `Outcome` | (none) | unit tests, property tests 1 and 5; RFC 8785's examples (U: its appendix of number samples); `gitBlobId` matches every entry of the suite's versions manifests; the Appendix D test |
| C | I1.2 JSON (#11) | B | the JSON cases of `values/` pass; property test 2; the guard list |
| D | I1.3 YAML (#12) | B | the YAML cases of `values/` pass; property test 3; the guard list |
| U | Unicode tables and probe (from I1.5) | B | tables committed; the version test and the comparison over every code point pass |
| G | I1.7 storage and filesystem backend (#16) | B | one contract test suite passes on both backends; versions equal `git hash-object` for clean, modified and untracked files in a temporary repository; the regex checker's cases |
| E | I1.4 Markdown (#13) | C, D | `markdown/` and the Markdown cases of `values/` pass; property test 4; the spans of question 1 in §5.9 and the decision log |
| F | I1.5 keys and anchors (#14) | E, U | `anchors/` passes, pending cases aside; property test 6 |
| H | I1.8 CLI foundation (#17) | G | store discovery, global options, question 3's configuration; tests of line output, `~tok`, limits, cursors, the §12.3 format and exit codes |
| I | I1.6 addresses and computed fields (#15) | F | `addresses/` and `meta` pass with the Read profile; property test 7 |
| J | I1.9 read commands (#18) | H, I | command tests over a fixture store for `ls`, `cat --lines`, `grep`, `outline --depth` and `get` with each option |
| K | I1.11 demonstration (#20) | all | `outline` and `get` over every vampiredb doc; every heading and block anchor resolves; `Minimal_Log.md` timed in #20; the CI guard |

A and B start together. After B, C, D, U and G run in parallel, and H follows G alongside E. E leads to F, then I; J and K close.

**Documents to update if this design is approved**, each in the pull request that applies it: plan §1.1 (the runner's package,
question 11); plan §1.2 (the four GFM 0.29 extensions, no front-matter extension); plan §3 (the configuration subset and
`--config` in I1, question 3; I1.7's wording on git versions, section 2.6); the proposal and the decision log (the answers to
questions 1, 2, 4, 6, 7, 12 and 13, and §19.2 for question 3); the conformance README (the runner's location).
