# Implementation plan

Status: Draft (2026-10-09). Covers phases I0 to I3 of [the proposal's §21](../draft/vollmond-proposal.md) in detail; I4 to I8
stay at the level of §21 and are planned in detail when I3 is nearly done.

Decided for this plan (project owner, 2026-10-09):

- **TypeScript** for the core library, the CLI, the Lambda functions and the browser.
- **GitHub issues** track vollmond's own work: one issue per task below, one milestone per phase. Outside contributors and bug
  reporters already have accounts and access there. vampiredb and Belfry dogfood vmd for their tickets instead.
- **int64**: a number within ±(2^53−1), a decimal string beyond it.

Decided for this plan (project owner, 2026-10-10):

- **One top-level directory per language**: TypeScript in `js/`, Python later in `python/`. `docs/` and `conformance/` stay at the
  root and are shared by all languages. Each language's conformance runner lives next to its implementation; the suite's data
  stays shared in `conformance/`.
- **Demonstration stores** (card K, decision K3). vampiredb's store is its `docs/` directory, not the whole repository, read with
  a configuration kept in this repository. eternal-circle becomes a vmd store with its own committed configuration.
- **The phase I1 design** ([`docs/design/i1-read.md`](../design/i1-read.md), approved in #59, with the answers of card K) refines
  the I1 tasks below.

---

## 1. Shape of the code

### 1.1 Packages

One top-level directory per language (project owner, 2026-10-10), the model being Apache Arrow's layout of `cpp/`, `python/` and
`js/` around a shared specification and integration tests. The TypeScript implementation lives in `js/`; a Python implementation
will go in `python/` later. `docs/` and `conformance/` stay at the root and are shared by all languages. Each language's
conformance runner lives next to its implementation (decision log, phase I0), not in `conformance/`.

The TypeScript workspace in `js/` is an npm workspace with two published packages to start, split further only when a consumer
needs a part without the rest, and a private package for the conformance runner (decision K11):

| Location | Contents | Runs in |
|---|---|---|
| `js/packages/core` (`@vollmond/core`) | the data model, the three parsers and serializers, addresses, references, schemas, VQL, the index tables, the storage contract's types. No Node APIs | Node, browsers, Lambda |
| `js/packages/cli` (`@vollmond/cli`) | the `vmd` command, the local filesystem and git working-copy backends, the local index cache | Node |
| `js/packages/conformance` (private) | the TypeScript conformance runner (I1.10); not published | Node |
| `conformance/` | the language-neutral conformance suite (§19.1 of the proposal): fixtures and the runner contract, no code. Each language's runner is in that language's directory | any implementation |

`core` stays free of Node APIs so that the website and the Lambda functions of I6 and I7 use the same code. Anything that needs the
filesystem, `git` or a process goes in `cli`, behind the storage contract's interface.

### 1.2 Tooling

| Need | Choice | Why |
|---|---|---|
| Runtime | Node 24 LTS | current LTS; built-in `util.parseArgs` covers the CLI's argument parsing. Node is not installed on the development machine yet |
| Language | TypeScript, `strict`, ESM only | |
| Package manager | npm workspaces, in `js/` | no extra tool to install |
| Tests | Vitest, with fast-check for property tests | fast, TypeScript without a build step; fast-check drives the round-trip properties of §5.8 |
| Lint and format | Biome | one tool for both, no plugin set to maintain |
| Build | `tsc` for the packages | no bundler until the browser build of I7 |
| CI | GitHub Actions on pull requests: type check, lint, tests, conformance. One job per language directory (`js`, later `python`), and a `check` job that reports their combined result | free for a public repository; runner start-up time does not matter for code CI |

This tooling is for the TypeScript implementation and is configured in `js/`; the Python tooling will be chosen when `python/`
starts. Exact dependency versions are pinned when the workspace is created. The libraries are those of the proposal's Appendix C:
`micromark` and `mdast-util-from-markdown` with the four extensions of GFM 0.29 (tables, strikethrough, task list items,
autolink literals) taken one by one, `yaml`, `jsonc-parser`, Ajv with `ajv-formats`. The `gfm()` bundle is not used, since it adds
footnotes, which GFM 0.29 does not have, and front matter follows vmd's own rule rather than an extension (I1 design, section
3.4). Derived anchors follow vmd's own rule (proposal §6.3), implemented in `core`, so `github-slugger` is not used.

No native dependencies: the local index cache is JSONL files, the same format as the portable index (§14.4), not SQLite. SQLite
comes back only if measurements ask for it.

### 1.3 How work lands

- Each task below is a GitHub issue, and each pull request closes one issue, or a few that stand or fall together.
- A pull request runs the type check, lint, tests and the conformance suite. It merges once CI passes and the project owner
  approves.
- A change that alters the behavior the spec describes changes the proposal and the decision log in the same pull request
  (`AGENTS.md`).
- Every phase ends with a demonstration on real data, recorded in the phase's closing issue.

### 1.4 Real data

vampiredb's docs and the tickets in eternal-circle are the test bed.

**vampiredb's docs** are a store whose root is `~/vampiredb/docs`, not the whole checkout (decision K3). They are read from the
local checkout and never modified by this work. Two things make that possible before vampiredb migrates:

- vampiredb's docs already use `<a id>` anchors on headings and blocks, and relative links with anchors, which is the syntax of
  the proposal's §6 and §8. A link from the docs to a file outside `docs/` leaves the store (proposal §8.2).
- `vmd --config PATH` (from I1.8) takes a store configuration from outside the store, so the configuration for vampiredb's docs
  lives in this repository under `examples/vampiredb/`.

Two repositories hold demonstration stores (project owner, 2026-10-09):

- **`nosferatech/eternal-circle`**, created by the project owner on 2026-10-09, internal to the organization, cloned at
  `~/eternal-circle`: tickets kept with vmd, iterated on through I3 to I7. On 2026-10-10 the project owner moved vampiredb's
  tickets there, with Belfry's, and gave every ticket id a project prefix (`VDB-0158`, `BELFRY-0003`, files named
  `PREFIX-NNNN-slug.md`). They still use the header-table format. eternal-circle becomes a vmd store with its own
  `.vmd/config.yaml` and schemas, committed in that repository, and is made compliant with the importer of I3.7 (decision K3); it
  gets no trial configuration in this repository. It is also where rollout step R3 can end up.
