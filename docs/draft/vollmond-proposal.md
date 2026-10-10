# Vollmond MD (vmd): Records, Addresses, Queries and Storage

Status: Draft v0.7 (2026-10-10). Supersedes Draft v0.6 (commit `c3879b7`), Draft v0.5 (commit `d0d1424`), Draft v0.4 (commit
`1043a6c`), Draft v0.3 (commit `5b0819b`), Draft v0.2 (commit `5998461`) and Draft v0.1 (commit `b7c8a52`). The minor version
rises with each round of decisions applied to the draft. The review of v0.1 and every round of decisions since are in
[vollmond-proposal-review.md](vollmond-proposal-review.md).

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
- **Value view**: the JSON value of a record (§5). It holds only what the record stores. Schemas, queries and paths operate on it.
- **Computed field**: something vmd derives about a node (its key, canonical address, anchors, node version, source location,
  issues). It is not part of the data. A plain read leaves it out, a caller selects it by its `@` name, and it cannot be written
  (§5.10).
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
- **Issue**: an error or a warning, identified by a code from Appendix D. A structural error makes a record unreadable; a
  validation error leaves it readable (§9.2).
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

The value view uses the JSON data model, restricted as I-JSON (RFC 7493) restricts it, with one departure for noncharacters
(below):

| Type | Notes |
|---|---|
| null | |
| boolean | |
| string | valid Unicode (no unpaired surrogates; noncharacters allowed); not normalized |
| number | §4.2 |
| array | ordered |
| object | string keys, unique; **member order is not significant** |

**Member order is not part of the data model.** Two objects with the same members in a different order are equal, and a backend or
query engine may return members in any order. A backend that stores the original bytes keeps the original order with them
(§13.3), but nothing may depend on it: a result served from a covering index, or from a relational store, has no original order
to return. (MongoDB's documents went the other way, and queries that could be answered from an index still fetch the document to
return its fields in their stored order.) Order that matters is expressed with arrays, which is why sections are an array (§5.2).

Values outside this model are structural errors (§9.2): duplicate member names and unpaired surrogates in any format, numbers a
double cannot hold (§4.2), and in YAML `.inf` and `.nan`, non-string keys, anchors and aliases (an alias to an anchor that is not
defined included), merge keys, explicit tags, and multiple documents in one file. A YAML version other than 1.2 is an error of its
own (§4.4).

- **Surrogates.** A surrogate pair written as two escapes reads as the one character it encodes, in YAML (two `\u` escapes) as in
  JSON. YAML 1.2.2 (section 5.7) defines `\u` as a 16-bit escape and does not say that two of them combine, and the `yaml` package
  (2.9.1) combines them, so a reader that does not must combine the pair itself. A surrogate that is not part of a pair is
  `unpaired-surrogate`.
- **Noncharacters** (U+FDD0 to U+FDEF, and the last two code points of every plane, such as U+FFFF) are valid. Here vmd departs
  from I-JSON, whose section 2.1 says that member names and string values "MUST NOT include code points that identify Surrogates
  or Noncharacters". Noncharacters are Unicode scalar values, and Unicode Corrigendum #9 says that they "are not illegal in
  interchange nor do they cause ill-formed Unicode text" ([unicode.org/versions/corrigendum9.html](https://www.unicode.org/versions/corrigendum9.html),
  read on 2026-10-10), while a surrogate that is not part of a pair is not a character at all. YAML's character set leaves out
  U+FFFE and U+FFFF (YAML 1.2.2, section 5.1, production `c-printable`), so in a YAML file and in front matter those two must be
  written as escapes in a double-quoted string, and a raw one is a YAML syntax error (`syntax-error`). The other noncharacters may
  appear raw in YAML.