- **`nosferatech/vollmond-practice`, public**, created once the private store has matured: a demonstration and test store for
  GitHub as a backend (I6, I7), with data that can be public.

---

## 2. I0: specification and conformance suite

Goal: everything I1 to I3 implement is pinned down by fixtures, and the open questions they depend on are answered.

| Task | Deliverable | Done when |
|---|---|---|
| **I0.1** Workspace | the package layout of §1.1, the tooling of §1.2, a CI workflow, a contributor note in `README.md` | `npm test` and CI pass on an empty test in each package |
| **I0.2** Parser survey | open question 2 of proposal Draft v0.3: how JSON and YAML parsers in JavaScript and Python handle large integers, `1.0`, duplicate keys, YAML 1.1 dates and booleans, and how a JavaScript implementation keeps a number's source text (a reviver with source-text access, or offsets from `jsonc-parser`). A short report in `docs/research/` | Appendix B of the proposal is confirmed or corrected, and §4.2 says how `core` keeps exact numbers |
| **I0.3** Suite layout | the directory structure, the case-file format, how a runner reports results, how the suite is versioned | a README in `conformance/` that another language's implementer could follow |
| **I0.4** Fixtures: values | §4: the I-JSON subset, rejected YAML constructs, numbers (including integers beyond 2^53), the logical types' canonical forms | fixtures exist, each with its expected result or expected error |
| **I0.5** Fixtures: Markdown | §5.3: front matter, the title heading, sections and nesting, data blocks, `$body` trimming, container blocks, `---` in a body | as above |
| **I0.6** Fixtures: anchors and addresses | §6 and §7: explicit and derived anchors, tags, block anchors, exact and semantic paths, cardinality, canonical addresses | as above |
| **I0.7** Derived-anchor fixtures | vmd's slug rule (proposal §6.3, decisions C12 to C14 and F5) applied to the heading inputs captured in `docs/research/github-heading-slugs/`: ASCII, punctuation, Unicode, inline code, HTML and repeats, each with vmd's expected anchors. GitHub's output stays in `docs/research/` for comparison and is not a fixture, since vmd does not follow GitHub (C12) | every captured input has a fixture with vmd's expected anchors, and each case where vmd differs from GitHub says so in its description |
| **I0.8** Spec corrections | every ambiguity the fixtures expose, fixed in the proposal with a decision-log entry | no fixture depends on an unwritten rule |

I0.2 and I0.3 can run in parallel with I0.1. I0.4 to I0.7 follow I0.3. I0.7 was re-scoped on 2026-10-10: it first pinned GitHub's slugs, which decision C12 made informative only.

---

## 3. I1: read

Goal: an agent can list, outline and read any record by address, with the output conventions of §12.

| Task | Deliverable | Depends on |
|---|---|---|
| **I1.1** Values | the value model: I-JSON checks, numbers that keep their source text, equality as §5.8 defines it, RFC 8785 canonical JSON, node version tokens, git blob ids | I0.2, I0.4 |
| **I1.2** JSON parser | value view and source map from `jsonc-parser` in strict mode, duplicate keys rejected | I1.1 |
| **I1.3** YAML parser | value view and source map from `yaml` with the core schema; every construct outside the data model rejected with its location | I1.1 |
| **I1.4** Markdown parser | the section tree of §5.3 from `mdast-util-from-markdown` positions: front matter, title heading, outline by heading level, data blocks, `$body` sliced from the source rather than re-serialized, the `<a>` element on headings and blocks, the byte ranges of block anchors (proposal §6.2), container blocks left as prose | I1.1, I0.5 |
| **I1.5** Keys and anchors | section keys as metadata (`@key`), derived anchors by vmd's rule with its repeat suffixes (proposal §6.3), the record's anchor table, tags, block anchors | I1.4, I0.7 |
| **I1.6** Addresses | the §7 grammar; exact resolution; semantic resolution over fields and `$sections` (schema-declared keys come in I2.3); canonical addresses (§7.5) | I1.5, I0.6 |
| **I1.7** Storage contract and local backend | the contract's TypeScript interface (§11.2); the filesystem backend's read operations; the portable regex checker for `grep`; file versions hashed from the bytes the backend returns, in a git working copy too, since the blob ids git stores reflect its clean filters; `storage-failed` for a read the backend cannot complete (decision K12) | I1.1 |
| **I1.8** CLI foundation | global options, `--config PATH` for a configuration kept outside the store (decision K3), output conventions (one line per item, `~tok`, default limits, cursors, `--json`), the issue format of §12.3, exit codes | I1.7 |
| **I1.9** Read commands | `ls`, `cat`, `grep`, `outline`, `get` with `--value`, `--body`, `--max-chars` | I1.6, I1.8 |
| **I1.10** Conformance runner | the TypeScript runner for the suite, in the private package `js/packages/conformance` (decision K11), run in CI | I0.3 |
| **I1.11** Demonstration | `vmd outline` and `vmd get` over the store `~/vampiredb/docs`, with `--config` and a configuration in `examples/vampiredb/`; timing of `design/Minimal_Log.md` (667 KB) | everything above |

Exit: the I0 fixtures for §4 to §7 pass; `vmd outline design/Minimal_Log.md` in the store `~/vampiredb/docs` runs in well under
a second; every heading and block anchor in vampiredb's docs resolves with `vmd get`.

---

## 4. I2: validate and references

Goal: `vmd check` finds every schema violation and every broken reference in a store, incrementally, with errors an agent can act
on.