- **Merge keys.** A plain `<<` key is a merge key, whatever its value, and so an error. A quoted `"<<"` key is an ordinary
  member. YAML 1.1's merge type is recognized by its regular expression, `<<` ([yaml.org/type/merge.html](https://yaml.org/type/merge.html)),
  and implicit resolution by regular expression applies to plain scalars only, so a quoted `"<<"` is a string to YAML 1.1 readers
  too. The `yaml` package (2.9.1) reads it as an ordinary member, as measured for the value fixtures (#52).
- **Tags.** Every explicit tag is an error: a custom tag, a core schema tag such as `!!str` or `!!int`, and the non-specific tag
  `!` (YAML 1.2.2, section 6.9.1). Quoting already forces a string, and the value view cannot keep a tag.

### 4.2 Numbers

Numbers are where common JSON parsers disagree (Appendix B): JavaScript reads every number as an IEEE 754 double and silently
rounds integers beyond 2^53; Python keeps integers exact; Go's default decoder reads every number into a float64. The rules:

- A number's **meaning** is its nearest IEEE 754 double. `1`, `1.0` and `10e-1` are the same number, and so are `0.1` and
  `0.10000000000000001`, which a double cannot tell apart. `-0` is `0`. Integer-ness is a schema property (`type: integer`), as in
  JSON Schema, not a separate type.
- **Values are plain doubles.** The value view holds every number as a double, and equality, sorting, validation and node versions
  (§11.3) use that double. Integers within ±(2^53−1) are therefore exact.
- **Numbers a double cannot hold** are structural errors (`number-not-representable`, §9.2), so the record fails parse:
  - an integer by form whose double differs from it, such as `9007199254740993` or `12345678901234567890`. A number is an integer
    by form when its literal uses its format's integer syntax, with no fraction and no exponent. In JSON that is digits with an
    optional `-`, and in YAML also a leading `+` and the core schema's `0o` octal and `0x` hexadecimal forms. So
    `+9007199254740993` and `0x20000000000001` are errors too, while `1e23` and `9007199254740993.0` are not integers by form and
    mean their nearest doubles, like any fractional number;
  - a number too large for a double, such as `1e400`;
  - a non-zero number that a double rounds to zero, such as `1e-400`. (The smallest positive double is about 4.9e-324, which a
    shortest-form serializer prints as `5e-324`.)

  A fractional number with more digits than a double holds is not an error; it means its nearest double. Detecting the three
  errors needs each number's source text, which every parser in Appendix B can give. The hint of the error suggests writing the
  value as a string, which the logical types int64, bigint and decimal read (§4.3).
- **No rewriting.** A number the client did not change is never re-serialized. Its source text comes from the parser's offsets,
  and an edit splices only the changed span (§13.3), so `0.10000000000000001`, `1.50` and `0x1F` survive an edit elsewhere in the
  file. A YAML library's own writer is not used for unchanged nodes, since it rewrites numbers. The `yaml` package writes `0x1F`
  as `0x1f`, as the [parser survey](../research/parser-survey.md) measured.
- **Canonical form** for new values. The digits are the shortest that round-trip to the same double, and the notation depends
  only on the magnitude:
  - if |x| ≥ 2^53, or 0 < |x| < 10^-6, the number is written in exponent form, `d.ddd` then `e`, a sign and the exponent without
    leading zeros, with `.0` added to a mantissa of one digit: `1.152921504606847e+18` (2^60), `1.0e+20`, `2.5e-7`;
  - otherwise it is written without an exponent, as an integer when its value is one (`42`, `-7`) and as a decimal fraction
    otherwise (`0.5`, `123.456`, `0.000001`).

  No form has a leading `+`, a leading zero other than the single `0` of `0.5`, or a trailing `.0` outside the exponent form, and
  `-0` is written `0`. The lower threshold is the one at which JavaScript's `Number.prototype.toString` switches to exponent form,
  and the upper one is where integers stop being exact. Every integer-valued double of magnitude 2^53 or more is therefore in
  exponent form, which is not an integer by form, so vmd's own output always parses back to the same value, and a YAML 1.1 reader
  reads every form as a number (§4.4). YAML's `0o17` and `0x1F` are read as integers and written back in decimal. vmd writes int64
  and bigint values beyond ±(2^53−1) as strings (§4.3).

### 4.3 Standard logical types

Further types are declared in the schema with JSON Schema's `format` keyword, which OpenAPI also uses (`format: int64`). They are
stored as ordinary JSON strings or numbers in every representation, with a canonical lexical form, and the schema tells
comparisons, sorting and validation how to read them. These are on by default; vmd turns `format` from an annotation into an
assertion for them.

**The assertion accepts every form the type's lexical space allows, and the writer emits the canonical form.** The lexical space
is that of the standard the type refers to, as the table gives it, so a value another tool wrote in a valid but uncanonical form
is not an error.

| Type | Schema | Lexical space (accepted) | Canonical form (written) | Compares |
|---|---|---|---|---|
| date | `string`, `format: date` | RFC 3339 `full-date` | `2026-10-09` | chronologically (= as strings) |
| time | `string`, `format: time` | RFC 3339 `full-time`: fractional seconds, a leap second, any offset including `-00:00` | `08:00:00Z`, `08:00:00+02:00` | by instant within a day |
| date-time | `string`, `format: date-time` | RFC 3339 `date-time`, offset required | `2026-10-09T08:00:00Z` | by instant |
| local date-time | `string`, `format: local-date-time` | TOML 1.0.0's local date-time: an RFC 3339 `full-date`, `T`, `t` or a space, and an RFC 3339 `partial-time` with any number of fractional digits | `2026-10-09T08:00:00` | chronologically |
| duration | `string`, `format: duration` | the `duration` of RFC 3339 Appendix A | `PT10M`, `P3D`, upper case | by length; with months or years, only to equal values |
| int64 | `integer` or `string`, `format: int64` | a number whose value is an integer in [−2^63, 2^63−1], or a string matching `-?(0\|[1-9][0-9]*)` whose value is | a number within ±(2^53−1), otherwise a decimal string | exactly |
| bigint | `integer` or `string`, `format: bigint` | as int64, unbounded | as int64 | exactly |
| decimal | `string`, `format: decimal` | XML Schema 1.1's decimal: `(\+\|-)?([0-9]+(\.[0-9]*)?\|\.[0-9]+)` | `-?(0\|[1-9][0-9]*)(\.[0-9]+)?`: no exponent, no `+`, no leading zero | exactly |
| uri, uri-reference, email, uuid | as JSON Schema | as JSON Schema | as JSON Schema | as strings |

- **Dates and times** follow the ABNF of RFC 3339, section 5.6, which JSON Schema 2020-12 refers to (Validation, section
  7.3.1). ABNF strings are case-insensitive (RFC 5234, section 2.3), so `t`, `z` and `pt10m` are accepted, and the canonical form
  is upper case. The space that a note in RFC 3339, section 5.6, lets applications use between date and time is not part of the
  `date-time` production and is not accepted there. TOML's local date-time accepts it, as TOML 1.0.0 permits it for every
  date-time "for the sake of readability".
- **Leap seconds.** A seconds field of `60` is accepted only at 23:59 UTC, after the offset is applied, as Ajv's `ajv-formats`
  accepts it, so `23:59:60Z` and `01:59:60+02:00` are valid and `12:30:60Z` is not. A local date-time has no offset and is taken
  as UTC, as `ajv-formats`' lenient formats `iso-time` and `iso-date-time` take a missing offset as zero, so `23:59:60` is
  valid there. There is no table of leap seconds: the check does not ask whether a leap second was in fact inserted on that day.
  For comparison, `23:59:60` falls after `23:59:59` and before the next midnight.

  Ajv's `ajv-formats` agrees with this on leap seconds (the `time` check in
  [`src/formats.ts`](https://github.com/ajv-validator/ajv-formats/blob/master/src/formats.ts)), but it departs elsewhere: its
  `date-time` splits on `t` or any white space, so it accepts a space separator, and its `time` pattern accepts the offsets `+02`
  and `+0200`. Python's `jsonschema` checks `date-time` only when `rfc3339-validator` is installed, which then rejects `:60`
  altogether ([`rfc3339_validator.py`](https://github.com/naimetti/rfc3339-validator/blob/master/rfc3339_validator.py)). Both
  were read on 2026-10-10. Neither library's check can therefore be used unchanged, and vmd needs its own date and time checks
  (Appendix C).
- **Durations** are pinned to RFC 3339 Appendix A, the grammar JSON Schema's `duration` uses, rather than to the whole of ISO 8601.
  So `PT1.5S` (a fraction), `P1Y3D` and `PT1H30S` (a skipped unit) and `P1W2D` (weeks with days) are not durations, although ISO
  8601 allows them.
- **int64** is the signed 64-bit range, as the OpenAPI format registry defines it ("a signed 64-bit integer, with the range
  -9223372036854775808 through 9223372036854775807",
  [spec.openapis.org/registry/format/int64](https://spec.openapis.org/registry/format/int64.html), read on 2026-10-10). Both
  forms are accepted throughout the range, so `"42"` is valid. A number is a double (§4.2), and a number such as `1e3` or `1.0`
  whose value is an integer is accepted, as JSON Schema's `integer` accepts it. A string has no sign `+`, no leading zero and no
  white space, so `"+5"`, `"007"` and `" 42"` are not int64. The string `"-0"` is accepted and means zero, which the writer
  writes without the sign.
- **decimal** follows the lexical space of XML Schema 1.1's `decimal` (W3C XML Schema Definition Language 1.1 Part 2:
  Datatypes, section 3.3.3.1, [w3.org/TR/xmlschema11-2/#decimal](https://www.w3.org/TR/xmlschema11-2/#decimal), read on
  2026-10-10), whose regular expression the table gives. So `"+1"`, `".5"`, `"1."`, `"01"`, `"1.50"` and `"-0"` are all decimals,
  and an exponent, as in `"1e3"`, is not. XML applies its whitespace collapsing before the lexical space; vmd does not, so `" 1"`
  is not a decimal. The writer emits the form in the canonical column, mapping an accepted form to it by dropping a `+`,
  dropping leading zeros of the integer part (keeping one `0` before the point), adding `0` before a leading point, dropping a
  point with no digits after it, and writing `-0` as `0`: `+01.50` becomes `1.50`, `.5` becomes `0.5`, and `1.` becomes `1`.
  Trailing zeros are kept, since they can carry precision. That is where vmd's form differs from XML Schema's canonical
  representation, which drops them.

Without a schema, values are plain strings and numbers. VQL then compares strings as strings, which still orders canonical dates
and UTC date-times correctly.

The int64 rule follows Protocol Buffers' JSON mapping, which writes 64-bit integers as strings and reads either form, but writes
values within ±(2^53−1) as numbers, so that small values stay readable in YAML front matter.

### 4.4 Interoperating with YAML 1.1 readers

vmd reads YAML 1.2 with the core schema: no implicit dates, and `yes`, `no`, `on` and `off` are strings. A reader must not resolve
timestamps, which `ruamel.yaml` does even in its YAML 1.2 mode (parser survey, section 4.1). Many tools still read YAML 1.1 (PyYAML;
js-yaml's `YAML11_SCHEMA`, and its default schema before version 5; Ruby's Psych, used by Jekyll), where `answer: no` is the boolean
false, `2026-10-09` a date and `1:30` the number 90.

**The `%YAML` directive.** A `%YAML 1.2` directive is allowed. A directive naming any other version, in a YAML file or a
`yaml data` block, is a structural error (`yaml-version-unsupported`). Front matter cannot hold a directive: a directive must be
followed by a `---` directives end marker (YAML 1.2.2, section 9.1.5), which would close the front matter, so a `%YAML` line in
front matter is a `syntax-error`. Under `%YAML 1.1` the `yaml` package reads `a: yes` as `true`, `017` as 15 and `2026-10-09` as
a date (measured for the value fixtures, #52, with `yaml` 2.9.1), so reading the record as 1.2 would silently change what those values
mean to its author, and honoring the directive would make the value view depend on YAML 1.1. This departs from YAML 1.2.2
twice. Its section 6.8.1 says that a 1.2 processor "must also accept documents with an explicit `%YAML 1.1` directive" and
process them as 1.2 with warnings, and that a document naming a higher minor version, such as `%YAML 1.3`, should be processed
with a warning. vmd rejects both, since it cannot know what a later minor version changes.

**Compatibility quoting** is on by default. The serializer then quotes every string that a common YAML 1.1 or 1.2 reader takes for
something else:

- dates and date-times, such as `2026-10-09`, `2026-10-09T08:00:00Z` and `2026-10-09 08:00:00`;
- `yes`, `no`, `on`, `off`, `y`, `n`, `true` and `false`, in exactly the casings YAML 1.1 reads as booleans: `y`, `Y`, `n` and
  `N`, and for the others all lower case, an initial capital or all upper case (`yes`, `Yes`, `YES`), which is the regular
  expression of YAML 1.1's bool type ([yaml.org/type/bool.html](https://yaml.org/type/bool.html), read on 2026-10-10). Other
  casings, such as `tRuE` or `yEs`, are strings to every reader;
- YAML 1.1 numbers, such as `017`, `0b101`, `1_000` and `1:30`;
- YAML 1.2 numbers, such as `0o17`, `0x1F`, `1e3`, `.inf` and `.nan`;
- `null`, `Null`, `NULL`, `~` and the empty string, the casings of YAML 1.1's null type
  ([yaml.org/type/null.html](https://yaml.org/type/null.html));
- `<<` and `=`.

`vmd check` warns about every plain (unquoted) scalar that vmd reads as a string and that is on this list
(`yaml-ambiguous-string`). The warning for a mapping key goes on the mapping that holds it. A serializer cannot leave this to its
YAML library. The `yaml` package's default writer quotes none of the dates, none of the booleans, and none of `0b101`, `1_000` and
`1:30` (parser survey, section 4.1).

Numbers have the same problem the other way round. vmd's writer uses only number forms that a YAML 1.1 reader also reads as
numbers (§4.2), and `vmd check` warns about every plain scalar that vmd reads as a number and a YAML 1.1 reader reads otherwise
(`yaml-ambiguous-number`), such as `1e3` and `1e+3`, `017` (octal 15) or `0o17` (a string). PyYAML reads `1e3` and `1e+3` as
strings because its float resolver requires a dot and, in an exponent, a sign (the regular expression for
`tag:yaml.org,2002:float` in [`lib/yaml/resolver.py`](https://github.com/yaml/pyyaml/blob/main/lib/yaml/resolver.py), read on
2026-10-10).

Compatibility quoting is a setting (`yaml_quoting`, §9.1). A store whose files are read only by tools its users control may turn
it off explicitly, with `yaml_quoting: minimal`. The serializer then quotes only what YAML 1.2 would misread, and both warnings are
off too.

Further types can be added as extensions (§18).

---

## 5. The data model

### 5.1 Overview

Every record without a structural error (§9.2) parses to a **value view**: a JSON value (§4) whose root is a section. Schemas
validate the value view, queries filter it, and paths walk it. The mapping from each format is lossless. The order and repeats of
sections are kept, and converting a value to any format and back yields the same value (§5.8).

The value view holds only what the record stores. What vmd derives, such as a section's key (§5.5), is a computed field, which a
caller selects by name (§5.10).

**Line breaks.** In every format the value view reads a line break as `\n`, so a file with CRLF line endings and its copy with LF
have the same value view and the same node versions (§11.3). A `\r` written as an escape in a JSON or quoted YAML string is
content and stays. Edits keep the file's own line endings where the backend keeps the file (§13.3).

**Byte order marks.** A UTF-8 byte order mark at the first byte of a file is skipped, in every format, and it applies to the
whole file: there is at most one, at byte 0. JSON allows this (RFC 8259, section 8.1: parsers "MAY ignore the presence of a byte
order mark rather than treating it as an error"), and so does YAML (YAML 1.2.2, section 5.2). A U+FEFF anywhere else is not a
byte order mark but an ordinary character, where the format allows a character: in Markdown text, or in a JSON or quoted YAML
string. It is Default_Ignorable, so a derived anchor drops it (§6.3), and in Markdown it does not restart the detection of front
matter. Offsets into the file count from its first byte, the byte order mark included, but a byte order mark is not a column, so
the first character of line 1 is column 1 (§5.9). The rule covers every file vmd reads: records, `.vmd/config.yaml` and schemas.
A write keeps a file's byte order mark, and a file vmd creates has none (§13.3).

**U+FEFF in YAML.** In YAML, a U+FEFF is a `syntax-error` wherever YAML does not allow the character (outside quoted scalars:
in a plain or block scalar, a comment, or between tokens; YAML 1.2.2, section 5.4, where `nb-char` excludes it), and wherever
YAML would read it as a byte order mark other than at byte 0 of the file: at the start of front matter or of a `yaml data` block,
or at the start of a document (section 5.2). A U+FEFF inside a quoted scalar is an ordinary character. A reader cannot leave this
to the `yaml` package (2.9.1), which strips a leading U+FEFF from any text it is given and accepts one in a plain or block scalar,
in a comment, and at the start of a line after a comment line (measured on 2026-10-10).

**Lone CR.** A carriage return alone is a line break in Markdown and YAML (CommonMark 0.31.2, section 2.1; YAML 1.2.2, section
5.4, production `b-break`), and the value view reads it as `\n` too. The `yaml` package (2.9.1) does not treat a lone CR as a
line break and fails on a mapping written with CR line endings (measured on 2026-10-10), so a reader that uses it converts lone
CRs before parsing and maps offsets back.

### 5.2 Sections

A record and each of its sections have the same shape:

```
section = {
  "$schema":   any,          root only, optional: stored data that vmd does not interpret (§5.4)
  "$title":    string,       required for a section, optional for the root
  "$anchor":   string,       optional (§6.2)
  "$tags":     [string],     optional (§6.4)
  ...fields,                 any members whose names do not begin with "$"
  "$body":     string,       optional: prose
  "$sections": [section]     optional: child sections, in order
}
```

A section member of the wrong type is a structural error (`reserved-member-type`): a `$title`, `$body` or `$anchor` that is not a
string, `$tags` that is not an array of strings, or `$sections` that is not an array of objects. So is an item of `$sections`
without a `$title` (`section-title-missing`).

The members above are listed in the order the serializer writes them, and the CLI prints them, when it has no other order to keep;
the order carries no meaning (§4.1). A plain string is never a section: anything that is not an item of `$sections` is a field.
A section's key is not a member. It is derived (§5.5), and a caller selects it as the computed field `@key` (§5.10).

### 5.3 Markdown

[CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/) with the extensions of
[GitHub Flavored Markdown 0.29](https://github.github.com/gfm/) (tables, task lists, strikethrough, autolinks), the latest version
of the GFM specification (0.29-gfm, 2019-04-06, checked on 2026-10-10). A Markdown record maps to the value view as follows.

- **Front matter** is YAML between a delimiter line at the very start of the file and the next delimiter line. A delimiter line
  is exactly `---` at the start of a line, optionally followed by spaces or tabs, so an indented `---` inside a block scalar does
  not close it. A byte order mark at byte 0 is skipped (§5.1), so front matter after one still starts the file.
  Front matter without a closing delimiter is a structural error (`syntax-error` at the root), since reading it as a thematic
  break followed by prose would silently turn its fields into text. Its members are the root's fields, and empty front matter,
  or front matter holding only whitespace and comments, gives no fields. Front matter that holds something other than an object
  is `data-block-not-object` at the root. JSON is valid YAML 1.2, so a JSON object between the delimiters also works. GitHub
  renders front matter as a table ([GitHub blog, 2013-09-27](https://github.blog/news-insights/product-news/viewing-yaml-metadata-in-your-documents/)).
  Jekyll's form is close but wider: it also closes front matter with a `...` line (`YAML_FRONT_MATTER_REGEXP` in
  [`lib/jekyll/document.rb`](https://github.com/jekyll/jekyll/blob/master/lib/jekyll/document.rb), read on 2026-10-10), which
  vmd does not. Other front matter forms (Hugo's `+++` TOML, a bare JSON object) are not recognized: GitHub does not render
  them, and a fenced block at the start of a file is a code block to every common renderer. The root therefore uses `---` and
  sections use fences (below); the two never compete.
- **The title heading.** When the first block after the front matter is a level-1 heading and it is the record's only level-1
  heading, it is the root's heading: its text is the root's `$title`, and its anchor and tags are the root's. Otherwise the root
  has no `$title`, and every heading is a section. Headings inside container blocks (below) count for neither rule.
  `vmd check` warns about several level-1 headings outside container blocks (`multiple-h1`).
- **Sections.** Every other heading starts a section, which runs to the next heading of the same or a higher level. A section's
  parent is the nearest preceding heading of a lower level, or the root. Skipped levels are allowed.
- **A section's data block** is a fenced code block whose info string is `yaml data` or `json data`, placed immediately after the
  heading (only blank lines between). A `yaml data` block is read as YAML and a `json data` block as JSON, since the first word
  names the format. It must hold an object, whose members are the section's fields, and an empty block gives no fields. There is
  at most one. A fenced block anywhere else is prose. The first word of the info string keeps GitHub's syntax highlighting; the
  second marks the block as data rather than an example. The marker was chosen over two alternatives (the schema naming the
  sections that carry data, and the first YAML or JSON fence after a heading always being data): both turn ordinary examples into
  data, and the first makes a file's value depend on its collection.
- **Info strings.** The info string of a fence in a data block's place is split into words on spaces and tabs, and its words are
  compared case-sensitively with the source text, before the decoding of entity references and backslash escapes that CommonMark
  applies to info strings (CommonMark 0.31.2, section 4.5). So the marker is what the author typed, and `yaml&#32;data` is one
  word, a prose fence. Exactly the two words `yaml data` or `json data` make a data block. A fence whose second word is `data`
  and whose first word is not `yaml` or `json` (`toml data`, `YAML data`), or one that adds a third word to `yaml data` or
  `json data`, is a structural error (`feature-unsupported`), since a newer minor version may define it (§9.1).
- **Misplaced data blocks.** The root's fields come only from the front matter. These are structural errors
  (`data-block-misplaced`, §9.2): a data block right after the title heading, a data block that is the first block of a record
  without a title heading (after the front matter, if any), and a second data block right after a section's data block (only
  blank lines between). Each would otherwise be prose that looks like data, and its fields would vanish silently.
- **`$` members in front matter and data blocks.** A top-level member whose name begins with `$` is a structural error, with the
  split of §5.4: `dollar-member` for a section member (`$title`, `$anchor`, `$tags`, `$body`, `$sections`) and for `$key`, since
  a Markdown section's title, anchor, tags, body and children have their own syntax, and `feature-unsupported` for any other name,
  which may be a section member of a newer minor version (§9.1). `$schema` is the exception in front matter, where it is the root's
  `$schema` (§5.4); in a data block it is `dollar-member`, as below the root anywhere.
- **`$body`** is the text after the heading (and the data block) up to the first child heading. For a root without a title
  heading, it is the text after the front matter, or from the start of the file, up to the first heading. Leading blank lines and
  trailing whitespace are removed, where whitespace means spaces, tabs and line breaks only (the characters of a CommonMark blank
  line), so a trailing U+00A0 no-break space is content. A section or root with no text left has no `$body`: it is absent, never
  `""`. It is raw Markdown, not an AST.
- **`$title`** is the heading's inline Markdown source without a closing `#` sequence and without the `<a>` element that carries
  the anchor and tags (§6.2), then trimmed. The element is removed before trimming, so the space often written before it is not
  part of the title, and `## What was done <a id="done"></a>` and `## What was done<a id="done"></a>` have the same title. A
  setext heading of several lines (CommonMark 0.31.2, section 4.3), which a forgotten blank line also produces, has as its title
  its lines without their indentation, joined by `\n`. The serializer cannot write such a title (§5.8), so `vmd check` reports it
  (`not-representable`).
- **HTML in a heading.** Besides the anchor element, a heading may contain the inline elements `span`, `b`, `i`, `em`, `strong`,
  `code`, `kbd`, `sup` and `sub`, whose text counts as heading text (§6.3). Any other HTML in a heading is unsupported.
  `vmd check` reports it (`heading-html`, a warning by default). For the derived anchor (§6.3), its tags are removed and the text
  between them is kept, and an HTML comment is removed whole, so that every implementation derives the same anchor.
- **Container blocks are prose.** Headings and fences inside list items, block quotes and HTML blocks are part of `$body`. A list
  item has no key, so a data block inside one would have no unambiguous place in the tree, and fenced examples inside list items
  are common. Tables, lists and similar structures inside `$body` can be exposed later as views (§18).
- **`---` inside a body is not a data delimiter.** CommonMark reads it as a thematic break, or turns the line above it into a
  setext heading. Only the front matter, at the start of the file, uses `---`.

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
      "$title": "What is confirmed",
      "runs": ["R0007", "R0009"],
      "$body": "The flusher waits on a barrier that never completes."
    }
  ]
}
```

The section's key, `what-is-confirmed`, is a computed field, `@key` (§5.5, §5.10).

### 5.4 JSON and YAML

A JSON or YAML record's value view is the parsed data, whose root must be an object (`root-not-object` otherwise). An empty YAML
file, or one holding only whitespace and comments, is the empty record `{}`, as an empty Markdown file is. An empty JSON file is a
syntax error, since it is not JSON.

The section members apply to the root object and to items of `$sections`. On a section, a member whose name begins with `$` and
that is not a section member (§5.2) is a structural error. It is `dollar-member` for `$key` and for a section member out of its
place (`$schema` below the root), and `feature-unsupported` for any other name, which may be a section member of a newer minor
version (§9.1). Inside a field's value, three such members are vmd
syntax and every other one is data:

- `$anchor` and `$tags` label the object that holds them (§6),
- `$ref` forms a reference object (§8.1),
- any other member whose name begins with `$` is an ordinary member. The record stays readable whatever the schema says, and a
  schema that does not allow the member reports it as a `schema-violation`.

Whether a record is readable therefore never depends on its schema.

**`$schema` on the root** is allowed, so that a plain JSON or YAML file that names its JSON Schema for editors, as in
`"$schema": "https://..."`, stays a readable record. It is stored data. It stays in the value view, vmd neither interprets it nor
uses it to validate, and a collection's schema may constrain it like any field. It is not allowed on other sections.

A section's key is derived, not stored (§5.5). A `$key` member is not part of the section shape, so on a section, in a file or in
a value given to a write, it is a `$` member where none is allowed. Reads never return one, so a value read and written back is
safe. To set a section's key, give it an `$anchor`.

### 5.5 Section keys

A section's **key** is its `$anchor` if it has one, and otherwise the slug of its `$title`, as steps 1 to 6 of §6.3 compute it,
without the repeat suffix of step 7. A heading whose slug is empty has the empty key. The key is derived and never stored, and it
is not a member of the value view. It is the computed field `@key` (§5.10), which a read returns on request,
schemas name in `x-vmd-list` (§9.3) and VQL matches (§10.3).

### 5.6 Keyed lists

A keyed list is an array whose items are identified by a key, so that a semantic path (§7.3) can select an item by name.
`$sections` is a keyed list by definition, keyed by the section key (§5.5). Any other array becomes one when its schema declares
it with `x-vmd-list` (§9.3), modeled on Kubernetes' `x-kubernetes-list-type: map` and `x-kubernetes-list-map-keys`:

```yaml
benchmarks:
  type: array
  x-vmd-list: { type: map, keys: [name] }
```

With that schema, `#benchmarks/append-4k/p99_us` selects the `p99_us` field of the item whose `name` is `append-4k`. Without a
schema, data items are reachable by their `$anchor`, by index steps (§7.3), as in `#links/1`, and by exact paths. Resolution
therefore depends on the schema, which is accepted: queries and validation depend on it anyway, exact paths never do, and the
index records every reference's resolved exact path, so `vmd check` reports a reference whose target moved after a schema change.

### 5.7 Uniqueness

- **One namespace per level.** In a section, field names and child section keys share one namespace. A front-matter `status` and
  a `## Status` section are therefore duplicates, just as two `## Notes` sections are. In a keyed list, the item keys form the
  namespace.
- **Declared per list.** `x-vmd-list: {type: map}` requires unique keys; `type: multimap` allows repeats. The same keyword on
  `$sections` declares whether a record's sections may repeat.
- **A store default** covers every level a schema does not declare; a duplicate at a level the schema declares `type: map` is an
  error in either mode. The default is `strict` unless `.vmd/config.yaml` says otherwise:
  - `strict`: duplicates are validation errors (`duplicate-key`), so every semantic step is unique in valid data. A record that
    holds duplicates anyway still reads, and a singular address through one fails as ambiguous where it is used (§7.4).
  - `lenient`: duplicates are warnings. A singular address that hits a duplicate fails as `ambiguous` where it is used, and a
    selector takes all matches.
- **No "first occurrence wins".** A reference that silently retargets when someone inserts an earlier duplicate is the failure
  strict mode exists to prevent. Derived anchors (`#notes`, then `#notes-1`) are unique by construction and still apply
  (§6.3). Escape hatches for ingesting data that cannot be cleaned up may be added later; they are not normal operation.

### 5.8 Round trips and representability

- **Markdown to the value view is lossless**: every Markdown record without a structural error (§9.2) has a value view, and it
  keeps the order and repeats of sections, which are array items. The order of front matter and data block members is
  presentation (§4.1).
- **The value view to Markdown** is total for every value that meets these conditions; the serializer rejects any other value
  with an error naming the path:
  - every item of `$sections` is an object with a non-empty `$title`, and every `$title`, the root's included, is a single line;
  - a `$body` is not empty, has no leading blank lines, no trailing whitespace (spaces, tabs and line breaks, §5.3), no line that
    would parse as a heading outside a container block, and does not begin with a `yaml data` or `json data` fence. An empty
    `$body` is refused because Markdown cannot tell it from an absent one, which is how a section without text reads (§5.3);
  - sections nest no deeper than heading level 6 allows (five levels below a root title, six without one);
  - the root has `$anchor` or `$tags` only if it has a `$title`.

  A root with nothing to write in front matter (no fields and no `$schema`) and no `$title`, whose `$body` begins with a
  delimiter line (§5.3), is written with empty front matter (a `---` line and a second one) before the body, so that the body's
  first line is not read as the start of front matter.
- **Every value converts to JSON and YAML.**
- **The guarantee**: for every representable value `v` and every format `f`, `parse(serialize(v, f)) == v`, where `==` is JSON
  value equality: numbers by value (§4.2), arrays in order, objects regardless of member order. Each implementation tests it as a
  property in its own tests, with integer-valued doubles beyond ±(2^53−1), such as 2^60, among the generated values, since the
  writer must put them in a form that is not read back as an integer (§4.2). The conformance suite holds example round trips and
  values that are not representable, under the Write profile (§19.2).
- **Byte fidelity comes from editing, not from conversion.** Edits splice the source of the changed node and leave every other
  byte alone (§13.3). A conversion between formats keeps the value but not presentation: blank lines, YAML comments, quoting
  style, link reference definitions.

### 5.9 Source maps

A node's identity is its path. Positions in a source file are not part of the data model. They are an optional **source map** that
file-based parsers produce, giving each node its byte range and line and column. A node's range covers exactly the bytes that
`get` returns for it in the source form (§5.10). Which bytes that is for each kind of node (a section and the blank lines after it,
a front-matter field and its key) is specified together with the Markdown parser, in implementation task I1.4. The library uses the
source map to:

- splice edits without reformatting the rest of the file (§13.3),
- report `line:col` in errors (§12.3),
- print a node's exact source (§5.10),
- locate references inside prose. A link inside a `$body` or a `$title` is not a node; its position is (the node's path, an offset
  into that string), which a backend without files can use too.

A backend that does not store files produces the source view by serializing, and reports errors by path alone. Byte and line
ranges of whole files remain part of the storage contract (`read`, §11.2).

**Units.** Every position in vmd uses the same units: source maps, offsets into a `$body` or `$title`, block anchor ranges (§6.2),
the `refs` and `issues` tables (§14.2), and error locations (§12.3). Offsets count UTF-8 bytes from 0, and a range is half-open,
`[start, end)`, excluding its end. Lines count from 1, and columns count code points from 1; a byte order mark is not a column
(§5.1). An offset into a `$body` or `$title`
counts the bytes of the value, after line breaks are read as `\n` (§5.1); a source map range counts the bytes of the file, from
its first byte, a byte order mark included (§5.1). Clients that need other units, such as JavaScript's UTF-16 string indexes,
convert.

### 5.10 Reading a node

An address picks a node, and the reader picks the form:

| Form | Returns | For a Markdown section |
|---|---|---|
| source (CLI default) | the node in its record's format: its source span, or its serialization | the heading line and everything under it |
| value (`--value`) | the node's value view as JSON | the section object |
| body (`--body`) | `$body` only | the prose |
| outline (`outline`) | the subtree's keys, titles and sizes, without content | |

The CLI defaults to source because a Markdown section is shortest, and easiest to read, as Markdown; JSON would escape every
newline. Programs default to the value.

**Computed fields.** What vmd derives about a node is not part of its data. Like `rowid` in some SQL databases, a computed field
is not in a plain read, as `rowid` is not in `SELECT *`, and it cannot be written, but a caller can select it by name. So a plain
read returns the stored value only, and a value read and written back is exactly what the record stores. A caller that needs more,
such as a validating reader or a writer that needs the version token, requests computed fields by name, either with the read or
later by address. The names are those of VQL's pseudo-fields (§10.3), so requesting a field with a read and selecting it in a
query are one concept.

| Field | Value |
|---|---|
| `@path` | the record's store path |
| `@at` | the node's exact path (§7.2) |
| `@address` | the node's canonical address (§7.5) |
| `@key` | the node's key within its parent: the section key (§5.5) for a section, and otherwise its member name, keyed-list key or index. The root has none, and the field is then absent |
| `@anchors` | every anchor that names the node, each as `{"name": ..., "kind": ...}` with the kind `explicit`, `derived` (§6.3) or `block` (§6.2) |
| `@version` | the node version (§11.3) |
| `@source` | where a source map exists (§5.9), the node's byte `range` in the file and the `line` and `col` where it starts |
| `@range` | for a block anchor, the byte range in the `$body` that `@at` names (§6.2) |
| `@issues` | the issues attached to the node, each with its `code`, `severity`, `at` and `message` (Appendix D) |
| `@refs` | the references the node contains, each with its raw text and resolved address (§8) |
| `@collection` | the record's collection (§9.1) |
| `@depth` | a section's depth, 0 for the root |
| `@nodes` | for a section, on request only: an object from the exact path of each section below it to the same requested fields of that section, so that one read of a record gives every section's key |

A read that requests computed fields returns the value and the requested fields side by side. `meta: all` requests every field
except `@nodes`, which is requested by name on top of it. For the second section of the ticket in Appendix A, with
`vmd get tickets/0171-clean-root-in-scattered-record.md#done --meta all --json` (the version and the source location are
illustrative):

```json
{
  "value": {
    "$title": "What was done",
    "$anchor": "done",
    "$tags": ["decision"],
    "$body": "Recovery of a clean root makes the record contiguous. See\n[§4.6](https://github.com/...#contiguous-at-rest)."
  },
  "meta": {
    "@path": "tickets/0171-clean-root-in-scattered-record.md",
    "@at": "/$sections/1",
    "@address": "#done",
    "@key": "done",
    "@anchors": [{ "name": "done", "kind": "explicit" }, { "name": "what-was-done", "kind": "derived" }],
    "@version": "5d41a8c2e07f9b63",
    "@source": { "range": [398, 616], "line": 18, "col": 1 },
    "@issues": [],
    "@refs": [],
    "@collection": "tickets",
    "@depth": 1
  }
}
```

The library's `get(address, {meta: [...]})` takes the same names. A caller that read the value earlier requests fields later by
address, with `{value: false}` in the library or `--meta F,.. --no-value` in the CLI, and gets the `meta` object alone. A writer
needs no extra round trip for the version token. It requests `@version` with its read, and every write returns the new versions
(§13.2), so edits can follow one another without reading again.

---

## 6. Anchors and tags

### 6.1 Purpose

An **anchor** names one node, independent of where it sits, and is unique within its record. Explicit anchors (§6.2), on headings,
objects and blocks alike, and derived anchors (§6.3) share one namespace per record. When an anchor of one node equals an anchor
of a different node, of either kind, the two are a duplicate anchor (`duplicate-anchor`), an error under the strict default and
a warning under `lenient` (§5.7). References should use explicit anchors to be stable. A **tag** labels any number of nodes,
for selection. The two follow HTML's `id` (unique, `#id` selects one element) and `class` (repeatable, `.class` selects a set).

### 6.2 Explicit anchors and tags

| Where | Syntax | Labels |
|---|---|---|
| Markdown heading | `## What was done<a id="done" class="decision review"></a>` | the section (or the root, on the title heading) |
| Markdown block | `- <a id="room"></a>**Room.** ...`, at the start of a list item outside block quotes, or of a paragraph at the top level of the `$body` | the block |
| JSON / YAML object | `"$anchor": "done"`, `"$tags": ["decision", "review"]` | the object |

- An anchor name matches `[A-Za-z][A-Za-z0-9_-]*`; so does a tag. Another name is a validation error (`anchor-invalid`).
- In Markdown, the `<a>` element goes at the end of the heading; the parser accepts it anywhere in the heading line. It has no
  content and no attributes besides `id` and `class`. An `<a>` element with an `id` or a `class` is an anchor element, and one
  that also has content or another attribute is a structural error (`anchor-element-invalid`). An `<a>` element with neither, such
  as a link, is other HTML (§5.3). A heading holds at most one anchor element, since `$anchor` holds one name, and a second one is
  a structural error (`anchor-element-invalid`). The element is not part of the heading's title, and it is removed before the
  title is trimmed (§5.3), so a space before it changes neither the title nor the derived anchor. The serializer writes it
  directly after the title, without a space. GitHub keeps `id` working as a link target; other renderers treat it as plain HTML.
- Tags are written as HTML's `class` in Markdown, and as `$tags` in data, where `$class` or `$type` would clash with the names
  serialization frameworks commonly use. A `class` attribute gives as `$tags` its tokens, split on ASCII white space as HTML splits
  a set of space-separated tokens ([HTML Living Standard, section 2.3.7](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#set-of-space-separated-tokens)),
  in source order. A repeated token is kept once, at its first place, and `vmd check` warns about it (`duplicate-tag`), since a
  tag labels a node at most once. A tag repeated in a data `$tags` array gets the same warning, but the value is kept as written:
  `$tags` is stored data there, while a `class` attribute is parsed.
- A **block anchor** names a paragraph or list item inside a `$body`. It is not a member of the value view: it resolves to a range
  of the `$body` text, in UTF-8 bytes (§5.9), which `get` returns and which body edits change. Which bytes the range covers is
  specified with the Markdown parser, in implementation task I1.4, as the spans of source maps are (§5.9). An issue on a block
  anchor is attached to the `$body` that holds it. A block cannot carry tags.
- **Where a block anchor goes.** An anchor element is a block anchor at the start of any list item outside block quotes, at any
  depth of list nesting, and at the start of a paragraph only at the top level of the `$body`. Block quotes stay prose (§5.3), so
  a list item inside one carries no block anchor. Two anchor elements at the start of one block are a structural error
  (`anchor-element-invalid`), as in a heading. An `<a id>` anywhere else in a `$body` is plain inline HTML and anchors nothing: in
  the middle of a paragraph, at the start of a paragraph or a list item inside a block quote, at the start of a paragraph inside a
  list item (a list item's second paragraph, for example), or in an HTML block. `vmd check` warns about it
  (`anchor-element-ignored`), since its author probably meant an anchor.

### 6.3 Derived anchors

Every Markdown heading that is a section (§5.3), and the title heading, also has a **derived anchor**, computed by vmd's own rule.
The rule is part of the format. It is not GitHub's rule, although the two agree for most headings, and vmd does not follow changes
to GitHub's. A change to vmd's rule needs a new version of this specification, with warnings first and a migration.

The derived anchor is computed in seven steps. Steps 1 to 6 give the heading's **slug**, and step 7 makes it unique:

1. **Visible text.** Remove the `<a id ...>` element (§6.2), and take the text a reader sees: the text of a link but never its
   URL, the content of a code span, character references decoded, backslash escapes resolved, emphasis delimiters removed, the text
   inside HTML elements without their tags, whether supported or not (§5.3), nothing from an HTML comment, and nothing from an
   image. A soft or a hard line break, as in a setext heading of several lines, contributes a line feed, which is white space, so
   steps 5 and 6 turn it into a hyphen. A `<br>` element contributes nothing, as every tag does.
2. **Normalize.** Remove every Default_Ignorable_Code_Point character (zero-width joiners, variation selectors, soft hyphens and
   the like), then normalize to NFC. Removing first means that an invisible character cannot keep two headings that look the
   same apart: `e`, U+FE0F, U+0301 gives `é` (U+00E9), as `é` does.
3. **Lower-case** each code point by Unicode's default lower-case mapping, one code point at a time, with no locale and no context
   rules. That is the unconditional mapping of `SpecialCasing.txt` where there is one, and otherwise that of `UnicodeData.txt`, so
   Greek final sigma is not special. The conformance suite pins the Unicode version.
4. **Trim** White_Space characters at both ends. White_Space is the Unicode property, which includes U+0085 (next line); this
   is not JavaScript's `String.prototype.trim`, which leaves U+0085 in place.
5. **Filter.** Map every White_Space character to a space (U+0020). Keep spaces, letters (general category L), marks (M), decimal
   digits (Nd), connector punctuation (Pc) and `-`, and remove every other character.
6. **Hyphenate.** Replace each space with `-`. Hyphens are not collapsed, and not trimmed further.
7. **Repeats.** In document order, a heading's candidate is its slug if that string is not yet used, and otherwise the slug
   followed by `-n`, for the smallest n of 1 or more that gives an unused string. Candidates of earlier headings count as used, so
   `Foo`, `Foo`, `Foo-1` give `foo`, `foo-1`, `foo-1-1`. Only headings that are vmd sections (and the title heading) take part.
   Headings inside container blocks and HTML blocks (§5.3) do not. Explicit anchors take no part in the numbering (a collision with
   one is a duplicate anchor, §6.1).

The candidate is the heading's derived anchor. A heading whose slug is empty has no derived anchor, but its candidate (`""`, then
`-1`, and so on) still counts as used. For example, `## What was done <a id="done"></a>` gives `what-was-done`, with or without
the space, `## A [link](x.md) &amp; more` gives `a-link--more`, and `## Größe` gives `größe`.

Derived anchors make links such as `file.md#what-is-confirmed` work with no markup, in vmd and, for most headings, on GitHub. They
change when the title changes; renaming through vmd rewrites references (§13.4), and `vmd check` detects a retitle made with plain
tools (§13.5). `vmd check` therefore warns about a reference that reaches its target through a derived anchor
(`ref-derived-anchor`). A reference through a derived anchor whose slug is repeated in the record gets `ref-derived-repeat`
instead. That covers the unsuffixed anchor and the suffixed ones alike (`#notes` and `#notes-1`, while two `## Notes` exist), since
inserting, removing or retitling one of those headings renumbers the others (§13.4). A store used as a database can require
explicit anchors in its typed references (`x-vmd-ref` with `anchors: explicit`, §9.3).

Derived anchors exist only for Markdown headings. JSON and YAML have no headings, so their objects have only explicit anchors.

### 6.4 Tags

Tags select sets of nodes in VQL (`@tags:decision`, §10.3). Addresses do not select by tag. A selector language for addresses,
with conditions and projections, is a design topic of its own ([#47](https://github.com/nosferatech/vollmond/issues/47)). Until
it lands, a reference declared to have several targets (`cardinality: many`, §9.3) lists them, and a tag never resolves an
address.

---

## 7. Addresses

### 7.1 Grammar

```
address   = record-ref [ "#" [ fragment ] ]      ; no fragment, or an empty one, is the root
fragment  = exact / semantic
exact     = 1*( "/" reference-token )            ; RFC 6901 JSON Pointer
semantic  = step *( "/" step )
step      = 1*( pchar / "?" )                      ; RFC 3986 fragment characters except "/"
```

- **record-ref** is a store path in the API and CLI (`tickets/0171-x.md`), and a URI reference inside a record (§8.2).
- **No fragment, or `#` alone**, is the record's root. Note that `#/` is not the root: as a JSON Pointer it is the member whose
  name is the empty string.
- Characters outside `step` (a space in a field name, for example) are percent-encoded, as in any URI fragment. The CLI also
  accepts them raw.
- **How vmd writes an address.** A canonical address (§7.5) percent-encodes exactly the characters that RFC 3986 does not allow
  in a fragment, which holds `pchar`, `/` and `?` (section 3.5), plus `/` inside a step and `%`. Each is written as the UTF-8
  bytes of the character in upper-case hexadecimal (`%C3%A9` for `é`). A field named `name with space` is
  `#name%20with%20space`, one named `a/b` is `#a%2Fb`, and one named `x:y` stays `#x:y`. An exact path writes `~` and `/` inside
  a token as `~0` and `~1` first, as RFC 6901 requires, and then applies the same encoding. `step` accepts every fragment
  character except `/`, so that every canonical address matches the grammar.
- **How vmd reads an address.** An exact path is percent-decoded first and then split at `/` into reference tokens, as RFC 6901,
  section 6, specifies for a JSON Pointer in a URI fragment, so `#/a%2Fb` is the pointer `/a/b`, member `b` of member `a`. A
  semantic path is split at `/` first and each step is then decoded, so `#a%2Fb` is the one step `a/b`.

### 7.2 Exact paths

An exact path is an RFC 6901 JSON Pointer over the value view, with its standard meaning: `#/$sections/1/$body`,
`#/benchmarks/0/p99_us`. It reaches every node, needs no schema, and always resolves to at most one node. It is unstable: inserting
an earlier section changes the index. Tools use exact paths internally, and the index records every reference's exact target.

### 7.3 Semantic paths

A semantic path is a sequence of keys. Each step matches, in the current node:

- in a section: a field with that name, or a child section with that key (§5.5; one namespace, §5.7), or one of the section
  members `$title`, `$body`, `$sections`, `$anchor` and `$tags` (§5.2), and at the root also `$schema` (§5.4);
- in an object: the member with that name;
- in a keyed list: the item with that key. An index never matches an item of a keyed list, so `#$sections/0` matches nothing; the
  exact path (§7.2), `#/$sections/0`, reaches an item by position;
- in an array that is not a keyed list: the item at that decimal index.

The **first step** may also match a record-wide anchor: an explicit anchor, or a derived one (§6.3). A plain link such as
`file.md#what-is-confirmed` therefore reaches a heading at any depth. If the first step matches both a root member and the anchor
of a different node, the address is ambiguous.

| Address | Resolves to |
|---|---|
| `tickets/0171-x.md` | the record |
| `tickets/0171-x.md#status` | the `status` field |
| `tickets/0171-x.md#what-is-confirmed` | the section, by its key or its derived anchor |
| `tickets/0171-x.md#what-is-confirmed/$body` | its prose |
| `tickets/0171-x.md#done` | the node anchored `done`, at any depth |
| `tickets/0171-x.md#done/$tags` | that node's tags |
| `docs/design/Minimal_Log.md#room` | the block anchored `room` |
| `perf/runs/R0007.yaml#benchmarks/append-4k/p99_us` | a field of a keyed-list item (§5.6) |

### 7.4 Cardinality

An address is **singular** when it must resolve to exactly one node: every reference, and the target of every write. It is valid
only if each of its steps crosses a level whose keys are unique, by declaration (`type: map`) or by the strict default. The checker
proves this from the schema before evaluating anything, for the levels the address crosses (`address-not-singular` otherwise).

The proof cannot cover three cases, so a singular address can still fail as ambiguous when it is evaluated, in exactly these:

- in `lenient` mode, where a level the schema does not declare may hold duplicates (§5.7);
- when its first step matches both a root member and the anchor of a different node (§7.3);
- when the data breaks a uniqueness the proof relies on: repeated sibling keys that the strict default forbids, a duplicate at
  a level declared `type: map`, or an anchor that names more than one node (§6.1). Such a record still reads, with a
  `duplicate-key` or `duplicate-anchor` validation error, in either uniqueness mode (§5.7), and an address through the
  duplicate is ambiguous.

A **selector** may resolve to several nodes: a semantic path through a `multimap` level, or a query. Selectors are used by
queries and by references declared `cardinality: many`, and never as write targets. A selector returns every match, also in the
three cases above, where a singular address would be ambiguous. A selector that matches nothing gives an empty result, not a
failure.

A singular address that matches more than one node fails as ambiguous (`address-ambiguous`, or `ref-ambiguous` for a reference),
and the error lists each match's exact path and, for headings, its derived anchor. One that matches nothing fails as
`address-not-found` (`ref-dangling` for a reference). An address whose record does not exist is `address-not-found` too, used
as a singular address or as a selector.

### 7.5 Canonical addresses

Wherever vmd prints a node (query results, `outline`, `refs`, errors), it uses the node's **canonical address**. The root's is
always `""`, the record with no fragment (§7.1), even when its title heading has an explicit anchor. For every other node, the
forms below are tried in order, and the first that gives a singular address for the node wins. A form gives one when, used as a
singular address (§7.4), it resolves to that node and to no other: the checker proves it singular, and its evaluation is not
ambiguous.

1. The node's explicit anchor: `#done`.
2. A semantic path whose first step is the explicit anchor of the nearest ancestor that has one, or that starts at the root
   when no ancestor has one: `#done/notes`, `#what-is-confirmed`. The root never counts as an anchored ancestor, so a root field
   is `#status` whatever the title heading carries.
3. The node's derived anchor (§6.3), such as `#notes-1`. It is reached when the path of form 2 is not singular (§7.4: a level that
   allows repeats by `multimap` or `lenient`, a first step that also matches another node's anchor, or data that breaks a
   uniqueness the proof relies on: repeated sibling keys, a duplicate at a `type: map` level, or an anchor that names more than
   one node). It identifies the node today, but a reference written with it gets
   `ref-derived-repeat` or `ref-derived-anchor` (§6.3).
4. The exact path (§7.2), such as `#/$sections/2`. It is also the canonical address of a node that no step can name, such as a
   member whose name is empty or a section whose key is empty (§5.5).

The order puts the most stable form first. An explicit anchor survives moves and retitles, a path from an anchored ancestor
survives everything above that ancestor, and a derived anchor survives everything but a retitle or a change of the repeats. The
exact path is the most precise form and always singular, but any insertion before the node breaks it, so it is the last resort.
The order is not by length: `#owner-of-record/name`, by form 2, wins over a shorter `#o/name`. A stable reference needs an
explicit anchor on the node.

A canonical address is written with the percent-encoding of §7.1. The exact path is always available as the computed field
`@at` (§5.10).

### 7.6 Shorthands (CLI only)

- `collection:key`, such as `tickets:171`, names a record by its collection key (§9.1).
- A path without its extension resolves when exactly one record matches.

Shorthands are never written into records.

---

## 8. References

### 8.1 Forms

| Context | Form | Example |
|---|---|---|
| Markdown | an inline link, or a link reference definition, wherever Markdown text appears: in a `$body` or a `$title`, in every format | `[§11.4](../design/Minimal_Log.md#tail-and-flusher)` |
| JSON / YAML | an object whose only member is `$ref` (JSON Reference) | `{"$ref": "../persons/ada.yaml#contact"}` |
| JSON / YAML, typed | a string whose schema has `format: uri-reference` and `x-vmd-ref` (§9.3) | `parent: 0158-implement-the-v3-log.md` |

A `$ref` object with other members, or whose `$ref` is not a string, is a structural error (`ref-malformed`), so references are
detectable without a schema. Wikilinks are not supported: GitHub does not render them. A link inside an HTML comment is not a
reference, since CommonMark reads a comment as an HTML block or as inline raw HTML, which binds more tightly than link brackets
([CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), sections 4.6, 6.3 and 6.6). Commenting a link out therefore removes
it from validation.

### 8.2 Resolving targets

The target is a URI reference, resolved by RFC 3986 against the citing record's path:

- **Relative**, `../design/x.md#a`, is relative to the citing file. It works on GitHub, in editors and on any filesystem, and is
  the recommended form.
- **Store-root**, `/docs/design/x.md#a`, is resolved against the store root. GitHub resolves it against the repository root; some
  local previewers do not.
- **Inside the store**, a target that is a record must resolve as a singular address (§7.4), unless the schema declares
  `cardinality: many`. The record part of a reference is always singular, so a reference declared `cardinality: many` whose
  record does not exist is dangling too (`ref-dangling`). A target that is an asset or a directory must exist.
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
target (as vampiredb's section numbers are), are deferred; their syntax is open (open question 3).

### 8.5 Status

Each reference inside the store resolves to one of `ok`, `dangling` (no target, `ref-dangling`), `ambiguous` (several targets for
a singular reference, `ref-ambiguous`), `aliased` (resolved through an alias, §13.6, `ref-aliased`), or `unreadable` (into a
record that has a structural error, `ref-target-unreadable`). A reference declared
`cardinality: many` whose selector matches nothing, in a record that exists, is valid. It is `ok`, with no targets. A reference
into a record that has a structural error cannot be resolved below the root, since that record has no value view. It is not
dangling but `unreadable`: `vmd check` warns about it (`ref-target-unreadable`), and the record's own structural errors say what
to fix. A reference whose address is the record's root (no fragment, or `#` alone, §7.1) names the record, which exists, so it is
`ok`. Resolving that same root address as an address (§7.4) still fails, since a resolve returns the node's value, while a
reference's status only says whether its target exists.

---

## 9. Collections, schemas and validation

### 9.1 Configuration

`.vmd/config.yaml`:

```yaml
vmd: 1                                       # the format version; the only required member
uniqueness: strict                           # or lenient (§5.7)
yaml_quoting: compatible                     # or minimal (§4.4)
issues:                                      # severities by issue code (Appendix D)
  heading-html: error
  ref-derived-anchor: "off"
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
checked. A collection whose schema file is missing, or is not a valid schema, is an error (`schema-invalid`).

- **Only `vmd` is required.** A `.vmd/config.yaml` holding only `vmd: 1` is a valid store, with strict uniqueness, compatibility
  quoting, every issue at its default severity, no collections and nothing ignored. A configuration without `vmd`, or that is not
  valid, is an error (`config-invalid`).
- **`vmd` is the store's format version**, major version `1` for this specification. Three versions meet, those of the data, of
  the reader and of the writer. A store can move to version 2.2 while a 2.1 reader reads its data without any warning,
  as long as the data uses no 2.2 feature.
  - **Minor versions only add.** A minor version never changes the meaning of existing syntax. A change to the slug rule, to
    number parsing or to how a block is read is a major version change, and so is any change after which a reader of the previous
    minor version cannot read, or misreads, data that a newer writer wrote at the older compatibility level.
  - **Every addition is detectable.** Each feature that a minor version adds must take a form that an older reader rejects rather
    than misreads, so that the older reader fails instead of returning a wrong value. This is the design rule that makes the model
    work. vmd's strictness supplies it, since an unknown `$` member on a section, in front matter or in a data block (§5.3, §5.4),
    an unknown `data` info string after a heading (§5.3) and an unknown `x-vmd-*` keyword in a schema (§9.3) are errors. An
    addition qualifies only as one of those forms, a new section member beginning with `$`, a new `data` info string or a new
    `x-vmd-*` keyword.
  - **A reader decides from the features the data uses**, not from the version number the store declares. A store that declares a
    newer minor version gives no warning. Data that uses a feature the reader does not know is an error (`feature-unsupported`),
    whose message says that the construct may come from a newer version, and names the store's declared version when the store
    declares one.
  - **Major versions.** A client that supports the store's major version, as a compatibility level it can be configured with,
    reads and writes the store at that level. Otherwise:
    - **A client older than the store** refuses it (`format-version-unsupported`).
    - **A client newer than the store** reads it with a warning (`format-version-older`) when no change between the two versions
      alters the meaning of existing syntax, and refuses it otherwise (`format-version-unsupported`). Each major version lists
      the changes in meaning it makes, so a client knows which case applies. Removing a feature does not alter meaning, since a
      newer reader fails on a feature it no longer knows, while a new slug rule or new number parsing does: data valid under
      both rules would be read silently differently, and validation cannot catch it.
    - **Writes from a newer client** use only the store's level. A validating backend rejects newer features. For a backend that
      does not validate, the writers' compatibility level (§20) keeps a writer at the store's level.

  Room is reserved for a client to declare the version it is built for, in the repository's settings or in a connection string.
  The rest is a design topic of its own ([#46](https://github.com/nosferatech/vollmond/issues/46)), with the proposals that §20
  lists.
- **`issues`** sets the severity of an issue code to `off`, `warning` or `error`, within the limits Appendix D gives. An unknown
  code, or a severity outside those limits, makes the configuration invalid (`config-invalid`). An `issues` entry is explicit and
  wins over a setting that implies a severity, so under `yaml_quoting: minimal` the entry `yaml-ambiguous-string: warning`
  keeps the warning. It is how a store makes a check stricter (an unsupported tag in a heading as an error) or quieter (no
  warning for references through derived anchors). A raised severity does not make an issue structural, so the record stays
  readable (§9.2).

### 9.2 Validation

The collection's schema, a JSON Schema 2020-12 document in JSON or YAML, validates the record's value view. The validator never adds
members to the value. Where a schema keys sections by `@key` (§9.3), vmd's validator computes the keys and evaluates that list
itself. Because schemas see values, not syntax, one schema covers a Markdown ticket and a YAML ticket with the same content.

Issues come in two classes, and Appendix D gives each code's class:

- **Structural errors** make a record unreadable. It has no value view, so `get`, `query` and the other readers cannot use it
  (§9.5). They are syntax errors, values outside the data model (§4.1, including numbers a double cannot hold, §4.2), a YAML
  version other than 1.2 (§4.4), unclosed front matter, a misplaced or malformed data block (§5.3), a section member of the
  wrong type or a section without a title (§5.2), a malformed anchor element (§6.2), a `$` member where none is allowed (§5.4),
  and a malformed `$ref` object (§8.1).
- **Validation errors** and warnings attach to a readable record: schema violations, dangling or ambiguous references, duplicates
  (§5.7, §6.1), and every issue whose severity the configuration raises to `error` (§9.1). A validation error fails `vmd check`
  (exit code 4, §12.3), and a write through a gate refuses it (§9.4).

Parsing and checking report every error they can find, not only the first, so that one run shows everything to fix.

`vmd check` reports, per record:

- structural errors (§4.1, §4.2, §4.4, §5.2, §5.3, §5.4, §6.2, §8.1),
- schema violations, including the logical types of §4.3,
- path and filename rule violations,
- duplicate keys (§5.7) and duplicate anchors (§6.1),
- references that are dangling or ambiguous, or that point where the schema does not allow, and references into records with
  structural errors (`ref-target-unreadable`),
- values the Markdown serializer could not represent (§5.8), where the record is Markdown,
- warnings, such as unquoted YAML strings that YAML 1.1 readers misread (§4.4) and unsupported HTML in a heading (§5.3).

### 9.3 Extension keywords

| Keyword | Where | Meaning |
|---|---|---|
| `x-vmd-list` | an array | a keyed list (§5.6, below) |
| `x-vmd-ref` | a `$ref` object, or a `uri-reference` string | `{"targets": ["tickets", "docs/**"], "cardinality": "one" \| "many", "anchors": "any" \| "explicit"}`; `one` and `any` are the defaults, and without `targets` any target is allowed: a node, a record, an asset or a directory |
| `x-vmd-summary` | any property | included in default listings and query results |
| `x-vmd-ordered` | an `enum` | `asc` or `desc`: the order in which the enum lists its values, for `<` and `>` in queries |

A keyword that begins with `x-vmd-` and that this version does not define makes the schema invalid (`feature-unsupported`), so
that a keyword a newer minor version adds is never silently ignored (§9.1).

`x-vmd-list` has these members:

```yaml
x-vmd-list:
  type: map                    # map: unique keys | multimap: repeats allowed
  keys: ["@key"]               # what forms the key: "@key" for sections, member names for data
  required: [what-is-confirmed]
  items:                       # a schema per key value
    what-is-confirmed: { $ref: "#/$defs/prose-section" }
  additional: true             # true, false, or a schema for items with other keys
```

An entry of `keys` is one of three forms:

- **`@key`**, the section key (§5.5). It is not a member. vmd's validator computes it for each item and evaluates the list
  natively, without adding a member to the item, so `additionalProperties: false` on a section and a stored member literally named
  `@key` are unaffected. It is allowed only where the items are sections, that is on `$sections`. (`@` cannot begin a plain YAML
  scalar, so it is quoted.)
- **A JSON Pointer**, an entry beginning with `/`, names a member by its exact name, so `"/@key"` names a member literally called
  `@key` and `"/~1x"` one called `/x`.
- **Any other string** names the member of that name, as `name` does in §5.6.

A list keyed by members compiles to standard JSON Schema 2020-12, so any validator can check it:

- **Per-key schemas**: `items: {allOf: [{if: {properties: {K: {const: k}}, required: [K]}, then: S_k}, ...]}`.
- **`required`**: one `contains` per required key, matching `K: k`.
- **Uniqueness of declared keys**: `contains` with `maxContains: 1`.
- **`additional: false`**: `items: {properties: {K: {enum: [declared keys]}}}`.

Only uniqueness across keys that `items` does not name has no standard form. That needs a custom keyword, about ten lines in Ajv or
in Python's `jsonschema`, comparable to `ajv-keywords`' `uniqueItemProperties`. Several key members form a composite key, which
enforces uniqueness, but a semantic path step matches a single key member. A list keyed by `@key`, which every `$sections` list
is, has no standard form, since the key is not in the instance. vmd's validator evaluates it with the same meaning, and a standard
validator can check the rest of a section schema but not that list.

`anchors: explicit` in `x-vmd-ref` requires that no step of a reference's address resolve through a title-derived name, which is
either a derived anchor (§6.3) or the key of a section that has no explicit anchor (§5.5), and that no step be positional: an
index into `$sections` or into any other array, in a semantic path (`#links/1`) or in an exact path (`#/$sections/1`). Steps
through explicit anchors, field names and section members (`#done/$body`) are allowed, in a semantic path or an exact path, and
so are keyed-list keys, which only a semantic path can use, since an exact path reaches a list item by its position. A reference
that breaks this is an error (`ref-target-not-allowed`). `anchors: explicit` is the recommended setting for stores used as
databases, whose references should not change meaning when a title changes or an item is inserted. Under the default,
`anchors: any`, positional steps are allowed, at the risk that an insertion retargets the reference (§13.5).

### 9.4 Validation modes

Where validation runs is a deployment choice, not a format rule. The **backend** is everything that runs regardless of the
client: storage, server-side scripts, commit protocols, merge queues, CI runners, Lambda calls. Client-side hooks and scripts are
not the backend, since a client can skip them. What a backend does with invalid data gives three kinds:

| Mode | Who validates | Backend | Invalid data can be stored? |
|---|---|---|---|
| Client | the writing client's library, before it writes | not validating | yes, by a client that skips it |
| After commit | a service checking each new commit, and reporting on it (§16.3, pattern A) | weakly validating | yes, and it is reported |
| Gate | a required check before merge (pattern B), a gatekeeper branch (pattern C), or the storage itself | validating | no |

- A **validating backend** validates before it accepts a write, so its constraints always hold.
- A **weakly validating backend**, such as GitHub with a Lambda function that validates each commit after it lands (pattern A),
  keeps its constraints except for the latest commits, which are still being validated. A client that syncs only to commits
  marked as passing (the `vmd/check` status of §16.3) sees a validating backend.
- A backend that does not validate keeps no constraints, and validation is up to each client.

In every mode, **validation does not gate the index.** Invalid records are indexed with their issues attached, so they are
visible rather than missing (§14).

### 9.5 Readers, validators and backends

Each part of vmd has one role towards data that may not be valid:

1. **A reader** reads a record as long as it has no structural error (§9.2), whether or not it validates. `vmd ls` and `vmd query`
   report how many records they could not read, so that none vanish silently.
2. **A validator** (`vmd check`, and validation in each mode of §9.4) reports every issue it can find, structural errors, schema
   violations and constraint violations alike, and fails according to the configured severities (§9.1, Appendix D).
3. **A validating backend** (§9.4) rejects every update that does not validate. A weakly validating one reports such updates
   after they land, and a backend that does not validate leaves validation to the client.
4. **A query** is best effort by default. It assumes the backend is correct, which a validating backend guarantees and a weakly
   validating one guarantees except for its latest commits, and it returns every record it can read. A **strict read mode**, set
   per client or per connection, refuses records with structural errors or schema violations, which are then errors, not results.
   It refuses every code of class structural in Appendix D, and these validation codes, which count as schema violations:
   `schema-violation` (logical types included), `ref-target-not-allowed` (from `x-vmd-ref`), `duplicate-key` at a level declared
   `type: map` (from `x-vmd-list`), and `filename-mismatch` (the collection's file name rule). Other validation issues, such as
   dangling references, undeclared duplicates or warnings, do not affect it. It is for uses where correctness matters
   more than availability, and for backends that do not validate.
5. **A reader on another format version** than the store's reads by the features the data uses (§9.1). It fails on a feature
   it does not know rather than misread it. For a major version it does not support, it refuses a newer store, and reads an older
   one with a warning only when no change in between alters the meaning of existing syntax.

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

- **`field:value`** is true when the field equals the value. String comparison ignores case by Unicode simple case folding, one
  code point to one, so Greek and Cyrillic case pairs match while `Straße` does not match `STRASSE`. When the field is an array,
  or a selector reaches several nodes, any of them may match. When the field is a section, its `$body` is compared, so `status:open`
  matches a `status` field or a `## Status` section that says "Open". `value*` matches a prefix, with the same case folding.
- **`field:*`** is true when the field exists. `what-is-confirmed:*` means "has that section".
- **Comparisons** (`>`, `>=`, `<`, `<=`, ranges) use the field's logical type (§4.3) where the schema gives one, enum order where
  the schema gives `x-vmd-ordered`, numbers numerically, and other strings lexicographically.
- **A missing field** makes a term false, so `-field:x` is true.
- **Full text** (`word`, `"phrase"`) matches case-insensitively, by the same simple case folding, against titles and every string
  in scope (§10.4). A word matches whole tokens; a phrase matches a substring.
- **Pseudo-fields** are the computed fields of §5.10, with the same names and the same types. VQL can filter on these:
  - `@path`, the record path, matched against a glob; `@collection`; `@key`, a section's key (§5.5); `@address`; `@at`; and
    `@depth`, a section's depth (0 for the root);
  - `@anchors`, a list of `{name, kind}`, which a term matches by `name` (`@anchors:done`);
  - `@refs`, a list of references, which a term matches by resolved address, so `@refs:docs/design/Minimal_Log.md#room` finds
    nodes containing a reference to that node;
  - `@issues`, a list of issues, whose length a term compares (`@issues:>0`).

  `@version`, `@source`, `@range` and `@nodes` can be projected (§10.5) but not filtered on. A projection returns a computed field
  with its type in §5.10, so a projected `@issues` is the list.
- **Shorthands over stored data**, which are not computed fields. `@tags` matches a tag in `$tags`, `@title` matches `$title`, and
  `@text` limits full text to prose (`$title` and `$body`).

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
| `sort` | fields with `asc` or `desc`; ties broken by store path, then document order (below) | records by store path; nodes in document order within each record |
| `limit` | results per page | 20, at most 200 |
| `per_record` | `nodes` only: matches shown per record; the rest are counted | 5 |
| `show` | `nodes` only: `excerpt`, `body` (the match's own `$body`), `source` (the whole section) or `none` | `excerpt` |
| `max_chars` | the cap per match when `show` is `body` or `source` | 1,000 |
| `cursor` | an opaque continuation token from the previous page | |

**Order.** Store paths are compared as exact UTF-8 bytes, so `tickets/0020-y.md` comes before `tickets/0171-x.md`. Nodes of one
record are ordered by their position in it. Document order applies only within a record, never across records.

Results carry totals (records, and in `nodes` mode, matches; each exact or marked as an estimate), the number of records that
could not be read (§9.5), and the next cursor. In `nodes` mode, each result also carries the computed fields `@address`, its
canonical address (§7.5), and `@at`, its exact path, as well as its title, its size, what matched (`title`, `body` with a hit
count, or `field`), and an excerpt of about 100 characters around the first body hit.

The core defines no relevance ranking. An engine may offer one as `sort: score`.

**Projection paths** resolve as field terms do (§10.4): in `nodes` mode, on the match first, then on its ancestors. A projection
path may name a computed field, as in `fields: [@version]`. Two context names make the choice explicit: `@match` is the matched
node and `@record` is the record's root, as in `fields: [@match.$body, @record.status]`. They use `@`, the pseudo-field prefix,
because names beginning with `$` are members of the value view.

### 10.6 Portability

The grammar, semantics and conformance suite are the specification. A scanning interpreter is a few hundred lines in Python or
TypeScript. An optional **SQL profile** (read-only SQL over defined index views, §14.2) is allowed for index-backed
implementations, but it is not part of the core and clients must not depend on it.

---

## 11. Storage contract

### 11.1 Principle

The storage contract is the interface a backend exposes to clients, and a backend implements only the operations below.
Everything else in this document (parsing, the value view, validation, queries, references, refactors) is computed by the vmd
library on top of them, on the client or in a service. Whatever else runs on the server side, such as merge queues, CI runners
and functions, works behind this interface, and that is where a validating backend validates (§9.4). It runs the library's
validation behind these operations and refuses a write that fails it (gate mode). A weakly validating backend runs it after a
commit has landed, as GitHub with the worker of §16.1 does (pattern A, §16.3), and reports the result on the commit. A backend
that does not validate needs no knowledge of Markdown or schemas.

### 11.2 Operations

| Operation | Meaning |
|---|---|
| `list(prefix, glob?, limit, cursor)` | paths with size, version and modification time |
| `stat(path)` | size, version and modification time, without content |
| `read(path, range?, at?)` | content, optionally a line or byte range, optionally at a past revision, with its version |
| `grep(pattern, glob?, mode, context, limit)` | matching lines with paths and line numbers; `mode` is `literal` or `regex` |
| `write(path, content, if_version \| if_absent)` | replace or create a file; returns its new version |
| `edit(path, edits[], if_version)` | exact-string replacements (§11.4); returns the file's new version |
| `append(path, text, if_version?)` | add text at the end; returns the file's new version |
| `move(from, to, if_version)` / `delete(path, if_version)` | `move` returns the file's version at its new path |
| `apply(ops[], if_head?)` | several of the above, atomically, as one new version of the store; returns the new head and each written file's new version |
| `head()` | the store's current version (a commit, or a sequence number) |
| `changes(since, limit, cursor)` | paths added, modified, moved or deleted since a head, with their versions |
| `log(path?, limit, cursor)` | history entries: version, author, time, message, paths |

### 11.3 Version tokens

- A **file version** is the git blob ID of the file's content, which is the bytes the backend returns, computed as SHA-1 over
  `"blob " + length + "\0" + content`. Any backend can compute it. It equals what `git hash-object` prints and what the GitHub API
  returns as a file's `sha`, so tokens mean the same thing locally and remotely. A SHA-256 git repository uses the SHA-256 form.
- A **node version** (the computed field `@version`, §5.10) is a SHA-256 over the RFC 8785 (JCS) canonical JSON of the node's
  value, truncated to 16 hex digits. It hashes stored data only, since the value holds no derived members (§5.1), and its numbers
  are doubles, which RFC 8785 requires (§4.2). Editing one section changes its own version and the versions of its ancestors,
  which contain it, and no other section's version.
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
The current text, like the file version, is the bytes the backend returns, which may have converted line endings (§13.3), so an
`old` taken from another copy of the file may need its line endings adjusted.

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
vmd get ADDR [--value|--body] [--fields F,..] [--max-chars N] [--meta F,..|all] [--no-value]   computed fields (§5.10)
vmd query [COLLECTION] 'VQL' [--nodes|--records] [--fields F,..] [--sort F[:desc]] [-n N] [--cursor C]
vmd refs ADDR [--to|--from] [--context N]     backlinks (default) or outgoing references
vmd schema [COLLECTION]                       fields, types, enum values, required sections, in one screen
vmd check [PATHS|--changed REV] [--fix]       validate; issues grouped and capped
vmd new PATH [--set K=V].. [--body-file F]    create a record
vmd set ADDR VALUE [--json] / vmd delete ADDR / vmd body ADDR --file F
vmd rename ADDR NEW-ANCHOR|--title TITLE      rename an anchor or retitle, and rewrite references
vmd mv PATH NEW-PATH                          move a record and rewrite references
vmd alias prune                               remove the aliases no open branch can still need (§13.6)
vmd apply OPS.json                            a batch of storage or semantic operations
vmd index [--publish DIR]                     build the index, or write the portable index (§14.4)
vmd sync / vmd push                           working copy of a remote store (§15.3)
```

Global options: `--store` (a path, `github:owner/repo@branch`, an HTTP URL, or a published index URL), `--json`, `--quiet`.

### 12.2 Output

- One line per item, with sizes in bytes and approximate tokens (bytes ÷ 4, marked `~`).
- `ls` and `grep` default to 100 and 50 items, `query` to 20. When more remain, the last line says how many and gives the
  `--cursor`. `ls` and `query` also say how many records they could not read, when there are any (§9.5).
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
  candidates  #/$sections/2 (line 20, derived #notes)
              #/$sections/4 (line 31, derived #notes-1)
  hint add <a id="..."></a> to the heading you mean, and link to that anchor
```

Issue codes, with their severities and classes, are listed in Appendix D. Lines and columns use the units of §5.9. Every issue
found is counted (§9.2); at most 20 are printed by default, followed by the counts per code. Exit codes: `0` ok, `1` error, `2`
usage, `3` conflict (re-read and retry), `4` validation failed, meaning at least one issue of severity `error`.

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
list of them, mixed with storage operations if needed. A value given to an operation holds stored data only, as a plain read
returns it (§5.10); a `$key` member in it is an error (§5.4), and computed fields cannot be written. Every operation returns the
new node versions of its target and of the target's ancestors, which contain it (§11.3), and the file's new version, so a client
can make its next edit without reading again.

### 13.3 Format fidelity

These rules apply where a backend stores the original file. They keep diffs small; they do not make member order meaningful
(§4.1).

- Bytes outside an edited node's source do not change. Line endings, encoding (UTF-8), a byte order mark and the trailing newline
  are kept as found, and new text is written with the file's own line endings. New files use LF and have no byte order mark
  (§5.1). A backend is not required to keep `\r\n`, and may
  store or return a file with its line endings converted. Values and node versions do not change with it, since the value view
  reads every line break as `\n` (§5.1).
- YAML is written with a round-trip writer that keeps comments, key order and quoting, and only for the nodes an edit changes.
  Unchanged nodes are spliced as they are, never re-serialized, since YAML writers rewrite numbers (§4.2).
- JSON keeps key order and the indentation detected in the file.
- A Markdown edit changes only the heading, data block or prose it targets. A new section is written with an ATX heading at the
  level its position requires, and its anchor and tags as an `<a>` element directly after the title, without a space (§6.2).
- Setting a value to its current value writes nothing.

### 13.4 Reference rewriting

`rename` and `mv`:

1. resolve the target and check the new anchor, title or path against the rules,
2. find every reference to the target through the index, by its resolved exact path, whatever form the reference uses,
3. build edits: the anchor or title itself, the target part of each reference, with the relative path recomputed for each
   citing file, and an alias for the old address (§13.6),
4. apply them as one `apply`,
5. re-check, and roll back the batch if any reference no longer resolves.

A retitle can change the derived anchors of other headings too, through the repeat numbering of §6.3. Retitling the first of two
`## Notes` sections turns the second one's `#notes-1` into `#notes`. `rename` therefore rewrites the references to every node
whose derived anchor changes, not only to the renamed one.

`rename` and `mv` refuse to run while the store has records with structural errors (`unreadable-records`), since references in
those records cannot be found or rewritten.

Link text is left alone. A move that changes a record's format (`.md` to `.yaml`) also rewrites references through derived
anchors into semantic paths, since derived anchors exist only in Markdown (§6.3).

### 13.5 Retitles and moves made with plain tools

When a heading's title changes in a plain edit, its derived anchor changes and references to it break, and so may references to
other headings whose repeat numbering it shifts. `vmd check` compares
against the previous index. If a section disappeared and a new one appeared at the same exact path with the same node version
apart from its title, it suggests the rename, and `vmd check --fix` applies it. A file moved with `git mv` is detected the same way,
by an unchanged file version at a new path. `vmd check` also reports every reference whose resolved exact path differs from the
one in the previous index (`ref-retargeted`), since such a reference still resolves but may now mean another node.

### 13.6 Aliases

`.vmd/aliases.jsonl` records old record paths and anchors:

```json
{"kind": "record", "from": "tickets/0171-old-slug.md", "to": "tickets/0171-new-slug.md", "at": "2026-10-09T08:00:00Z"}
{"kind": "anchor", "record": "docs/design/Minimal_Log.md", "from": "room", "to": "room-rule", "at": "2026-10-09T08:00:00Z"}
```

`rename` and `mv` record an alias on every move and every rename of an anchor or title. An alias resolves an old address that the
rewrite could not see, such as a reference added on a branch opened before the move, which merges without a textual conflict, a
published URL, the website's redirects, and links outside the store. Resolution through an alias is reported as `aliased` (§8.5),
and `vmd check --fix` rewrites such a reference to the current address.

`vmd alias prune` removes the aliases that no open branch can still need, so the file does not grow without bound. A reference to
an old name that was added after the rename may mean a new node that reuses the name rather than the renamed one, and a client that
synced before the rename and pushes after it cannot be told apart from one that means the new node. How vmd resolves such
references is open ([#48](https://github.com/nosferatech/vollmond/issues/48)), including whether an alias should reserve its old
name until it is pruned. Until then a live node wins. An address that resolves to a live anchor or path is not resolved through an
alias, and `vmd check` warns when a live anchor or path has the old name of an alias (`alias-shadowed`).

Reading `.vmd/aliases.jsonl` belongs to the Validate profile, so that every validating implementation reports `aliased` alike;
writing it belongs to the Refactor profile (§19.2). A file that is not valid JSONL of alias entries is an error
(`alias-file-invalid`).

---

## 14. Index

### 14.1 Principle

The index is derived. It can be rebuilt from the files at any time, and nothing in it is authoritative.

### 14.2 Contents

| Table | Columns |
|---|---|
| `records` | path, version, collection, key, title, size, ~tokens, summary fields, issue count |
| `nodes` | path, exact path, semantic path, key, anchors, tags, kind, title, depth, size, ~tokens, node version; source lines if known |
| `refs` | source path and exact path, offset in `$body` or `$title` if in prose, raw text, target address, resolved exact path, status |
| `issues` | path, exact path, line and column if known, severity, code (Appendix D), message |

Offsets, lines and columns use the units of §5.9. A record with a structural error is listed in `records` with its issues and has
no nodes. A reference's `status` is one of those of §8.5, `unreadable` included.

### 14.3 Local index

The local index is a cache in `.vmd/cache/`, which is never committed. Entries are keyed by file version, so an unchanged file is
never re-parsed, a checkout of an old commit reuses every entry it can, and branches share the cache. In a git working copy,
`git ls-files -s` and git's stat cache supply file versions without hashing. The storage engine is an implementation choice. The
reference implementation uses JSONL files in the portable index's format (§14.4), which needs no native modules.

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

A language-neutral directory of fixtures, each with inputs and expected outputs in JSON. It holds data only. Each implementation's
runner, which reads the fixtures and drives that implementation, lives next to the implementation, in its own language:

- records in each format with their expected value views, keys, anchors, tags and source maps,
- values outside the data model (§4.1) and the numbers of §4.2, including integers beyond 2^53,
- addresses with their expected resolution and cardinality,
- uniqueness cases in strict and lenient modes,
- references with their expected resolution and status,
- VQL queries over fixture stores, in both targets, with their expected results,
- serializer round-trip cases, and values that are not representable (the round-trip property itself is tested by each
  implementation, §5.8),
- edit cases with expected bytes,
- expected issues, by the codes of Appendix D.

Path rules that cannot exist as files on every platform (§3.2), such as two names that differ only by case, are left out of the
suite for now.

### 19.2 Profiles

An implementation or backend states which profiles it supports:

| Profile | Requires |
|---|---|
| **Read** | the value types, parsing all three formats, the value view and its computed fields, anchors and tags, addresses, `outline` and `get`; source maps are optional, and an implementation states whether it produces them |
| **Validate** | collections, schemas with the extension keywords, logical types, uniqueness, reference resolution, reading aliases, `check` |
| **Query** | VQL core and the parameters of §10.5 |
| **Write** | the storage contract with version tokens, semantic operations with span-preserving edits, the canonical serializer |
| **Refactor** | `rename` and `mv` with reference rewriting, writing aliases, `vmd alias prune` |
| **Publish** | the portable index |

A backend conforms to the storage contract (§11) separately, and states whether it supports history (`log`, `at`, `changes`).

---

## 20. Open questions

1. **Relevance ranking.** The core returns matches in document order (§10.5). Whether a standard `score` sort is worth
   specifying, or is left to engines.
2. **Lists as data.** Whether a Markdown list (for example a checklist) should ever map to an array in the core. Recommended: no;
   lists become structure through views (§18.2).
3. **Label templates** (§8.4): link text derived from the target, such as section numbers. The syntax is open; deferred to I8.
4. **Escape hatches** for messy data (§5.7), such as a resolution policy for ingesting stores that cannot be cleaned up. Deferred
   until a case needs one.
5. **The browser-side index limit**: at what size the website switches from filtering in the browser to a query service (§16.1).
6. **Explicit-only links in Markdown.** In YAML and JSON a schema can require references to use explicit anchors (§9.3), while a
   Markdown link stays a plain link (§6.3). Whether a Markdown link can carry an attribute that a reader does not see and that
   says the same is open.

Larger design topics are tracked as issues instead: format and protocol versioning
([#46](https://github.com/nosferatech/vollmond/issues/46)), a selector language for addresses
([#47](https://github.com/nosferatech/vollmond/issues/47), §6.4), and renames, aliases and concurrent changes
([#48](https://github.com/nosferatech/vollmond/issues/48), §13.6).

Versioning starts from the rule of §9.1 (minor versions only add, every addition is detectable, a reader decides from the
features the data uses, and a client refuses a major version it does not support, except that a newer client reads an older
store with a warning when no change in between alters meaning). These proposals are left to #46:

- **Safeguards that keep the rule true**: a compatibility class for every specification change, recording whether it alters the
  meaning of existing syntax; downlevel cases in the conformance suite; cross-version CI against vmd's previous release; and
  pinned output of vmd's own writer. They cover vmd's own specification and implementations, not third-party serializers. If
  they become too heavy a burden, the issue is raised and the versioning rules are revisited.

- **A compatibility level for writers**, a store setting that keeps a 2.2 writer from using 2.2 features until the store's owner
  raises it. Without it, old readers fail the moment one writer upgrades.
- **Feature classes**, so that a feature an older client can read but must not write, such as a new schema constraint, lets the
  client read and refuses its writes. Precedents, each checked against its documentation on 2026-10-10:
  - ext4's superblock flags ([docs.kernel.org/filesystems/ext4/super.html](https://docs.kernel.org/filesystems/ext4/super.html)).
    A kernel that does not understand a `compat` feature can still read and write the file system, one that does not understand
    an `ro_compat` feature can still mount it read-only, and one that does not understand an `incompat` feature should refuse to
    mount it.
  - ZFS feature flags (zpool-features(7),
    [openzfs.github.io](https://openzfs.github.io/openzfs-docs/man/master/7/zpool-features.7.html)). A feature is disabled,
    enabled (turned on, with no on-disk change yet, so other software can still import the pool) or active. A pool whose
    unsupported active features are all read-only compatible can be imported read-only.
  - git's `core.repositoryFormatVersion` 1 with `extensions.*` keys
    ([git-scm.com/docs/gitrepository-layout](https://git-scm.com/docs/gitrepository-layout)). If a version 1 repository
    specifies an extension that the running git has not implemented, the operation must not proceed.
- **How a store writes a minor version**, since `vmd: 1.1` reads as a YAML number, and `vmd: 1.10` as the same number as
  `vmd: 1.1`.
- **Transcoding** between a client's declared version and the store's, as the owner's model for F4 describes.

---

## 21. Implementation plan

The implementation is in **TypeScript**: one codebase for the CLI (Node), the Lambda functions and the browser. Python consumers
use `vmd --json` or the HTTP binding, and a native Python implementation of the Read and Query profiles may follow, checked by the
conformance suite. Each language's implementation has its own top-level directory (`js/`, later `python/`) with its own
conformance runner, and `docs/` and `conformance/` are shared. Phases I0 to I3 are planned task by task in [the implementation
plan](../plan/implementation-plan.md), and vollmond's own work is tracked in GitHub issues.

Each phase ends with its part of the conformance suite passing and a demonstration on real data.

| Phase | Builds | Done when |
|---|---|---|
| **I0** Spec and suite | this document reviewed; the parser survey (Appendix B); the conformance suite's layout and first fixtures; the derived anchor rule pinned with test cases | fixtures for §4–§7 exist, and the parser survey has settled the number rules of §4.2 |
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
| **R1** | vampiredb docs, read-only | I1–I3 | agents gain `outline`, `get`, `query`, `refs`; vampiredb's existing Actions CI, which its merge queue runs anyway, runs `vmd check` next to `scripts/docs.sh`. The docs' header tables move to front matter, mechanically. Existing broken links and other validation errors cannot be lowered to warnings (Appendix D), so adoption goes step by step. Relax the schema, then tighten it as the docs are fixed. A broken link that cannot be fixed yet is commented out in Markdown (§8.1), commented out or removed in YAML, and removed or replaced with a plain string in JSON; relaxing the schema does not clear it |
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
      "$title": "What is confirmed",
      "$body": "- A contiguous transition writes the changed units and the header into one slot range."
    },
    {
      "$title": "What was done",
      "$anchor": "done",
      "$tags": ["decision"],
      "$body": "Recovery of a clean root makes the record contiguous. See\n[§4.6](https://github.com/nosferatech/vampiredb/blob/main/docs/design/Minimal_Log.md#contiguous-at-rest)."
    }
  ]
}
```

Its section keys, `what-is-confirmed` and `done`, are computed fields (`@key`, §5.5, §5.10). The second section's derived anchor is
`what-was-done` (§6.3).

The same record as YAML, `tickets/0171-clean-root-in-scattered-record.yaml`, has the same value view and the same keys:

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
| `…#what-was-done` | the second section, by its derived anchor |
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
      keys: ["@key"]
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

Measured by the I0.2 survey ([parser-survey.md](../research/parser-survey.md)), except Go, which is from documentation. Versions
are in the survey. vmd holds every number as a double (§4.2); the exact options matter because the checks of §4.2 need each
number's source text.

| Parser | Integers | Beyond 2^53 | Non-integers | `-0`, `1e400` | Exact options |
|---|---|---|---|---|---|
| JavaScript `JSON.parse` | IEEE 754 double | silently rounded | double | `-0` stays negative zero; `1e400` is `Infinity` | a reviver's `context.source` (Node 21, Chrome 114, Firefox 135, Safari 18.4); `JSON.rawJSON` to write |
| `jsonc-parser` | double in `node.value` | silently rounded in `value`; `offset` and `length` give the exact text | double | as `JSON.parse` | `parseTree` and `visit` offsets |
| Python `json` | arbitrary precision `int` | exact | `float` | `-0` is `int 0`; `1e400` is `inf` | `parse_float=Decimal`, or `parse_int=str` and `parse_float=str` for the text. From Python 3.11, and in security releases of earlier versions, integer text longer than 4300 digits raises `ValueError` |
| Go `encoding/json` | `float64` when decoding into `interface{}` | rounded | `float64` | not checked | `Decoder.UseNumber` |
| Java Jackson | `int`, `long` or `BigInteger` by size | exact | `double` | `-0` is `0`; `1e400` is `Infinity` | `USE_BIG_DECIMAL_FOR_FLOATS` (drops trailing zeros); `JsonParser.getText()` for the text |
| Rust `serde_json` | `i64` or `u64` | exact up to `u64`; beyond, `f64` | `f64` | `-0` is `-0.0`; `1e400` is an error | `arbitrary_precision` (normalizes the text); `RawValue` for the text |

Duplicate keys are accepted with the last value winning by `JSON.parse`, `jsonc-parser`, Python `json`, Jackson and `serde_json`'s
`Value`; only an option or a typed target rejects them, and `jsonc-parser` has no such option. No parser in the table rejects
an unpaired surrogate escape except `serde_json`.

YAML readers differ in version and in schema, and some differ between releases.

| Reader | Implicit timestamps | `yes`/`no`/`on`/`off` | `017` | `0o17` | `1:30` |
|---|---|---|---|---|---|
| `yaml` 2.x, default (1.2 core) | no | strings | 17 | 15 | string |
| `yaml` 2.x, `version: '1.1'` | yes | booleans (and `y`/`n`) | 15 | string | 90 |
| `js-yaml` 5.x, default (core) | no | strings | 17 | 15 | string |
| `js-yaml` 5.x, `YAML11_SCHEMA` | yes | booleans (and `y`/`n`) | 15 | string | 90 |
| `js-yaml` 4.x, default | yes | strings | 17 | 15 | string |
| `js-yaml` 4.x, `CORE_SCHEMA` | no | strings | 17 | 15 | string |
| `ruamel.yaml`, default (1.2) | **yes** | strings | 17 | 15 | string |
| PyYAML | yes | booleans | 15 | string | 90 |
| Ruby Psych (3.1.0) | yes | booleans | 15 | string | 5400 |

`js-yaml` 4's default schema also merges `<<` keys and resolves `!!set`, `!!omap` and `!!binary`; `js-yaml` 5's default does not.
`ruamel.yaml` and PyYAML merge `<<` keys always.

---

## Appendix C. Prior art and libraries

Libraries to adopt (licences to be confirmed at adoption):

| Need | TypeScript | Python |
|---|---|---|
| Markdown with source offsets | `micromark` / `mdast-util-from-markdown` (MIT) | `markdown-it-py` (MIT; line maps) |
| YAML 1.2 round-trip with comments and ranges | `yaml` (ISC) | `ruamel.yaml` (MIT) |
| JSON with offsets and edits | `jsonc-parser` (MIT) | |
| JSON Schema 2020-12 with formats | Ajv with `ajv-formats` (MIT), with vmd's own date and time checks (§4.3) | `jsonschema` (MIT), with the same |
| Derived anchors (§6.3) | vmd's own rule, in `core` | the same rule |
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

---

## Appendix D. Issue codes

Every issue vmd reports carries one of these codes, which the CLI prints (§12.3), the index stores (§14.2) and the conformance
suite compares (§19.1). Messages and hints are not part of the contract. The fixture tasks add codes as they need them, and each
round of decisions adopts them here.

The columns:

- **Severity** is the default. Where it depends on the uniqueness mode (§5.7), both are given.
- **Class** says what the issue does (§9.2, §9.5). A **structural** error makes the record unreadable. `parse` fails, and the
  record has no value view. A **validation** issue attaches to a readable record; an error fails `vmd check`. An **operation**
  issue makes the operation that raised it fail, or warns about it, and is not about one record's content.
- **At** is the node the issue is attached to, by exact path (§7.2). A structural error is still attached where it sits, as far as
  the parser can tell. An issue about "the record" is attached to its root, whose exact path is `""`, and "none" means that the
  issue has no node. An issue on a block anchor is attached to the `$body` that holds it (§6.2).
- **How many.** An issue is reported once per occurrence, unless its row says otherwise. A repeat is reported for each
  occurrence after the first, so a name given three times gives two issues.

| Code | Severity | Class | Section | Raised for; at |
|---|---|---|---|---|
| `syntax-error` | error | structural | §4.1, §5.3, §5.4 | a JSON or YAML file, front matter or data block that does not parse, including an empty JSON file, front matter without a closing delimiter and a `%YAML` line in front matter; the record, or the data block's section |
| `duplicate-member` | error | structural | §4.1 | two members of one JSON object or YAML mapping with the same name; each member after the first |
| `unpaired-surrogate` | error | structural | §4.1 | a string holding an unpaired surrogate, once per string however many it holds; the string, or for a member name the object that holds the member |
| `number-not-representable` | error | structural | §4.2 | an integer by form (§4.2) whose double differs from it, a number too large for a double, or a non-zero number a double rounds to zero; the number |
| `yaml-non-finite` | error | structural | §4.1 | `.inf`, `-.inf` or `.nan`; the number |
| `yaml-non-string-key` | error | structural | §4.1 | a mapping key that is not a string; the mapping |
| `yaml-alias` | error | structural | §4.1 | a YAML anchor or alias, an alias to an anchor that is not defined included; the node that carries it, which for an alias is where the alias stands |
| `yaml-merge-key` | error | structural | §4.1 | a plain `<<` key, whatever its value; the mapping |
| `yaml-tag` | error | structural | §4.1 | an explicit tag: a custom tag, a core schema tag such as `!!str`, or the non-specific tag `!`; the tagged node |
| `yaml-multiple-documents` | error | structural | §4.1 | several YAML documents in one file; the record |
| `yaml-version-unsupported` | error | structural | §4.4 | a `%YAML` directive for a version other than 1.2, in a YAML file or a data block; the record, or the data block's section |
| `root-not-object` | error | structural | §5.4 | a JSON or YAML record whose root is not an object; the root |
| `data-block-misplaced` | error | structural | §5.3 | a data block right after the title heading, or as the first block of a record without one; the root. A second data block right after a section's data block; the section |
| `data-block-not-object` | error | structural | §5.3 | a data block, or front matter, that holds something other than an object; its section, the root for front matter |
| `reserved-member-type` | error | structural | §5.2 | a `$title`, `$body` or `$anchor` that is not a string, `$tags` that is not an array of strings, or `$sections` that is not an array of objects, on a section or, for `$anchor` and `$tags`, on any object; the member |
| `section-title-missing` | error | structural | §5.2 | an item of `$sections` without a `$title`; the item |
| `anchor-element-invalid` | error | structural | §6.2 | an `<a>` element with an `id` or `class` that also has content or another attribute, or a second anchor element in one heading or at the start of one block; the section, or the `$body` for a block |
| `dollar-member` | error | structural | §5.3, §5.4 | `$key` on a section, in front matter or in a data block; a section member (`$title`, `$anchor`, `$tags`, `$body`, `$sections`) at the top of front matter or of a data block; or a section member out of its place (`$schema` below the root, and in a data block). Inside a field's value such a member is data; the member |
| `feature-unsupported` | error | structural in a record; operation in a schema | §5.3, §5.4, §9.1, §9.3 | a construct of the reserved forms that this version does not define, which may come from a newer minor version: another `$` member on a section, in front matter or in a data block, a `data` info string other than `yaml data` and `json data` after a heading, including either with a third word, or an unknown `x-vmd-*` keyword in a schema. The message names the store's declared version when there is one; the member, the section, or none |
| `ref-malformed` | error | structural | §8.1 | a `$ref` object with other members, or whose `$ref` is not a string; the object |
| `duplicate-key` | error at a level the schema declares `type: map`; elsewhere error (strict), warning (lenient) | validation | §5.7 | a field name and a section key, or two section keys, repeated in one section, or a key repeated in a keyed list; each node after the first |
| `duplicate-anchor` | error (strict), warning (lenient) | validation | §6.1 | an anchor, explicit or derived, that names more than one node; each node after the first in document order, once per node even when two of its anchors collide |
| `duplicate-tag` | warning | validation | §6.2 | a token repeated in the `class` attribute of an anchor element, which `$tags` holds once, or a tag repeated in a data `$tags` array, which keeps it as written; the node |
| `anchor-element-ignored` | warning | validation | §6.2 | an `<a id>` element in a `$body` that is not at the start of a list item outside block quotes or of a paragraph at the top level, and so is plain HTML; the `$body` |
| `anchor-invalid` | error | validation | §6.2 | an anchor or tag name that does not match `[A-Za-z][A-Za-z0-9_-]*`; the node |
| `schema-violation` | error | validation | §9.2 | a value the collection's schema rejects, logical types included; the value |
| `path-invalid` | error; warning for an asset outside collections | validation | §3.2 | a path that breaks a rule of §3.2 other than case; the record (`at` is null for an asset) |
| `path-case-conflict` | error; warning for assets outside collections | validation | §3.2 | two paths that differ only by case; each path after the first in byte order |
| `filename-mismatch` | error | validation | §9.1 | a record whose file name does not match its collection's `filename`; the record |
| `ref-dangling` | error | validation | §8.2, §8.5 | a singular reference with no target, a reference of either cardinality whose record does not exist, or one to an asset or directory that does not exist; the reference |
| `ref-target-unreadable` | warning | validation | §8.5 | a reference into a record that has a structural error, whose address is not the record's root (no fragment, or `#` alone), so that its target cannot be resolved (status `unreadable`); the reference |
| `ref-ambiguous` | error | validation | §7.4, §8.5 | a singular reference with several targets; the reference |
| `ref-target-not-allowed` | error | validation | §9.3 | a target outside the `targets` of `x-vmd-ref`, or, under `anchors: explicit`, an address with a step through a title-derived name or a positional step; the reference |
| `not-representable` | warning in `check`; error when the serializer refuses a value | validation; operation | §5.8 | a value the Markdown serializer cannot write; the offending node |
| `yaml-ambiguous-string` | warning; off under `yaml_quoting: minimal` | validation | §4.4 | a plain YAML scalar that vmd reads as a string and that a YAML 1.1 reader reads otherwise; the string, or for a mapping key the mapping |
| `yaml-ambiguous-number` | warning; off under `yaml_quoting: minimal` | validation | §4.4 | a plain YAML scalar that vmd reads as a number and that a YAML 1.1 reader reads otherwise; the number |
| `multiple-h1` | warning | validation | §5.3 | a Markdown record with several level-1 headings outside container blocks; the root |
| `heading-html` | warning | validation | §5.3 | HTML in a heading other than the anchor element and the supported inline elements; the section |
| `ref-derived-anchor` | warning | validation | §6.3 | a reference that reaches its target through a derived anchor without suffixed repeats; the reference |
| `ref-derived-repeat` | warning | validation | §6.3 | a reference through a derived anchor whose slug is repeated in the record, suffixed or not, in place of `ref-derived-anchor`; the reference |
| `ref-retargeted` | warning | validation | §13.5 | a reference whose resolved exact path differs from the one in the previous index; the reference |
| `ref-aliased` | warning | validation | §8.5, §13.6 | a reference that resolves only through an alias; the reference |
| `alias-shadowed` | warning | validation | §13.6 | a live anchor or record path that has the old name of an alias; the node, or the record |
| `config-invalid` | error | operation | §9.1 | a store configuration without `vmd`, or that is not valid, including an unknown code or an out-of-limit severity in `issues`; none |
| `schema-invalid` | error | operation | §9.1, §9.2 | a collection whose schema file is missing or is not a valid schema; none |
| `alias-file-invalid` | error | operation | §13.6 | a `.vmd/aliases.jsonl` that is not valid JSONL of alias entries; none |
| `format-version-unsupported` | error | operation | §9.1 | a store whose major format version the client does not support: a newer store, or an older one across a change that alters meaning; none |
| `format-version-older` | warning | operation | §9.1 | a client newer than the store reads a major version it does not support, with no change in between that alters meaning; none |
| `address-malformed` | error | operation | §7.1 | an address that does not match the grammar; none |
| `address-not-singular` | error | operation | §7.4 | a singular address the checker cannot prove singular; none |
| `address-not-found` | error | operation | §7.4 | a singular address that matches no node, or an address, singular or a selector, whose record does not exist; none |
| `address-ambiguous` | error | operation | §7.4 | a singular address that matches several nodes; none |
| `query-invalid` | error | operation | §10.2 | a VQL query that does not parse; none |
| `unreadable-records` | error | operation | §13.4 | a `rename` or `mv` while the store has records with structural errors; none |
| `conflict` | error | operation | §11.3 | a write whose `if_version` or `if_head` no longer matches (exit code 3); the target |

For a reference in prose, "the reference" is the `$body` or `$title` that holds it, and its offset locates it (§5.9). A
reference that §8.2 places outside the store raises none of these. An `address-*` issue has no node, but it is about the record the
address names, even one that does not exist, so its record path is that record's.

**Configuring severities.** The `issues` member of the configuration (§9.1) sets a code's severity within these limits:

- A structural error is always an error and cannot be configured, since it means the record has no value view.
- An operation issue cannot be configured.
- A validation error stays an error. The uniqueness mode (§5.7) sets the severity of `duplicate-key` and `duplicate-anchor`.
  Data that raises a validation error is made to pass in one of three ways: fix the data, relax the schema so that it permits the
  data, or comment out the offending links. A store adopts vmd step by step by relaxing its schema first and tightening it as
  the data is fixed. Relaxing the schema does not clear `ref-dangling`, which only a fixed or removed reference clears.
- Lenient uniqueness (§5.7) is not a lowered severity. It is a store mode with its own decision, under which repeats at levels no
  schema declares are allowed and only warned about.
- A warning can be set to `off`, `warning` or `error`. Raised to `error`, it fails `vmd check` as any validation error does, and
  the record stays readable.
- An `issues` entry wins over a setting that implies a severity, such as `yaml_quoting: minimal` for `yaml-ambiguous-string`.
- An unknown code, or a severity outside these limits, is `config-invalid`.