| Task | Deliverable | Depends on |
|---|---|---|
| **I2.1** Configuration | the whole of `.vmd/config.yaml`, also through I1.8's `--config PATH`; collections, globs, `ignore`, the uniqueness mode; the path rules of §3.2 | I1.7 |
| **I2.2** Schemas | schema loading from JSON or YAML; Ajv for 2020-12 with the logical types of §4.3 as asserted formats, with vmd's own date and time checks, since `ajv-formats` differs from §4.3 on separators and offsets; `x-vmd-list` compiled to standard JSON Schema plus the uniqueness keyword; `x-vmd-ref`, `x-vmd-summary`, `x-vmd-ordered` | I2.1 |
| **I2.3** Keyed lists and uniqueness | semantic resolution through schema-declared keys; strict and lenient modes; cardinality checked for every address before evaluation | I1.6, I2.2 |
| **I2.4** References | extraction from Markdown links and link definitions (as offsets into `$body`), `$ref` objects, typed strings; URI resolution against the citing record; links that leave the store skipped; assets checked for existence | I1.6 |
| **I2.5** Local index | the four tables of §14.2 in `.vmd/cache/`, keyed by file version; re-parsing only changed files and re-resolving only the references into them | I2.4 |
| **I2.6** Commands | `check` (with `--changed REV`), `refs` (`--to`, `--from`, `--context`), `schema` | I2.3, I2.5 |
| **I2.7** vampiredb trial | `examples/vampiredb/`: a configuration and minimal schemas for vampiredb's `docs/` only, the store root of I1.11 | I2.6 |
| **I2.8** Demonstration | `vmd check` over vampiredb's docs compared with `scripts/docs.sh`: every broken link `docs.sh` reports inside `docs/`, `vmd` reports too; differences explained, among them links that leave `docs/` and so the store | I2.7 |

Exit: the I0 fixtures for §8 and §9 pass; a warm `vmd check` over vampiredb's docs takes under two seconds.

---

## 5. I3: query

Goal: VQL works over a store, in both targets, with the output of §10.5 and §12.2.

| Task | Deliverable | Depends on |
|---|---|---|
| **I3.1** VQL parser | the §10.2 grammar to an AST, with errors that point at a position in the query | I0 |
| **I3.2** Evaluator | field resolution (semantic dotted paths, pointers, pseudo-fields), comparisons by logical type and enum order, any-element matching, sections compared by `$body`, full-text tokens and phrases | I3.1, I2.3 |
| **I3.3** Targets | `records` and `nodes`; own-text matching for sections; field terms resolved upward through ancestors; per-collection defaults | I3.2 |
| **I3.4** Parameters | `fields` with `@match` and `@record`, a stable `sort`, `limit`, opaque cursors bound to the query and the head, `per_record`, `show`, `max_chars`, totals; the strict read mode of §9.5, whose first consumer is `query` (I1 design, section 5) | I3.3 |
| **I3.5** Output | `vmd query` with the grouped output of §12.2, excerpts, `-l` | I3.4, I1.8 |
| **I3.6** Fixtures and properties | VQL fixtures in the suite; a property test that printing an AST and parsing it again gives the same AST | I3.1 |
| **I3.7** Header-table importer and the eternal-circle store | a converter from the ticket header tables to front matter, also the migration tool of rollout step R3; in eternal-circle, a committed `.vmd/config.yaml` with collections and minimal schemas for the tickets, and the converted tickets, landed there through a pull request once `vmd check` passes (decision K3) | I1.4, I2.6 |
| **I3.8** Demonstration | the views of eternal-circle's `tickets/+index.md` and `index.html` (by status, severity, component, text search) reproduced with `vmd query` in eternal-circle; node queries over vampiredb's docs | I3.5, I3.7 |

Exit: the VQL fixtures pass; a query over two hundred tickets answers in under 200 ms.

---

## 6. Across phases

- **Performance budgets** are the exit timings above. Each phase's demonstration measures them; a miss is an issue, not a
  footnote.
- **Agent ergonomics.** The skill file for coding agents (§12.5 of the proposal) is drafted at the end of I1, and revised at the end
  of I2 and I3, from what the demonstrations showed.
- **Releases.** `@vollmond/cli` is published to npm as 0.x from the end of I1, so that agents in vampiredb can try it. Whether the
  package names are free is checked in I0.1.
- **The proposal moves with the code.** A fixture or an implementation that shows the spec wrong changes the spec and the decision
  log first.

## 7. Beyond I3

I4 (write), I5 (refactor), I6 (remote), I7 (publish) and I8 (later) are as the proposal's §21 describes. Their detailed plan is
written when I3 is nearly done, from what I0 to I3 have taught.
