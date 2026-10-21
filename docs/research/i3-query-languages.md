# Query languages for vmd: prior art for phase I3

Research for phase I3 (querying), 2026-10-20 and 2026-10-21, written before any design. The project owner asked for it on the
review desk on 2026-10-21 (UTC):

> I think we should try to first do some research into prior art. There are some interesting choices to be made, whether we only
> want a simple path language or we want to expand it into a larger query language (which could be a sql dialect + graph
> operations). My proposal would be to come up with like 5-10 mix of simple and complex queries /scenarios and then come up with
> a list of possible approaches: simple path language, sql, graphql, and other notable language styles that could be a good fit
> and write how example queries could look like in each of those languages.

So this document states nine scenarios taken from vmd's real stores, writes each of them in every approach that fits, compares
the approaches, and ends with observations and the questions a discussion should settle. It recommends nothing. It does not
change the proposal.

**A reader in a hurry** can read the scenarios (section 3), the two comparison tables (section 5), the observations (section 6)
and the open questions (section 7), and turn to an approach's section in 4 for its examples. In short:

- The draft's VQL expresses the lookups, filters, projections and section searches, and backlinks through `vmd refs` and
  `@refs`. It cannot express following a reference, joins over references, closure or counts, and it has no parameters bound
  outside the query text.
- Every other language needs vmd to export what only vmd computes (section keys, canonical addresses, resolved references, enum
  order); the mappings they need overlap almost entirely (O).
- None of them resolves a vmd address, and none keeps §7.4's proof that an address names one node, unless it hands addresses to
  vmd's own resolver.
- Graph languages (Cypher, SPARQL, Datalog) express references and closure in one pattern or rule, and they read best there
  (O). SQL can express every scenario, closure through recursive CTEs, and DuckDB reads the portable index's JSONL directly.
  GraphQL cannot express closure.
- Libraries exist for both TypeScript and Python for SQL, SPARQL, jq, GraphQL (parsers only), Cypher (native engines) and
  Datalog (in two different syntaxes). MongoDB's query language has an in-memory engine in TypeScript only; Python has testing
  mocks.

**How claims are marked**, as in the [parser survey](parser-survey.md):

- **D**: documented. The source is linked, and was read on 2026-10-20, or on 2026-10-21 where a passage says so.
- **M**: measured. The example was run on 2026-10-20, as section 4 describes.
- **H**: hypothetical. A mapping of vmd's data onto another model, or an extension of a language, that does not exist. Every
  example that relies on one says so.
- **U**: unverified. Taken from a secondary source, or not checked.
- **O**: the author's opinion, for the discussion to accept or reject.

Every query written in a real language uses only constructs its documentation shows, and the section of each approach names the
pages. Where vmd's data needs a shape the language does not have, the shape is **H** and is stated once, at the top of the
approach.

## 1. What vmd already says about querying

- **VQL** (§10) is a filter language in the style of GitHub and Lucene search: `status:open severity:>=high -type:task`, with
  `AND`, `OR`, `NOT` and parentheses, comparisons by logical type and enum order, prefix and full-text terms, and pseudo-fields
  (`@path`, `@key`, `@refs`, `@issues`...). Sorting, projection, paging and the target are parameters, not syntax (§10.1, §10.5). A
  query matches records or sections (`target: records` or `nodes`, §10.4), and in `nodes` mode a field term resolves on the section
  and then on its ancestors.
- **Engines.** "Other query languages can be added as engines" (§10.1), through `compile(query, schemas) → plan` and
  `execute(plan, snapshot) → results`, whose results "are addresses with projected values and a cursor" (§18.2, which names
  GraphQL, SQL over the index and JSONPath). §18.3 sketches a GraphQL engine generated from the collections' schemas. An optional,
  read-only **SQL profile** over the index views of §14.2 "is not part of the core and clients must not depend on it" (§10.6).
- **Addresses and selectors.** An address is singular when it must resolve to exactly one node, as every reference and every write
  target must, and the checker proves this from the schema before evaluating it (§7.4). A selector may name several nodes, returns
  them in document order (R5, selectors return their matches in document order) and an empty result when nothing matches (C19).
  Tag selection in addresses waits for a selector-language design, issue #47, which is to cover and, or and not, filtering
  against projection with descent, and a final projection (F7, tag selection is deferred to a selector-language design).
- **The owner's requirement** (v0.1-6, a platform-independent query language): "An implementation that doesn't use git or
  sqllite should ideally be easy to implement at least the core of the language, and preferably, different programmic languages
  should be viable to implement the query language interpreset. A simple key:value and/or or similar may be sufficient. But an
  existing standard languages like SQL are also on the table (if they have a libraries for common langugages, or if implementing
  interpreter from scratch was feasible)".
- **Determinism.** Ties sort by store path as exact UTF-8 bytes, then by document order (C25), and case-insensitive matching is
  Unicode simple case folding (F10). The conformance suite checks VQL's results in both targets (§19.1).
- **The plan.** Phase I3 builds the VQL parser and a scanning evaluator, both targets, the parameters, the output and the
  fixtures (I3.1 to I3.6, issues #29 to #34), the header-table importer for the tickets (I3.7, #35) and a demonstration that
  reproduces the ticket index's views, by status, severity, component and text search, with `vmd query` (I3.8, #36). An
  adversarial audit of the decisions follows (I3.9, #45). The GraphQL engine and the SQL profile are listed for I8 (§21).

## 2. The stores the scenarios come from

The examples treat three sources as the three collections of one store:

- **`decisions/`**, collection `decisions`: vollmond's own decision records, `docs/decisions/` in this repository (308 records,
  real data). Front matter: `id`, `title`, `round`, `date`, `status` (accepted, superseded or reversed), `supersedes` and
  `superseded_by` (arrays of typed references to other decisions, such as `[C20.md]`), `sections` (the specification's sections
  it touches, such as `"§7.4"`), `decided_by` and `sources` (cards, chat times, pull request and issue numbers, commits). Sections:
  Question, Options, Decision, Why, Owner's note (key `owners-note`) and Applied in. Bodies link other decisions in Markdown.
- **`tickets/`**, collection `tickets`: a ticket store shaped like the draft's Appendix A, as eternal-circle's tickets will be
  after the importer of I3.7 (**H**: today those tickets carry their fields in a header table in prose). Fields: `status` (Open,
  In progress, Blocked, Closed), `severity` (Critical to Unknown, `x-vmd-ordered: desc`), `type`, `component` (an array, such as
  `[log-v3, sim]`), `opened` (a date) and `parent`. A ticket's key is its id, such as `TKT-0001` (an illustrative id).
- **`docs/`**, collection `docs`: vampiredb's design documents (real), long Markdown files whose sections carry explicit anchors
  and link one another. `design/Minimal_Log.md` alone is 667 KB, roughly 165k tokens, as the draft's review measured it
  ([review, section 3](../draft/vollmond-proposal-review.md#3-agent-ergonomics)).

Two facts the examples rely on, measured on this repository today: `vmd refs F7.md` over `docs/decisions/` lists three references,
all from C20 (`#superseded_by/0`, `#decision/$body`, `#applied-in/$body`); and following `superseded_by` from F4 any number of
times reaches G3 (reversed), G3a (superseded), G3c (reversed), G3d (accepted) and U21 (accepted).

For S6 only, the decisions also carry `tickets`, an array of typed references to tickets (**H**). Today a decision cites GitHub
issue numbers in `sources.issues`, and those are not records.

## 3. The scenarios

Each is stated in English first. They run from a lookup that vmd answers today to questions no part of the draft answers.

| | Scenario | What it exercises |
|---|---|---|
| S1 | **Lookup by address.** Show the Decision section of decision F7. | one node by a singular address |
| S2 | **Filter.** Tickets that are not closed, of severity High or worse, in component `log-v3`. | fields, negation, enum order, arrays |
| S3 | **Projection.** For every decision of round U: its id, status, date and the text of its Decision section, newest first. | projection into a section, sort, ties |
| S4 | **Search inside sections.** Decisions whose Owner's note mentions "selector", with each matching section's address and an excerpt. | full text scoped to one section of each record |
| S5 | **References both ways.** (a) The titles of the decisions that G9 supersedes. (b) Every reference into F7.md, typed or a Markdown link, with the citing record, the field or section it is in, and its status. | following a typed reference; backlinks |
| S6 | **Multi-hop.** Decisions that were superseded by a decision that cites a ticket still open. | a join over two references and a filter on the far end |
| S7 | **Transitive closure.** Everything that replaced F4, directly or through later decisions, with each one's status. | a path of any length |
| S8 | **Aggregate.** How many tickets that are not closed there are per component and severity, a ticket counting once in each of its components. | grouping over an array field |
| S9 | **A parameterised query an agent reuses.** Given a section of the specification (`§7.4`) and a status (default `accepted`): the decisions with that status that touch the section, newest first, with id and title. An agent runs it before changing a section. | parameters bound outside the query text |

## 4. The approaches

The approaches are taken in this order: vmd's own path language first (4.1), then SQL and a pipeline language over the same
tables (4.2, 4.3), GraphQL (4.4), jq (4.5), the graph languages Cypher and GQL (4.6) and SPARQL (4.7), Datalog (4.8), Dataview's
DQL (4.9) and MongoDB's query documents (4.10). Section 4.11 gives the languages that were considered and dropped as approaches,
with what each still offers as prior art. Each approach has the same parts: what it is and how vmd's data would map onto it, its
prior art and libraries, the nine scenarios, and notes for the comparison of section 5.

**Every approach but the first needs a mapping of vmd's data, and every mapping is H.** vmd has no SQL tables with these columns,
no property graph, no RDF, no fact database and no JSON export with its computed fields. Each approach states its mapping once,
at its top. Section 6 compares what the mappings have in common.

**How the examples were checked.** Every construct was checked against the language's documentation, read on 2026-10-20 and
linked where it is used. Some examples were also run, and are marked **M** (measured): run on 2026-10-20 on data built for the
purpose, outside the repository. The scripts are not part of this document.

- SQL (SQLite and SQL/PGQ), PRQL and KQL ran against a throwaway database built from real data: the 308 decision records of
  `docs/decisions/` (front matter parsed with the `yaml` package, sections split at `## `, Markdown links to `*.md` and the
  `supersedes` and `superseded_by` fields turned into reference rows) and a synthetic set of six tickets in the header-table
  form, read as the I3.7 importer would (status, severity and component). For S6, two references were added by hand: decision
  G3d cites an open ticket and U21 a closed one, so that a decision superseded only by U21 is a near miss. The same queries
  were also run over eternal-circle's real tickets, with results consistent with its generated index; they are not reported
  here, since that store is internal. This database stands in for vmd's index and is not vmd: its section keys come from a simple
  slug, and it holds only links to `.md` files in the same directory. SQLite ran in Node 24.21.0's `node:sqlite` (SQLite 3.53.4)
  and Python 3.9.6's `sqlite3` (SQLite 3.51.0); SQL/PGQ in DuckDB 1.4.4 with the `duckpgq` extension; PRQL through `prqlc`
  0.13.14, compiled to SQLite; KQL through `duckdb-kql` 1.0.11, a third-party translator to DuckDB, which shows that the text
  parses as KQL to that translator, not what Kusto would answer. All four agree: over the synthetic tickets, S2 gives the two
  log-v3 tickets that are not closed and are High or Critical, S6 gives G3c alone (G3d, superseded only by U21, is left out),
  and S8 gives six counts, the ticket with two components counted under each;
  over the decisions, S5b gives C20's three
  references, as `vmd refs F7.md` does; S7 gives G3, G3a, G3c, G3d and U21, with G3d and U21 accepted; S9 gives 10 accepted
  decisions for `§7.4`.
- jq, JSONPath, JMESPath and XQuery ran on a small synthetic store of 12 records and 8 reference rows, in the export shape of
  section 4.5: jq 1.7.1, Python's `jsonpath-rfc9535` 1.0.1 and `jmespath` 1.1.0, and `saxonche` 13.1.0 for XQuery. The run
  checks that the syntax is real, not what vmd's data gives.
- The GraphQL, Cypher, SPARQL, Datalog, Dataview and MongoDB examples were checked against documentation only, and not run.

### 4.1 vmd's own path language: today's addresses, selectors and VQL, extended

**What it is.** The language vmd already has: an address names one node (`decisions/F7.md#decision`, §7), a selector may name
several (§7.4), and VQL filters records or sections with `field:value` terms in the style of GitHub and Lucene search (§10). Sorting,
projection, paging and the target (records or sections) are parameters, not syntax (§10.1, §10.5). Backlinks come from
`vmd refs` (§12.1). The data model needs no mapping: the language is defined on the value view, the computed `@` fields and the
references, so `status:open` matches a `status` field or a `## Status` section (§10.3), which no other approach does without a
mapping layer.

Extending it means adding, one at a time, the constructs that the scenarios below miss. Each one here is **H**: none is in the
draft, and the syntax is only a placeholder to make the examples concrete. Each borrows from a named system:

| H extension | Placeholder | Borrowed from |
|---|---|---|
| follow a typed reference in a field path | `supersedes->title` | path traversal through links in EdgeQL, Dataview and GraphQL (sections 4.11, 4.9, 4.4) |
| repeat a step one or more times | `superseded_by->+` | SPARQL 1.1 property paths (`+`), Cypher's variable-length patterns (sections 4.7, 4.6) |
| several values for one field | `status:(open OR blocked)` | Lucene's "field grouping": "Lucene supports using parentheses to group multiple clauses to a single field", as in `title:(+return +"pink panther")` ([Lucene 10.3.0 classic query parser](https://lucene.apache.org/core/10_3_0/queryparser/org/apache/lucene/queryparser/classic/package-summary.html), read on 2026-10-21); GitHub's issue search documents a comma form for labels, `label:"bug","wip"` (section 4.11) |
| a command that evaluates a selector | `vmd select SELECTOR` | the selector-language design of #47 |
| counts per value, as a parameter | `--count-by component,severity` | Solr's facets: `facet.field` gives "a facet count using that Term as the constraint", and `facet.pivot` counts across several fields ([Solr 10.0 guide, Faceting](https://solr.apache.org/guide/solr/latest/query-guide/faceting.html), read on 2026-10-20) |
| named parameters | `{section}` with `--param section=§7.4` | GraphQL variables and SQL's bound parameters (sections 4.4, 4.2) |

**Prior art.** The draft's own: VQL follows GitHub's and Lucene's search syntax (§10.1, Appendix C); addresses are RFC 3986
fragments, with JSON Pointer (RFC 6901) for exact paths (§7.1, §7.2). Section 4.11 covers JSONPath, JMESPath, XPath and CSS
selectors, which #47 names as the selector language's starting points. Implementations: none outside vmd. The draft estimates "a
scanning interpreter is a few hundred lines in Python or TypeScript" (§10.6); that is the draft's estimate, not a measurement.

**The scenarios.**

S1, D (§7.3, §12.1). A singular address, proved before it is evaluated (§7.4).

```sh
vmd get decisions/F7.md#decision --body
```

S2, D (§10.2, §10.3; `x-vmd-ordered: desc` makes `>=high` mean High or Critical, Appendix A).

```sh
vmd query tickets '-status:closed severity:>=high component:log-v3'
```

S3, D (§10.5: projection paths resolve as field terms do, and `decision.$body` is a dotted semantic path to the Decision
section's prose; ties sort by store path, C25). The single quotes keep the shell from expanding `$body` (§12.4).

```sh
vmd query decisions 'round:U' --fields 'id,status,date,decision.$body' --sort date:desc
```

S4, D (§10.4: in `nodes` mode full text covers a section's own `$title` and `$body`; `@key` is a pseudo-field, §10.3; the
default `show` is an excerpt, §10.5). A word matches whole tokens and `value*` a prefix (§10.3), and the one Owner's note in
vollmond's decisions that mentions the word, C20's, says "selectors", so the plain word `selector` would find nothing; the prefix
form finds it. SQL's FTS5 behaves the same way (section 4.2).

```sh
vmd query decisions '@key:owners-note selector*' --nodes
```

S5a. Not one command today: read the reference, then its target (D). With the H `->`, one projection.

```sh
vmd get decisions/G9.md#supersedes --value     # ["F9.md"]
vmd get decisions/F9.md#title

vmd query decisions '@path:decisions/G9.md' --fields 'supersedes->title'     # H
```

S5b, D. `refs` lists every reference into the record with its citing node, position and status (§12.1); `@refs` makes the
citing nodes query results (§10.3). Today, on vollmond's decisions, `vmd refs F7.md` lists three references from C20:
`#superseded_by/0`, `#decision/$body` and `#applied-in/$body`, all `ok`.

```sh
vmd refs decisions/F7.md
vmd query '@refs:decisions/F7.md' --nodes
```

S6, H. A field path through two references, with VQL's rule that a term on several values is true when any of them matches
(§10.3), and Lucene-style value grouping. Negation needs care under that rule: `-superseded_by->tickets->status:closed` would
mean "no cited ticket is closed", not "some cited ticket is open".

```sh
vmd query decisions 'status:superseded superseded_by->tickets->status:(open OR "in progress" OR blocked)'
```

S7, H. A selector that follows `superseded_by` one or more times from F4, evaluated by a selector command. Its matches would come
back in a defined order, as every selector's do (R5), which for a traversal across records the draft does not yet define.

```sh
vmd select 'decisions/F4.md#superseded_by->+' --fields id,status
```

S8, H. Counts as a parameter, like `--sort`; each element of the array `component` counts once.

```sh
vmd query tickets '-status:closed' --count-by component,severity
```

S9. Today an agent substitutes shell variables (D), which breaks on a value holding a space, a parenthesis or a quote, since VQL
has no parameters. The H form binds the values outside the query text.

```sh
vmd query decisions "sections:$SECTION status:${STATUS:-accepted}" --fields id,title --sort date:desc

vmd query decisions 'sections:{section} status:{status}' --param section=§7.4 --param status=accepted \
  --fields id,title --sort date:desc                                                   # H
```

**For the comparison.**

- Expressiveness: S1 to S4 yes today, S5b yes today through `refs` and `@refs`, S9 partly (no parameters). S5a, S6, S7 and S8 need
  the H extensions above.
- Readability (O): the shortest form of every scenario here, because the parameters carry sort, projection and paging; it gets
  harder to read with each extension, and `->` with `+` and grouping is a small new language of its own.
- Implementation (D for the draft's estimate, O otherwise): no library to reuse in either language, and none needed for the core;
  each H extension is the project's own to specify, fixture and implement twice.
- Agents (O): nothing to learn beyond a skill file for S1 to S4, and the syntax is already familiar from GitHub search. No agent has
  seen the extensions, so they need examples in the skill file.
- Singular addresses: the guarantee is native. An address is a singular address by the rules of §7.4, a selector is not, and
  only addresses are references or write targets. A `->` step could keep the proof (O): an index step into a non-keyed array names
  one item, and a reference declared `cardinality: one` names one target, so `decisions/G9.md#supersedes/0->title` could be proved
  singular from the schema.
- CLI: one argument, single-quoted (§12.4). `->` holds `>`, which the shell reads as a redirection when unquoted.
- Portable index: the draft has a website "load it whole and run VQL in the browser" over `records-*.jsonl` (§14.4), but those
  lines hold the record's key, title and summary fields only (§14.2). S2, S3 and S8 filter, project or count other fields, or a
  section's text, so they need the value views (`values/<path>.json`) or the nodes as well; traversals and closure need
  `refs-*.jsonl`. That is the same standard as the other approaches' cells.

### 4.2 A SQL dialect over vmd's index tables

#### Description

SQL over the tables of draft §14.2 (`records`, `nodes`, `refs`, `issues`), with joins for references, `WITH RECURSIVE` for
transitive closure and, as an option, SQL/PGQ (`GRAPH_TABLE ... MATCH`) for graph patterns. §10.6 already allows "an optional
SQL profile (read-only SQL over defined index views)" outside the core. The examples use SQLite's dialect; DuckDB reads the
portable index's JSONL files directly (below).

**What §14.2 lacks (H).** The examples need these, none of which §14.2 defines:

| Needed | Why | Mapping used here (H) |
|---|---|---|
| `records.value` | §14.2 keeps only "summary fields"; filters and projections need every field | the value view as JSON text, as the portable index's optional `values/<path>.json` holds it (§14.4) |
| per-collection views (`decisions`, `tickets`) with typed columns | `value ->> '$.status'` in every query is noise, and `$title`-like names need quoting in a JSON path | `CREATE VIEW decisions AS SELECT path, key AS id, value ->> '$.title' AS title, ...` generated from the collection's schema |
| `nodes.body` | full text and projections of a section's prose | the section's own `$body` |
| `nodes.address` | printing canonical addresses | `@address` (§7.5) of the node |
| `refs.target_path`, `refs.source_exact_path` | §14.2 names "source path and exact path" and "target address, resolved exact path" but no column names; joins need the target's record path apart from its fragment | the record part of the resolved target |
| `field_refs` view | which field a typed reference sits in | the first token of `source_exact_path`, for references outside `$sections` |
| an FTS5 table `node_text` | whole-word search with excerpts | `CREATE VIRTUAL TABLE node_text USING fts5(path UNINDEXED, exact_path UNINDEXED, body)` |
| enum order | `severity >= High` uses `x-vmd-ordered` (§9.3), which SQL cannot see | written out as `IN ('Critical', 'High')`; or an `enum_order` table generated from schemas (H) |
| case folding | VQL folds case by Unicode simple case folding (§10.3) | none: SQLite's `=` is byte comparison, `NOCASE` folds only the 26 ASCII letters (D, [datatype3](https://sqlite.org/datatype3.html)) |

The views used by every example (H), each run (M):

```sql
CREATE VIEW decisions AS
SELECT path, key AS id, value ->> '$.title' AS title, value ->> '$.round' AS round,
       value ->> '$.date' AS date, value ->> '$.status' AS status, value -> '$.sections' AS sections
FROM records WHERE collection = 'decisions';

CREATE VIEW tickets AS
SELECT path, key, title, value ->> '$.status' AS status, value ->> '$.severity' AS severity,
       value -> '$.component' AS component, value ->> '$.opened' AS opened
FROM records WHERE collection = 'tickets';

CREATE VIEW field_refs AS
SELECT source_path,
       substr(source_exact_path, 2, instr(substr(source_exact_path, 2) || '/', '/') - 1) AS field,
       target_path, status
FROM refs
WHERE substr(source_exact_path, 1, 11) <> '/$sections/';
```

`field_refs` ignores JSON Pointer escapes (`~0`, `~1`) in field names (H, a simplification).

#### Prior art and libraries

- **SQLite JSON functions** are "built into SQLite by default, as of SQLite version 3.38.0 (2022-02-22)", with the `->` and
  `->>` operators from the same version; `json_each` and `json_tree` are table-valued functions with the columns `key`,
  `value`, `type`, `atom`, `id`, `parent`, `fullkey` and `path` (D, [sqlite.org/json1.html](https://sqlite.org/json1.html)).
  A path is `$` followed by labels and indexes; the page does not say how to quote a label such as `$title`. `$."$title"` works
  in SQLite 3.53.4 and 3.51.0 (M), but is undocumented there (U as a guarantee).
- **Recursive CTEs**: `WITH RECURSIVE`; with `UNION` "repeated rows are discarded", which stops cycles, while `UNION ALL` can
  loop on cyclic data; the recursive table appears once in the recursive select's FROM, and the recursive select may not use
  aggregates (D, [sqlite.org/lang_with.html](https://sqlite.org/lang_with.html)).
- **FTS5**: `CREATE VIRTUAL TABLE ... USING fts5(...)`, `MATCH`, `snippet()`; in the amalgamation since 3.9.0, "currently disabled by
  default for the source-tree configure script and enabled by default for the amalgamation configure script"; the default `unicode61` tokenizer is case-independent and removes Latin diacritics (D,
  [sqlite.org/fts5.html](https://sqlite.org/fts5.html)). Its folding is not vmd's simple case folding (O: likely to differ on
  edge cases, not measured).
- **Parameters**: `?`, `?NNN`, `:AAAA`, `@AAAA`, `$AAAA` (D, [sqlite.org/lang_expr.html](https://sqlite.org/lang_expr.html)).
  The same page: "The value of a subquery expression is the first row of the result" — a scalar subquery that finds two rows
  silently takes the first, the "first occurrence wins" that §5.7 forbids.
- **LIKE** folds only ASCII and treats `_` and `%` as wildcards (D, same page), so `LIKE '/superseded_by/%'` matches more than
  it says unless `_` is escaped.
- **SQL/PGQ** (ISO/IEC 9075-16:2023): `CREATE PROPERTY GRAPH` over existing tables, then `GRAPH_TABLE (g MATCH ... COLUMNS
  (...))`.
  - DuckDB's `duckpgq` community extension: "It is not available in the latest DuckDB release (1.5.x) ... make sure to use
    DuckDB v1.4.4" (D, [duckdb.org graph queries guide](https://duckdb.org/docs/current/guides/sql_features/graph_queries));
    quantifiers `*`, `+`, `{n,m}`, `{,m}`, `{n,}`; "DuckPGQ only supports finding ANY SHORTEST path between nodes, which is
    non-deterministic"; `OPTIONAL MATCH` not supported (D, [duckpgq.org/documentation/sql_pgq](https://duckpgq.org/documentation/sql_pgq/)).
    That limit is on unbounded searches: a bounded `->{1,10}` without `ANY SHORTEST` runs on DuckDB 1.4.4 and gives S7's five
    decisions with their hop counts (M).
  - Oracle Database: quantifiers `{n}`, `{n, m}`, `{, m}`, `?`, with "the maximum upper bound limit ... 10", and no path
    variables (D, [Oracle Property Graph Developer's Guide 23.2, SQL GRAPH_TABLE Queries](https://docs.oracle.com/en/database/oracle/property-graph/23.2/spgdg/sql-graph-queries.html);
    a 23.2 page, possibly dated for 23ai's later releases, U).
- **DuckDB and the portable index**: `read_json` auto-detects the format, `read_ndjson` reads newline-delimited JSON, and
  "Multiple files can be read at once by providing a glob" (D, [duckdb.org loading JSON](https://duckdb.org/docs/current/data/json/loading_json)).
  `read_json('records-*.jsonl')` read the exported JSONL with struct access such as `value.status`, over both collections'
  differently shaped values (M). DuckDB-Wasm is "a version of DuckDB that has been compiled to WebAssembly" and reads remote
  HTTP(S) files through a virtual filesystem (D, [duckdb.org Wasm overview](https://duckdb.org/docs/current/clients/wasm/overview));
  `json` and `fts` are among the extensions used with it, and "a growing subset of core, community, and external extensions is
  supported" (D, [duckdb.org Wasm extensions](https://duckdb.org/docs/current/clients/wasm/extensions)); whether `duckpgq`
  loads in Wasm is not said (U).

| Library | Runtime | Licence | Latest (as read) | Notes |
|---|---|---|---|---|
| `node:sqlite` | Node | (Node) | in Node since v22.5.0 | "Stability: 1.2 - Release candidate" in Node 24, since v24.15.0, whose changelog says "SQLite is now a release candidate" (D, [nodejs.org v24 sqlite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html), read on 2026-10-20); on Node 24.21.0 it loads without a warning, and its build has JSON and FTS5 (M) |
| `better-sqlite3` | Node (native addon, prebuilt binaries) | MIT | 13.0.3, 2026-08-05 (npm registry) | bundled SQLite 3.53.4 with `SQLITE_ENABLE_FTS5` and `SQLITE_ENABLE_JSON1` (D, [docs/compilation.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md)); a native module, which vmd's reference implementation avoids for its index (§14.3) |
| `sql.js` | browser and Node (Wasm) | MIT | 1.15.1, 2026-10-19 | in-memory, "doesn't persist the changes" (D, [github.com/sql-js/sql.js](https://github.com/sql-js/sql.js)); its Makefile enables FTS3, not FTS5 (D, [Makefile](https://raw.githubusercontent.com/sql-js/sql.js/master/Makefile)) |
| SQLite's own Wasm build | browser | public domain | | "enable the use of sqlite3 in modern WASM-capable browsers", with OPFS persistence (D, [sqlite.org/wasm](https://sqlite.org/wasm/doc/trunk/index.md)); FTS5 in it not stated (U) |
| `sqlite3` | Python stdlib | PSF | | "requires the third-party SQLite library", an optional module whose SQLite version depends on the build (D, [docs.python.org sqlite3](https://docs.python.org/3/library/sqlite3.html)); `:name` and `?` placeholders |
| `@duckdb/node-api` | Node | MIT | 1.5.6-r.2, 2026-10-20 | DuckDB's current Node client |
| `@duckdb/duckdb-wasm` | browser | MIT | 1.33.1-dev57.0 tagged latest, 2026-06-22 | the docs give 1.5.6 as the latest stable (D, Wasm overview); the npm `latest` tag is a dev build (M, registry) |
| `duckdb` | Python | MIT | 1.5.6, 2026-09-28 (PyPI) | `duckpgq` needs 1.4.4 (above) |

Versions and dates are from registry.npmjs.org and pypi.org, read on 2026-10-20.

#### The scenarios in SQL (SQLite)

**S1. Lookup by address.** SQL cannot resolve a vmd address: this finds the section by key at depth 1, which is the address's
meaning only for a first step that is a top-level key. A derived anchor, a deep explicit anchor, a semantic path of several steps
or an alias needs vmd's resolver (H: a table-valued function `vmd_resolve(address)`, or the `anchors` column of §14.2's
`nodes`).

```sql
SELECT body FROM nodes WHERE path = 'decisions/F7.md' AND key = 'decision' AND depth = 1;
```

**S2. Filter.** The enum order is written out; `x-vmd-ordered` is invisible to SQL (H otherwise).

```sql
SELECT t.key, t.status, t.severity FROM tickets t
WHERE t.status <> 'Closed'
  AND t.severity IN ('Critical', 'High')
  AND EXISTS (SELECT 1 FROM json_each(t.component) c WHERE c.value = 'log-v3')
ORDER BY t.path;
```

**S3. Projection.** `ORDER BY ... d.path` is vmd's tie order: SQLite's default BINARY collation "Compares string data using
memcmp()" (D, [datatype3](https://sqlite.org/datatype3.html)), which is byte order for UTF-8 text, as C25 requires.

```sql
SELECT d.id, d.status, d.date, n.body AS decision
FROM decisions d
LEFT JOIN nodes n ON n.path = d.path AND n.depth = 1 AND n.key = 'decision'
WHERE d.round = 'U'
ORDER BY d.date DESC, d.path;
```

**S4. Search inside sections** (FTS5 table H). `'selector'` matches whole tokens and found nothing, since C20's note says
"selectors"; the prefix query `'selector*'` finds it (M), as VQL's `selector*` would (§10.3).

```sql
SELECT n.address, snippet(node_text, 2, '[', ']', '…', 12) AS excerpt
FROM node_text
JOIN nodes n ON n.path = node_text.path AND n.exact_path = node_text.exact_path
WHERE node_text MATCH 'selector*'
  AND n.key = 'owners-note'
  AND n.path GLOB 'decisions/*'
ORDER BY n.path;
```

**S5. References both ways.** (a) uses `refs`, not `json_each(value -> '$.supersedes')`: the stored value is the relative
text `F9.md`, and only vmd's index holds the resolved target. (b) is one table scan, since `refs` holds Markdown links and
typed references alike.

```sql
-- (a) forward
SELECT d.id, d.title
FROM field_refs f JOIN decisions d ON d.path = f.target_path
WHERE f.source_path = 'decisions/G9.md' AND f.field = 'supersedes';

-- (b) backlinks
SELECT source_path, source_exact_path, status
FROM refs
WHERE target_path = 'decisions/F7.md'
ORDER BY source_path, source_exact_path;
```

**S6. Multi-hop** (the `tickets` field is H).

```sql
SELECT DISTINCT d.id, d.title
FROM decisions d
JOIN field_refs s ON s.source_path = d.path AND s.field = 'superseded_by'
JOIN field_refs c ON c.source_path = s.target_path AND c.field = 'tickets'
JOIN tickets t ON t.path = c.target_path
WHERE t.status <> 'Closed'
ORDER BY d.path;
```

**S7. Transitive closure.** `UNION` (not `UNION ALL`) stops a cycle, which a hand-edited `superseded_by` could create.

```sql
WITH RECURSIVE replaced_by(path) AS (
  SELECT target_path FROM field_refs
  WHERE source_path = 'decisions/F4.md' AND field = 'superseded_by'
  UNION
  SELECT f.target_path FROM field_refs f JOIN replaced_by r ON f.source_path = r.path
  WHERE f.field = 'superseded_by'
)
SELECT d.id, d.status, d.status = 'accepted' AS in_force
FROM replaced_by JOIN decisions d USING (path)
ORDER BY d.path;
```

**S8. Aggregate.** `json_each` unnests the component array; severities sort alphabetically, not by the enum's order.

```sql
SELECT c.value AS component, t.severity, count(*) AS tickets
FROM tickets t, json_each(t.component) c
WHERE t.status <> 'Closed'
GROUP BY c.value, t.severity
ORDER BY c.value, t.severity;
```

**S9. Parameterised.** Named parameters; `:status` left NULL takes the default. `$section` would also be valid SQLite, and is
what a shell expands inside double quotes (§12.4).

```sql
SELECT d.id, d.title, d.date
FROM decisions d
WHERE d.status = coalesce(:status, 'accepted')
  AND EXISTS (SELECT 1 FROM json_each(d.sections) s WHERE s.value = :section)
ORDER BY d.date DESC, d.path;
```

#### S6 and S7 in SQL/PGQ (DuckDB 1.4.4 with duckpgq), run (M)

The tables `decisions`, `tickets`, `superseded_by` and `cites` (edge tables with `source_path`, `target_path`) were created
from the JSONL with `read_json` (H: edge tables per reference field).

```sql
INSTALL duckpgq FROM community;
LOAD duckpgq;

CREATE PROPERTY GRAPH store
  VERTEX TABLES (decisions, tickets)
  EDGE TABLES (
    superseded_by SOURCE KEY (source_path) REFERENCES decisions (path)
                  DESTINATION KEY (target_path) REFERENCES decisions (path),
    cites         SOURCE KEY (source_path) REFERENCES decisions (path)
                  DESTINATION KEY (target_path) REFERENCES tickets (path)
  );

-- S6
SELECT DISTINCT id, title FROM GRAPH_TABLE (store
  MATCH (d:decisions)-[s:superseded_by]->(d2:decisions)-[c:cites]->(t:tickets WHERE t.status <> 'Closed')
  COLUMNS (d.id, d.title)
) ORDER BY id;

-- S7: + is one or more hops; an unbounded ->+ needs ANY SHORTEST in duckpgq,
-- while a bounded ->{1,10} runs without it and gives the same five decisions (M)
FROM GRAPH_TABLE (store
  MATCH p = ANY SHORTEST (a:decisions WHERE a.id = 'F4')-[s:superseded_by]->+(b:decisions)
  COLUMNS (b.id, b.status, b.status = 'accepted' AS in_force, path_length(p) AS hops)
) ORDER BY id;
```

S7 returned the five decisions with hops 1, 2, 2, 3, 3 (M). In Oracle's dialect the same S7 needs a bound of at most 10 and
`IS` labels, `-[e IS superseded_by]->{1,10}` (D, Oracle 23.2 guide; not run).

#### DuckDB directly over the portable index (M)

```sql
SELECT collection, count(*) FROM read_json('records-*.jsonl') GROUP BY ALL;
SELECT key, value.status FROM read_json('records-*.jsonl') WHERE collection = 'tickets' AND value.status <> 'Closed';
```

### 4.3 A pipeline language: PRQL

**Description.** PRQL is a pipeline of transforms (`from`, `filter`, `derive`, `select`, `join`, `group`, `aggregate`,
`sort`, `take`, `loop`) that compiles to SQL; it has no engine of its own, so over vmd it needs the same tables and views as SQL
(4.2, H). Targets include `sql.sqlite`, `sql.duckdb`, `sql.postgres` and `sql.generic`, chosen with a `prql target:sql.sqlite`
header (D, [prql-lang.org target](https://prql-lang.org/book/project/target.html)).

**Prior art and libraries.**
- `loop` "Iteratively applies `step` function to `initial` relation until the `step` returns an empty table", is marked
  "Experimental", and compiles to `WITH RECURSIVE` with `UNION ALL` (D, [loop](https://prql-lang.org/book/reference/stdlib/transforms/loop.html)),
  so it does not stop on a cycle (M: the compiled S7 below uses `UNION ALL`). The same page warns that "loop may produce
  references to the recursive CTE in sub-queries, which is not supported by some database engines, e.g. SQLite"; S7's step is a
  single `SELECT`, and it ran on SQLite (M).
- `join side:{inner|left|right|full} rel (condition)`, with `==col` for equal names and `a=artists` aliases (D,
  [join](https://prql-lang.org/book/reference/stdlib/transforms/join.html)); `group {cols} (aggregate {...})` (D,
  [group](https://prql-lang.org/book/reference/stdlib/transforms/group.html)); `sort {-age}` for descending (D,
  [sort](https://prql-lang.org/book/reference/stdlib/transforms/sort.html)); parameters `$id` "where id is an arbitrary alpha
  numeric string" (D, [parameters](https://prql-lang.org/book/reference/syntax/parameters.html)); `text.contains`,
  `text.starts_with` and the other `text` functions (D, [stdlib](https://prql-lang.org/book/reference/stdlib/)); `??` coalesce
  (D, [operators](https://prql-lang.org/book/reference/syntax/operators.html)); s-strings, "an escape hatch when there's
  something that PRQL doesn't yet implement" (D, [s-strings](https://prql-lang.org/book/reference/syntax/s-strings.html)).
- PRQL has no unnest of a JSON array and no JSON path access of its own (U: not found in the stdlib page); S2, S8 and S9 use
  two more views (H): `ticket_components(path, component)` and `decision_sections(path, section)`, each a `json_each`.
- Bindings: JavaScript, Python, R and Rust are "Supported"; packages are published as `prqlc` where possible (D,
  [bindings](https://prql-lang.org/book/project/bindings/index.html)). npm `prqlc` 0.13.14 (2026-07-24, Apache-2.0,
  "JavaScript bindings for prqlc"); PyPI `prqlc` 0.13.14 (2026-07-24); the older npm `prql-js` stopped at 0.12.1 (2024-06-09)
  (M, registries). Pre-1.0.

**The scenarios** (each compiled by prqlc 0.13.14 to SQLite and run, M):

```prql
# S1
from nodes
filter (path == "decisions/F7.md" && key == "decision" && depth == 1)
select {body}
```

```prql
# S2
from t = tickets
filter t.status != "Closed"
filter (t.severity == "Critical" || t.severity == "High")
join c = ticket_components (==path)
filter c.component == "log-v3"
sort {t.path}
select {t.key, t.status, t.severity}
```

```prql
# S3
from d = decisions
filter d.round == "U"
join side:left n = nodes (d.path == n.path && n.depth == 1 && n.key == "decision")
sort {-d.date, d.path}
select {d.id, d.status, d.date, decision = n.body}
```

```prql
# S4: substring match (LIKE), no tokens; the excerpt needs an s-string
from nodes
filter key == "owners-note"
filter (path | text.starts_with "decisions/")
filter (body | text.contains "selector")
sort {path}
select {address, excerpt = s"substr({body}, max(instr(lower({body}), 'selector') - 40, 1), 120)"}
```

```prql
# S5 (a) forward
from f = field_refs
filter (f.source_path == "decisions/G9.md" && f.field == "supersedes")
join d = decisions (d.path == f.target_path)
select {d.id, d.title}
```

```prql
# S5 (b) backlinks
from refs
filter target_path == "decisions/F7.md"
sort {source_path, source_exact_path}
select {source_path, source_exact_path, status}
```

```prql
# S6: `group {d.path} (take 1)` is PRQL's distinct; it compiles to ROW_NUMBER() OVER (PARTITION BY ...)
from d = decisions
join s = field_refs (s.source_path == d.path && s.field == "superseded_by")
join c = field_refs (c.source_path == s.target_path && c.field == "tickets")
join t = tickets (t.path == c.target_path)
filter t.status != "Closed"
group {d.path} (take 1)
sort {d.path}
select {d.id, d.title}
```

```prql
# S7: loop is experimental and compiles to UNION ALL, so a cycle would not stop
from field_refs
filter (source_path == "decisions/F4.md" && field == "superseded_by")
select {path = target_path}
loop (
  join f = field_refs (f.source_path == this.path)
  filter f.field == "superseded_by"
  select {path = f.target_path}
)
join d = decisions (==path)
sort {d.path}
select {d.id, d.status, in_force = d.status == "accepted"}
```

```prql
# S8
from t = tickets
filter t.status != "Closed"
join c = ticket_components (==path)
group {c.component, t.severity} (
  aggregate {tickets = count t.path}
)
sort {component, severity}
```

```prql
# S9: $status and $section compile to SQLite's $status and $section parameters
from d = decisions
filter d.status == ($status ?? "accepted")
join s = decision_sections (==path)
filter s.section == $section
sort {-d.date, d.path}
select {d.id, d.title, d.date}
```

#### For the comparison: SQL and PRQL, with KQL (4.11) beside them

| | SQL (SQLite, + PGQ) | PRQL | KQL |
|---|---|---|---|
| S1 lookup | partly: only addresses that map to columns; general addresses need vmd's resolver (H) | partly, as SQL | partly, as SQL |
| S2 filter | yes; enum order written out | yes, as SQL | yes |
| S3 projection | yes (join to `nodes`) | yes | yes |
| S4 section search | yes with FTS5 (whole tokens, prefix); `LIKE` otherwise | partly: substring only, excerpt via s-string | yes (`has`, `hasprefix`) |
| S5 refs both ways | yes, through `refs` (H columns) | yes | yes |
| S6 multi-hop | yes: joins, or PGQ `MATCH` | yes: joins | yes: joins or `graph-match` |
| S7 closure | yes: `WITH RECURSIVE` with `UNION`; PGQ `->+` with `ANY SHORTEST`, or a bounded `->{1,10}` (duckpgq) | yes, through experimental `loop` (`UNION ALL`, no cycle stop) | yes, with an explicit upper bound |
| S8 aggregate | yes (`json_each`) | yes, with an unnest view (H) | yes (`mv-expand`) |
| S9 parameters | yes: `:name`, `?`, `$name` | yes: `$name` | yes: `declare query_parameters` with defaults |

- **Readability (O).** SQL is the longest for S5 to S7 (join conditions repeated per hop) and the most familiar. PGQ's `MATCH`
  reads best for S6 and S7. PRQL reads top to bottom like a pipe and is about as long as SQL. KQL is compact, but the
  `['date']`-style quoting of vmd's lower-case names hurts.
- **Implementation (D for what exists, O for effort).** SQL: nothing to write for the language; the work is building and
  keeping the tables (§14.2 plus the H columns), generating per-collection views from schemas, and an FTS table. Node 24's
  `node:sqlite` has JSON and FTS5 and is a release candidate there; `better-sqlite3` is a native module; sql.js lacks FTS5; Python's
  `sqlite3` depends on the system's SQLite. Two engines answering the same SQL text identically is not a given across SQLite
  builds and DuckDB (O). A from-scratch interpreter for even a SQL subset is large (O; decision v0.1-6 allows SQL "if they have a
  libraries for common langugages, or if implementing interpreter from scratch was feasible", the owner's words). PGQ: DuckDB 1.4.4 only for duckpgq, not 1.5.x, not shown in Wasm; Oracle is a server.
  PRQL: a Rust compiler with JS and Python bindings, pre-1.0, plus an SQL engine underneath. KQL: no engine for TypeScript.
- **Agent reliability (O, with one data point).** Agents write SQLite and DuckDB SQL often; BIRD, a text-to-SQL benchmark over
  unfamiliar databases, lists human performance at 92.96 execution accuracy and its top entry at 82.95 (D,
  [bird-bench.github.io](https://bird-bench.github.io/)). The scenarios here are simpler, and the schema would be vmd's own, so
  that figure bounds nothing (O). The H columns and views are what an agent would get wrong: which table holds a field, how a
  section's key is spelled, that `target_path` and not the raw link text is the resolved target. PRQL and KQL have far less text
  for models to learn from (O).
- **Singular addresses (§7.4).** SQL has keys (`PRIMARY KEY`, `UNIQUE`) that prove a lookup returns at most one row, but the
  proof is about the table, not about a vmd address; a query cannot carry vmd's proof unless the address stays a vmd address
  resolved by vmd (H `vmd_resolve`). Worse, a SQLite scalar subquery that finds several rows silently uses the first (D,
  lang_expr), the "first occurrence wins" of §5.7. PRQL and KQL have no notion of a singular result; KQL's `join` defaults to
  `innerunique`, which deduplicates the left side (D).
- **CLI fit.** One shell argument in single quotes works for all three, but each is long for S5 to S7 and multi-line in
  practice (`vmd query --sql -f q.sql`, H). SQLite's `$name` parameters, PRQL's `$name` and SQL's `$sections` inside strings are
  expanded by a shell inside double quotes (§12.4); KQL's `$left`/`$right` too. `!=` is safe in single quotes.
- **Portable index fit.** DuckDB reads `records-*.jsonl` and `refs-*.jsonl` directly with a glob (M), natively and, per its
  docs, in the browser through DuckDB-Wasm, which makes SQL the one option here that runs over the portable index without
  converting it (O). SQLite would need the JSONL loaded into tables first (sql.js in the browser, without FTS5). PRQL inherits
  whichever engine it targets. KQL has no browser engine.

### 4.4 GraphQL

#### Description

GraphQL is a query language for an API whose schema declares object types, their fields and each field's arguments. A query
is a tree of field selections that mirrors the response's shape. **The language itself has no filter, sort, join or aggregate
operators**: anything of that kind is an *argument* that the schema defines on a field. So "GraphQL over vmd" means two
choices: a schema generated from the collections (the draft's §18.3), and the argument conventions of some existing system.

**Mapping (H).** Following §18.3: one object type per collection (`Decision`, `Ticket`, `Doc`), fields from the schema's
properties, `section(key:)` and `sections(where:)` fields typed from `x-vmd-list`, reference fields resolved through
`x-vmd-ref` (`supersedes: [Decision!]!`), and on every record and section a backlink field `referencedBy: [Reference!]!` whose
items carry `from`, `at` (exact path), `status` and the containing node, from the `refs` table of §14.2. Root fields:
`node(address:)`, `record(path:)`, `decision(key:)`, `decisions(where:, order_by:, limit:)`, `decisions_aggregate(where:)`,
and the same per collection, plus `sections(where:)` across collections. Argument conventions are **borrowed from Hasura**
(`where` with `_eq`, `_neq`, `_in`, `_gte`, `_ilike`, `_and`, `_or`, `_not`, `_contains`; `order_by` with `asc`/`desc`;
`limit`; `<field>_aggregate`), because Tina's filters cannot express OR, NOT or descending order (below).

**Names need mangling (H).** A GraphQL Name is `NameStart NameContinue*`, letters, digits and `_` only, and names starting with
`__` are reserved (D, [GraphQL spec, September 2025, §2.1.8 Names and "Reserved Names"](https://spec.graphql.org/September2025/)).
So `$title`, `$body`, `@key`, `@address`, the section key `owners-note` and the field `applied-in` are not valid names. Here
`$title`/`$body`/`$sections` become `_title`/`_body`/`_sections`, computed fields become `_key`, `_address`, `_path`,
`_collection`, and a key with `-` is passed as a string argument (`section(key: "owners-note")`) rather than used as a field
name. Enum values have the same Name rule, so `In progress` cannot be a GraphQL enum value; statuses stay strings. Note that
decisions have both a stored field `title` and a heading `$title`, which the mangling keeps apart.

#### Prior art and sources

- Specification: [GraphQL, September 2025 edition](https://spec.graphql.org/September2025/), the latest release; the
  [index of editions](https://spec.graphql.org/) lists a working draft dated 2026-09-28 (D).
- Variables: "Variables must be defined at the top of an operation and are in scope throughout the execution of that
  operation"; a variable is `$` and a Name (D, spec §2.11 Variables). List and input object values may contain variables (D,
  spec §2.10).
- No unbounded recursion: rule 5.5.2.2 "Fragment Spreads Must Not Form Cycles": "The graph of fragment spreads must not form
  any cycles including spreading itself. Otherwise an operation could infinitely spread or infinitely execute on cycles in the
  underlying data" (D, spec §5.5.2.2). A query's depth is therefore fixed by its text.
- List and Non-Null types: a list field `pets: [Pet]` "must return an ordered list", and "if a non-list is returned, the
  coercion should fail" (D, spec §3.11 List); `name: String!` means "null is not a valid response" (D, spec §3.12 Non-Null).
- TinaCMS (named in the draft's Appendix C): `<collection>Connection(filter: ...)` with operators `eq`, `in`, `gt`, `gte`,
  `lt`, `lte`, `startsWith`, `after`, `before`; "Multiple conditions are currently treated as a boolean `AND` operation"; a
  filter on a reference's field, `postConnection(filter: {author: {author: {name: {eq: "Napolean"}}}})`
  (D, [tina.io filter-documents](https://tina.io/docs/graphql/queries/advanced/filter-documents), code taken from the page's
  HTML). Sorting is `sort: "date"`, ascending only, a multi-field sort needs an index declared in the schema, and descending
  order is obtained by reverse pagination (`last`, `before`) (D, [tina.io sorting](https://tina.io/docs/graphql/queries/advanced/sorting),
  [tina.io pagination](https://tina.io/docs/graphql/queries/advanced/pagination)). No OR, NOT, text search or aggregates are
  documented on those pages.
- Hasura: `where` boolean expressions, e.g. `authors(where: { articles: { rating: { _gt: 4 } } })`, where a condition on an
  array relationship selects parents with a matching child (D, [Hasura filters](https://hasura.io/docs/2.0/queries/postgres/filters/index/));
  `_eq`, `_neq`, `_in`, `_nin`, `_gt`, `_gte`, `_lt`, `_lte` (D, [comparison operators](https://hasura.io/docs/2.0/queries/postgres/filters/comparison-operators/),
  source [comparison-operators.mdx](https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/filters/comparison-operators.mdx));
  `_like`, `_ilike`, `_regex`, `_iregex` (D, [text-search-operators.mdx](https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/filters/text-search-operators.mdx));
  `_contains`, `_has_key` on jsonb (D, [jsonb-operators.mdx](https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/filters/jsonb-operators.mdx));
  `order_by: {name: desc}`, an array for several columns (D, [sorting.mdx](https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/sorting.mdx));
  `limit` (D, [pagination.mdx](https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/pagination.mdx));
  "The name of the aggregate field is of the form `<field-name> + _aggregate`", with `aggregate { count sum {…} avg {…} max {…} }`
  and `nodes` (D, [aggregation-queries.mdx](https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/aggregation-queries.mdx)).
  That page documents no group-by, and points to SQL views or functions "for more advanced use cases" (D, same page).
- Libraries: **graphql-js**, npm `graphql` 17.0.2, MIT, released 2026-07-03 (D, [registry.npmjs.org/graphql](https://registry.npmjs.org/graphql));
  **graphql-core** (Python port), 3.3.0, MIT, uploaded 2026-09-27 (D, [pypi.org/pypi/graphql-core](https://pypi.org/pypi/graphql-core/json)).
  Both are parsers, validators and executors: the filter arguments, their evaluation, and the resolvers are vmd's to write.

#### The scenarios

S1. A root field taking an address, or a record by key and a section by key (H fields).

```graphql
query {
  node(address: "decisions/F7.md#decision") {
    ... on Section { _body }
  }
}
```

S2. `severity >= High` has no operator over an ordered enum here, so it is spelled as a set (Hasura `_in`). `component` is an
array, matched with `_contains` borrowed from Hasura's jsonb operators (H).

```graphql
query {
  tickets(where: {
    status: {_neq: "Closed"},
    severity: {_in: ["Critical", "High"]},
    component: {_contains: ["log-v3"]}
  }) {
    _key
    _title
    status
    severity
  }
}
```

S3. An alias (`decision:`) names the projected section; ties broken by path through a second `order_by` entry.

```graphql
query {
  decisions(where: {round: {_eq: "U"}}, order_by: [{date: desc}, {_path: asc}]) {
    id
    status
    date
    decision: section(key: "decision") { _body }
  }
}
```

S4. A cross-collection `sections` root field and an `excerpt` field with arguments (both H). `_ilike` is substring matching,
not VQL's whole-token match or simple case folding.

```graphql
query {
  sections(where: {
    _collection: {_eq: "decisions"},
    _key: {_eq: "owners-note"},
    _body: {_ilike: "%selector%"}
  }) {
    _address
    excerpt(around: "selector", chars: 100)
  }
}
```

S5 (a) forward, through the resolved reference field; (b) backlinks, through `referencedBy` (H), which covers typed and
Markdown references alike because it reads the `refs` table.

```graphql
query {
  decision(key: "G9") {
    supersedes { _key title }
  }
}
```

```graphql
query {
  record(path: "decisions/F7.md") {
    referencedBy {
      from { _path }
      inNode { _address }
      at
      status
    }
  }
}
```

S6. Nested `where` on relationships, as Hasura filters parents by children; the decision is kept when some superseding
decision has some open ticket. `tickets` on decisions is S6's hypothesis (section 2).

```graphql
query {
  decisions(where: {superseded_by: {tickets: {status: {_neq: "Closed"}}}}) {
    _key
    title
    superseded_by {
      _key
      tickets(where: {status: {_neq: "Closed"}}) { _key status }
    }
  }
}
```

S7. Not expressible to any depth: fragments cannot recurse (spec §5.5.2.2). The query nests to a depth fixed in advance, and
the client repeats with a deeper query if the last level is not empty. The alternative is a resolver that computes the
closure, `superseded_by_transitive`, which moves the graph logic out of the language (H).

```graphql
query {
  decision(key: "F4") {
    superseded_by {
      _key status
      superseded_by {
        _key status
        superseded_by {
          _key status
          superseded_by { _key status }
        }
      }
    }
  }
}
```

S8. Partly. Hasura-style `_aggregate` counts one filter at a time and has no group-by, so each (component, severity) pair is
an aliased field written out in advance; a general answer needs an H `group_by` argument or a view on the server.

```graphql
query {
  log_v3_critical: tickets_aggregate(where: {status: {_neq: "Closed"}, component: {_contains: ["log-v3"]}, severity: {_eq: "Critical"}}) {
    aggregate { count }
  }
  log_v3_high: tickets_aggregate(where: {status: {_neq: "Closed"}, component: {_contains: ["log-v3"]}, severity: {_eq: "High"}}) {
    aggregate { count }
  }
}
```

S9. Variables are part of the language, with a default value; the agent keeps the document and passes
`{"sections": ["§7.4"]}`. Hasura's `_contains` takes a `jsonb` value, so the variable is typed `jsonb` and holds the list (H, as
the `sections` field's type is).

```graphql
query DecisionsTouching($sections: jsonb!, $status: String = "accepted") {
  decisions(
    where: {sections: {_contains: $sections}, status: {_eq: $status}},
    order_by: [{date: desc}, {_path: asc}]
  ) {
    id
    title
  }
}
```

#### For the comparison

- Expressiveness: S1 yes (H root field); S2 yes, enum order lost (a set instead of `>=`); S3 yes; S4 partly (substring, not
  tokens; excerpt is H); S5 yes, given a generated `referencedBy`; S6 yes (relationship filters); S7 no beyond a fixed depth;
  S8 partly (no group-by in the borrowed convention); S9 yes, best of the three (typed variables in the language).
- Readability (O): high for tree-shaped reads (S1, S3, S5, S6), since the query is the shape of the answer; poor for S8.
- Implementation (D/O): graphql-js and graphql-core give parsing, validation and execution in both languages (D). vmd would
  write the schema generator from JSON Schemas, the filter input types and their evaluator, the name mangling, and resolvers
  over the snapshot (O: the filter evaluator is the same work as a VQL evaluator, plus the schema generator). Two
  implementations must generate identical schemas for portability, which needs its own conformance cases (O).
- Agent reliability (O): agents know the GraphQL syntax well, but the argument vocabulary is per-server (Tina's `eq` vs
  Hasura's `_eq`), so an agent needs the generated schema (introspection) to write correct filters; no evidence found.
- Singular addresses: GraphQL's type system declares cardinality per field: `section(key:): Section` versus
  `sections: [Section!]!`, and a non-list field that returns a list fails coercion (D, §3.11). That is close to vmd's §7.4: a
  generator could type a field as singular exactly when §7.4's proof holds from the schema (a `type: map` level), and as a list
  for a `multimap` level (H). It checks at execution, not before, unless the generator encodes the proof in the types.
- CLI fit (O): poor as a shell argument: multi-line, braces, and `$variables` that a shell expands inside double quotes, so a
  query lives in a file or in single quotes, with variables as JSON. Fits an MCP tool or HTTP endpoint better than a CLI.
- Portable index fit (O): graphql-js runs in the browser, so a site could resolve queries over `records-*.jsonl` and
  `values/*.json` after loading them; resolvers that follow references need the values of the targets, so the browser loads
  more than the records listing.

### 4.5 jq

#### The input these languages need (H)

None of these languages knows vmd. They all need vmd to export the store as JSON first. The shape used
below is H throughout:

- **records**: one JSON object per record, one per line (as `records-*.jsonl` of the portable index is,
  §14.4, but with the value view inlined; today the value views are separate files, `values/<path>.json`):
  `{"path": "decisions/F7.md", "collection": "decisions", "value": {...the value view...}}`.
  Each item of `$sections` in the exported value also carries the computed fields `"@key"` and
  `"@address"`. That is H twice over: computed fields are not in the value view (§5.10), and none of
  these languages can compute them, since a section key is a slug of Markdown source (§5.5, §6.3).
- **refs**: one JSON object per row of the `refs` table (§14.2), with H column names:
  `{"path": "decisions/C20.md", "at": "/superseded_by/0", "address": "#superseded_by/0", "target":
  "decisions/F7.md", "status": "ok"}`. `target` is the resolved store address. None of these languages can
  extract Markdown links from a `$body` or resolve a relative URI reference against the citing record, so
  every reference question (S5 to S7) reads this table, which vmd computes.

For S6 the ticket references are typed references named `tickets` (H, section 2).

#### The language

**What it is.** jq is a command-line JSON processor and a functional language of filters: every
expression takes one JSON value and produces a stream of zero or more values, combined with `|`. Its data
model is JSON itself, so a vmd value view maps onto it unchanged (but see the H shape above for keys and
references). Joins are done by building an object index in memory (`INDEX`), recursion by `recurse` or
recursive `def`, and grouping by `group_by` over an array, so every question that crosses records reads the
whole store into memory (`-n` with `inputs`, or `-s`).

**Prior art and implementations.**

- The language: the jq 1.8 manual ([jqlang.org/manual](https://jqlang.org/manual/), read on 2026-10-20),
  which documents `select`, `map`, `sort_by`, `group_by`, `any(generator; condition)`, `recurse(f)`,
  `limit`, `first`, `test` and `match` with flags (`i` is case-insensitive; the engine is Oniguruma), `IN`,
  `INDEX(stream; index_expression)`, `JOIN`, `reduce`, `def`, `--arg`, `--argjson`, `--args` with
  `$ARGS.positional` and `$ARGS.named`, `--slurpfile`, `-f`, `-n`, `-s`, `input` and `inputs`. The manual
  groups `INDEX`, `JOIN` and `IN` as "SQL-style operators". It says nothing about whether `sort_by` is
  stable or whether `recurse` stops at cycles (it does not say; a cycle loops, O from the definition
  `recurse(f) = recurse(f; true)`). There is no variable called `$__prog_args`; parameters come from
  `--arg`, `--argjson`, `--args` or `$ENV` (D, manual).
- jq itself: C, MIT licence ([github.com/jqlang/jq](https://github.com/jqlang/jq), read on 2026-10-20).
  The releases page lists 1.8.2 as the latest, after 1.8.1 and 1.8.0
  ([github.com/jqlang/jq/releases](https://github.com/jqlang/jq/releases), read on 2026-10-20; the year of
  1.8.0 and 1.8.1 is not shown on that page, U).
- jaq: a Rust clone "focused on correctness, speed, and simplicity", MIT, with a library crate (jaq-core)
  and a browser playground; it says it stays compatible with jq "in most cases"
  ([github.com/01mf02/jaq](https://github.com/01mf02/jaq), read on 2026-10-20). No JavaScript or Python
  binding is mentioned there.
- gojq: a pure Go implementation, MIT; it lists differences from jq, among them unordered object keys and
  no `$__loc__` ([github.com/itchyny/gojq](https://github.com/itchyny/gojq), read on 2026-10-20). Go, so not
  directly usable from TypeScript or Python.
- TypeScript, Node and the browser: WebAssembly builds of jq. `jq-wasm` 3.0.0-jq-1.8.2, MIT, published
  2026-07-05, and `jq-web` 0.6.2, ISC, published 2025-03-19 (the npm registry's metadata,
  [registry.npmjs.org/jq-wasm](https://registry.npmjs.org/jq-wasm) and
  [registry.npmjs.org/jq-web](https://registry.npmjs.org/jq-web), read on 2026-10-20). jq-web's README
  describes a promise-based API because the `.wasm` file loads asynchronously
  ([github.com/fgasper/jq-web](https://github.com/FGasper/jq-web), via search on 2026-10-20, U for details).
  No pure TypeScript jq implementation was found (U: not searched exhaustively).
- Python: the `jq` binding, 1.13.0, released 2026-10-18, BSD-2-Clause, bundling jq 1.8.2; API
  `jq.compile(".+5").input_value(42).first()`, with `args` for predefined variables
  ([pypi.org/project/jq](https://pypi.org/project/jq/), read on 2026-10-20). It is a C extension (wheels for
  Linux, macOS and Windows; otherwise a build from source).

**The scenarios.** Every query below was run with jq 1.7.1 (the version at hand) on a
synthetic store in the H shape: 12 records and 8 reference rows (M). Each uses only constructs of the 1.8
manual. `records.jsonl` and `refs.jsonl` are the two exports above. Shell quoting: every program is in
single quotes, so `$` and `!` are safe.

S1. Lookup by address. jq has no addresses; the record is found by its path and the section by the
exported `@key` (H). Nothing proves the result singular.

```jq
# jq -r -f s1.jq records.jsonl
select(.path == "decisions/F7.md")
| .value["$sections"][] | select(.["@key"] == "decision") | .["$body"]
```

S2. Filter. jq knows no schema, so `severity >= High` is written as the list of values at or above High,
and comparisons are case-sensitive (VQL's are case-insensitive, §10.3).

```jq
# jq -c -f s2.jq records.jsonl
select(.collection == "tickets")
| select(.value.status != "Closed")
| select(.value.severity | IN("Critical", "High"))
| select(any(.value.component[]; . == "log-v3"))
| {path, title: .value["$title"], status: .value.status, severity: .value.severity}
```

S3. Projection, newest first, ties by path. Sorting needs the whole collection in one array. Since the
manual does not say that `sort_by` is stable, the order is built from groups: dates descending, then paths
ascending within a date.

```jq
# jq -n -c -f s3.jq records.jsonl
[inputs | select(.collection == "decisions" and .value.round == "U")]
| group_by(.value.date) | reverse | .[] | sort_by(.path)[]
| {id: .value.id, status: .value.status, date: .value.date,
   decision: (.value["$sections"][] | select(.["@key"] == "decision") | .["$body"])}
```

S4. Search inside sections. `recurse` walks the section tree at any depth. `test(...; "i")` is Oniguruma's
case-insensitive match, not VQL's simple case folding or its whole-word tokens (§10.3). The excerpt is cut
by code points around the first match.

```jq
# jq -c -f s4.jq records.jsonl
select(.collection == "decisions") | .path as $p
| .value | recurse(.["$sections"][]?)
| select(.["@key"] == "owners-note" and (.["$body"] | test("selector"; "i")))
| (.["$body"] | match("selector"; "i").offset) as $o
| {address: ($p + .["@address"]), excerpt: .["$body"][([$o - 40, 0] | max):$o + 60]}
```

S5a. Forward references: a join through the `refs` table (vmd resolved the relative paths) into an index of
records built with `INDEX`.

```jq
# jq -n -r --slurpfile refs refs.jsonl -f s5a.jq records.jsonl
INDEX(inputs; .path) as $rec
| $refs[] | select(.path == "decisions/G9.md" and (.at | startswith("/supersedes/")))
| $rec[.target].value.title
```

S5b. Backlinks: a filter over the `refs` rows. jq only reads what vmd computed: the Markdown link in C20's
Decision section is there because vmd extracted it.

```jq
# jq -c -f s5b.jq refs.jsonl
select(.target == "decisions/F7.md") | {from: .path, in: .address, status}
```

S6. Two hops. A helper `targets` scans the reference rows; nested `any` expresses "superseded by a decision
that cites an open ticket". Each call scans every row, so the cost grows with records times references
(O: an index of the rows by source path, built once with `group_by` or `INDEX`, removes that).

```jq
# jq -n -c --slurpfile refs refs.jsonl -f s6.jq records.jsonl
def targets($from; $field):
  $refs[] | select(.path == $from and (.at | startswith("/" + $field + "/"))) | .target;
INDEX(inputs; .path) as $rec
| $rec[] | select(.collection == "decisions") | .path as $d
| select(any(targets($d; "superseded_by");
            any(targets(.; "tickets"); $rec[.].value.status != "Closed")))
| {path: $d, title: $rec[$d].value.title}
```

S7. Transitive closure with `recurse`. It does not detect cycles: a cycle of `superseded_by` (a data error
`vmd check` would not necessarily report) makes it loop for ever. A recursive `def` that carries the
visited set avoids that, at the cost of a longer program.

```jq
# jq -n -c --slurpfile refs refs.jsonl -f s7.jq records.jsonl
def next:
  . as $p | $refs[] | select(.path == $p and (.at | startswith("/superseded_by/"))) | .target;
INDEX(inputs; .path) as $rec
| ["decisions/F4.md" | recurse(next)] | unique | .[] | select(. != "decisions/F4.md")
| {path: ., status: $rec[.].value.status, in_force: ($rec[.].value.status == "accepted")}
```

S8. Aggregate: unnest the components, then `group_by` on a composite key.

```jq
# jq -n -c -f s8.jq records.jsonl
[inputs | select(.collection == "tickets" and .value.status != "Closed")
  | .value.severity as $s | .value.component[] | {component: ., severity: $s}]
| group_by([.component, .severity])
| map({component: .[0].component, severity: .[0].severity, count: length})
| .[]
```

S9. A saved program with named parameters, run as
`jq -n -c -f touching.jq --arg section '§7.4' --arg status accepted records.jsonl`. `--arg` always binds
a string; `--argjson` binds any JSON value (D, manual). Dates descend and ties keep path order, as in S3; over the decisions
it gives the ten that SQL's S9 gives, in the same order (M, 2026-10-21).

```jq
# touching.jq
[inputs | select(.collection == "decisions"
                 and .value.status == $status
                 and any(.value.sections[]?; . == $section))]
| group_by(.value.date) | reverse | .[] | sort_by(.path)[]
| {id: .value.id, title: .value.title, date: .value.date}
```

**Notes for the comparison table (jq).**

- Expressiveness: S1-S9 all yes, but S1, S4 and S5-S7 only through H exports of computed fields and of the
  `refs` table, and S2's ordered enum only by spelling out the values. jq expresses joins and closure, but as
  programs, not as declarations.
- Readability (O): fine for a filter and a projection; S6 and S7 read as code. Agents and people already
  know jq's simple forms.
- Implementation (D for what exists, O for effort): no implementation work for the language; the work is the
  export (value views with computed fields, the refs table) plus a dependency: a C extension in Python,
  a WebAssembly module in TypeScript (jq-wasm, MIT). vmd's own semantics (case folding, logical types, enum
  order, `nodes` targets and upward field resolution of §10.4) are not jq's and cannot be added to it.
- Agent reliability (O): high for simple filters, since jq is common in training data and shells; lower for
  `INDEX`, `recurse` and `def` programs. No measured evidence was found (U).
- §7.4: no analogue. jq has no notion of a result that must be one value; `first` and `limit` take the first
  outputs, which is the "first occurrence wins" that §5.7 rejects. A jq result is never a proved address.
- CLI fit: one single-quoted argument, but long; `$` is jq's variable sigil, so the program must be single
  quoted, and the value view's `$` members must be written `.["$body"]`. Portable index: the browser could
  run jq-wasm over downloaded JSONL, but only with the value views and computed fields inlined (H).

### 4.6 Cypher and GQL

#### Description

Cypher is the pattern-matching query language of Neo4j: ASCII-art patterns `(a)-[:REL]->(b)` over a *property graph*, in
which nodes have labels and properties and relationships have one type and properties. GQL (ISO/IEC 39075:2024) is the ISO
standard that grew out of Cypher and its peers. Neo4j says that Cypher "supports the majority of mandatory GQL features" and
that "users should, therefore, only expect minimal differences between crafting queries in Cypher and GQL" (D,
[Cypher manual, GQL conformance](https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/)).

**Mapping (H).** No vmd property graph exists. The examples assume this one:

- one node per record, labelled `:Record` plus one label per collection (`:Decision`, `:Ticket`, `:Doc`), with properties
  `path`, `collection`, `key`, `title` and the record's fields (`status`, `round`, `date`, `sections`, `component`...). Arrays
  of scalars become list properties. A nested object such as `sources` has no direct form, since a property cannot hold a
  map (U: stated from general Neo4j knowledge, not checked today); it is flattened (`sources_issues`) or left out;
- one `:Section` node per section, with `key`, `title`, `body`, `address` (canonical address) and `depth`;
  `(record)-[:SECTION]->(section)` and `(section)-[:SECTION]->(child)`;
- a typed reference is a relationship typed by its field name, `(c20)-[:superseded_by {at: '/superseded_by/0', status:
  'ok'}]->(f7)`; a Markdown link is `(node)-[:LINKS_TO {at, status}]->(target)` from the record or section whose `$body`
  holds it, to the record or section it resolves to. A dangling reference has no target node, so it is lost from the graph
  unless a placeholder node stands in (H).
- Enum order (`x-vmd-ordered`) has no Cypher form: `severity >= High` is written as a list, or a `severity_rank` property is
  added (H).

#### Prior art and implementations

- Specification: the [Neo4j Cypher manual](https://neo4j.com/docs/cypher-manual/current/) (D); openCypher, the open
  grammar and TCK (not re-read today, U). GQL: ISO/IEC 39075:2024 is a paywalled ISO standard; the ISO page returned 403
  today, so its text was not read (U). Neo4j's conformance appendix lists its features "in order of their appearance in the
  ISO/IEC 39075:2024(en) GQL Standard" (D,
  [supported mandatory features](https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/supported-mandatory/)).
  GQL's own statements (`FOR`, `FILTER`, `LET`, `NEXT`, `RETURN ... GROUP BY`) were read only in Google's implementation
  ([Spanner Graph, GQL query statements](https://docs.cloud.google.com/spanner/docs/reference/standard-sql/graph-query-statements)),
  a secondary source for the standard.
- **Embedded engines (no server)**, as read today:
  - **Kùzu**, the embedded Cypher database often cited for this: its repository is archived (read-only) since 2025-10-10,
    last release v0.11.3, MIT (D, GitHub API for `kuzudb/kuzu`; npm `kuzu` and `kuzu-wasm` 0.11.3 of 2025-10-10; PyPI `kuzu`
    0.11.3).
  - **LadybugDB**, whose README says that "The database was formerly known as Kuzu" (read on 2026-10-21): "an embedded graph database", "Flexible Property Graph Data Model and Cypher query
    language", "Wasm (WebAssembly) bindings for fast, secure execution in the browser" (D,
    [README](https://github.com/LadybugDB/ladybug)). MIT; v0.21.2 released 2026-10-01; npm `@ladybugdb/core` 0.21.2
    (2026-10-01), PyPI `ladybug` 0.21.2 (2026-10-01) (D, registries), the two packages binding one engine, as DuckDB's do. Kùzu used a typed schema of node and relationship
    tables; whether Ladybug's Cypher dialect differs from Neo4j's in the constructs used below was not checked (U).
  - **FalkorDBLite**: "FalkorDB embedded in a Python package", which "provides a built-in Redis server with FalkorDB module"
    (D, [PyPI](https://pypi.org/project/falkordblite/), 0.11.0 of 2026-10-19). It runs a server process, and FalkorDB itself
    is under the Server Side Public License v1 (D,
    [LICENSE.txt](https://github.com/FalkorDB/FalkorDB/blob/master/LICENSE.txt)). An npm package `falkordblite` 0.3.0, MIT,
    "Embedded FalkorDB for Node.js/TypeScript", was published on 2026-05-02 (D, [registry.npmjs.org/falkordblite](https://registry.npmjs.org/falkordblite),
    read on 2026-10-21); whether it also runs a server process was not checked (U).
  - No pure TypeScript or pure Python Cypher interpreter of note was found (O: not searched exhaustively).
- SQL/PGQ (a pointer only; section 4.2 covers it): ISO SQL:2023 Part 16 puts Cypher-like `MATCH` patterns inside SQL's
  `GRAPH_TABLE`. DuckPGQ is "a DuckDB community extension for graph workloads that supports the SQL/PGQ standard", and
  "currently a research project and still a work in progress" (D, [duckpgq.org](https://duckpgq.org/)).

#### Constructs checked

- Quantified relationships: `-[:NEXT]->{1,10}`, `+` = `{1,}`, `*` = `{0,}`; the older `-[*]->` (1 or more) and `-[*m..n]->`
  are "still available but ... not GQL conformant" and allow no `WHERE` (D,
  [variable-length patterns](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-patterns/),
  [reference: variable-length paths](https://neo4j.com/docs/cypher-manual/current/patterns/reference/variable-length-paths/)).
- `OPTIONAL MATCH` keeps the row with nulls (D, [OPTIONAL MATCH](https://neo4j.com/docs/cypher-manual/current/clauses/optional-match/)).
- `CONTAINS`, `STARTS WITH` are case-sensitive; `=~` takes a regular expression, `(?i)` for case (D,
  [string operators](https://neo4j.com/docs/cypher-manual/current/expressions/predicates/string-operators/)).
- `IN` on lists (D, [list operators](https://neo4j.com/docs/cypher-manual/current/expressions/predicates/list-operators/));
  `UNWIND expr AS x` (D, [UNWIND](https://neo4j.com/docs/cypher-manual/current/clauses/unwind/)); `coalesce()`,
  `toLower()`, `substring()`, `type()`, `count()`, `collect()` (D,
  [functions](https://neo4j.com/docs/cypher-manual/current/functions/)).
- Parameters `$name`; labels, relationship types and property keys cannot be parameters (D,
  [parameters](https://neo4j.com/docs/cypher-manual/current/syntax/parameters/)).
- GQL: `FOR x IN list` is GQL's form of Cypher's `UNWIND` (D, Neo4j
  [analogous Cypher](https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/analogous-cypher/)), and Cypher 25
  has it natively since Neo4j 2026.04, as "a GQL-conformant alias for `UNWIND`" (D, [FOR](https://neo4j.com/docs/cypher-manual/current/clauses/for/),
  read on 2026-10-21); `FILTER
  [WHERE] cond`, `NEXT` to chain statements, and aggregation with `RETURN ... GROUP BY` (D for Spanner only, as above).

#### The scenarios

**S1. Lookup by address.** Cypher has no addresses; the lookup is a pattern by record and section key. Matching on the
`address` property works only for the canonical address (H).

```cypher
MATCH (:Decision {key: 'F7'})-[:SECTION]->(s:Section {key: 'decision'})
RETURN s.body
```

**S2. Filter.** The enum order is spelled out as a list.

```cypher
MATCH (t:Ticket)
WHERE t.status <> 'Closed'
  AND t.severity IN ['Critical', 'High']
  AND 'log-v3' IN t.component
RETURN t.key, t.title, t.status, t.severity
ORDER BY t.path
```

GQL: the same `MATCH ... WHERE ... RETURN`; a later condition can also be a `FILTER` statement.

**S3. Projection.**

```cypher
MATCH (d:Decision {round: 'U'})
OPTIONAL MATCH (d)-[:SECTION]->(s:Section {key: 'decision'})
RETURN d.id, d.status, d.date, s.body AS decision
ORDER BY d.date DESC, d.path
```

**S4. Search inside sections.** No full text: a case-folded substring test. The excerpt is cut around the hit with
`string.indexOf(input, value)`, which Neo4j 2026.05 added for Cypher 25 only (D, [string functions](https://neo4j.com/docs/cypher-manual/current/functions/string/),
read on 2026-10-21); before it, the excerpt could only be the start of the body.

```cypher
MATCH (d:Decision)-[:SECTION]->(s:Section {key: 'owners-note'})
WHERE toLower(s.body) CONTAINS 'selector'
WITH d, s, string.indexOf(toLower(s.body), 'selector') AS i
RETURN s.address, substring(s.body, CASE WHEN i < 40 THEN 0 ELSE i - 40 END, 120) AS excerpt
ORDER BY d.path
```

**S5. References both ways.** (a) Forward:

```cypher
MATCH (:Decision {key: 'G9'})-[:supersedes]->(old:Decision)
RETURN old.id, old.title
```

Backward is the same pattern with the arrow reversed: `(newer:Decision)-[:supersedes]->(:Decision {key: 'F9'})`.

(b) Backlinks into F7.md or any section of it, typed or Markdown, with the citing record. `-[:SECTION]->*` is zero or
more steps, so the record itself and every section below it.

```cypher
MATCH (f:Record {path: 'decisions/F7.md'})-[:SECTION]->*(target)
MATCH (src)-[r]->(target)
WHERE type(r) <> 'SECTION'
MATCH (rec:Record)-[:SECTION]->*(src)
RETURN rec.path AS citing_record, type(r) AS kind, r.at AS at, r.status AS status
ORDER BY citing_record, at
```

**S6. Multi-hop** (with the H `tickets` field).

```cypher
MATCH (d:Decision)-[:superseded_by]->(:Decision)-[:tickets]->(t:Ticket)
WHERE t.status <> 'Closed'
RETURN DISTINCT d.id, d.title
```

**S7. Transitive closure.** Newer form, then the older one (same meaning, not GQL-conformant).

```cypher
MATCH (:Decision {key: 'F4'})-[:superseded_by]->+(later:Decision)
RETURN DISTINCT later.id, later.status, later.status = 'accepted' AS in_force
ORDER BY later.id
```

```cypher
MATCH (:Decision {key: 'F4'})-[:superseded_by*]->(later:Decision)
RETURN DISTINCT later.id, later.status
```

**S8. Aggregate.** Grouping is implicit: the non-aggregated `RETURN` items are the keys.

```cypher
MATCH (t:Ticket)
WHERE t.status <> 'Closed'
UNWIND t.component AS component
RETURN component, t.severity AS severity, count(*) AS tickets
ORDER BY component, severity
```

GQL: `FOR component IN t.component` in place of `UNWIND`, which Cypher 25 also accepts (above), and, as Spanner writes it (a
secondary source), an explicit `GROUP BY component, severity` after the `RETURN` (U for the ISO text).

**S9. Parameterised.** `$section` and `$status` are passed beside the query.

```cypher
MATCH (d:Decision)
WHERE $section IN d.sections AND d.status = coalesce($status, 'accepted')
RETURN d.id, d.title, d.date
ORDER BY d.date DESC, d.path
```

#### For the comparison

- Expressiveness: S1 partly (no addresses; by key, or by the canonical address only); S2 yes (enum order by hand); S3 yes;
  S4 partly (substring, no tokens; the excerpt around the hit needs Cypher 25; full-text indexes are a Neo4j feature, not
  checked, U); S5 yes,
  both directions are one arrow; S6 yes; S7 yes; S8 yes; S9 yes.
- Readability (O): the best of the group for S5 to S7, where the arrow picture is the question; ordinary for S2 and S8.
- Implementation (O, with D facts): no TypeScript or Python Cypher interpreter to reuse; the embedded engines are native
  (C++) with Node, Python and Wasm bindings: LadybugDB, the renamed continuation of the archived Kùzu, and FalkorDBLite, which
  bundles a server and whose engine is under the SSPL. vmd would load
  its index into the engine (a copy), or write its own Cypher subset, which is large: patterns, quantifiers, implicit
  grouping, null semantics.
- Agent reliability (O): Cypher is widely documented and agents write it often; no measurement found.
- Singular address (§7.4): no analogue. A `MATCH` returns zero or more rows; Neo4j has uniqueness constraints on properties
  (U, not read today), which make a lookup by key unique in the data, not provable from the query.
- CLI: one argument in single quotes; `$param` must stay unexpanded (single quotes), and `'` inside strings clashes with
  shell quoting. Multi-line queries are long. Portable index: the graph has to be built from `nodes` and `refs` lines in the
  client (H); Ladybug's Wasm build could run in a browser (D that it exists, U that it fits the size of the site).

### 4.7 SPARQL 1.1

#### Description

SPARQL is the W3C query language for RDF, data as subject-predicate-object triples whose names are IRIs. Its patterns are
triple patterns, and *property paths* follow a predicate any number of times or backwards.

**Mapping (H).** A store base IRI, `BASE <https://store.example/>`, so a record is `<decisions/F7.md>` and a section is
named by its canonical address as an IRI fragment, `<decisions/F7.md#decision>`, which is how an address already looks.
Fields are predicates `f:<field>` (`PREFIX f: <https://store.example/.vmd/field/>`); structure is `vmd:`
(`PREFIX vmd: <https://vmd.example/ns#>`): `vmd:collection`, `vmd:path`, `vmd:key`, `vmd:title`, `vmd:body`, `vmd:section`
(record or section to child section). An array field is one triple per item, so order and repeats are lost. A typed
reference is a triple to its target, `<decisions/C20.md> f:superseded_by <decisions/F7.md>`. Each reference of the `refs`
table is also a resource: `[] a vmd:Ref ; vmd:from <citing node> ; vmd:to <target> ; vmd:at "/superseded_by/0" ;
vmd:field "superseded_by" ; vmd:status "ok"`.

#### Prior art and implementations

- Specification: [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/), W3C Recommendation of 21 March
  2013 (D). Comunica's README already speaks of SPARQL 1.2 Update (D,
  [README](https://github.com/comunica/comunica/blob/master/engines/query-sparql/README.md)); the status of SPARQL 1.2 was
  not checked (U).
- TypeScript: **Comunica** (`@comunica/query-sparql` 5.4.1, 2026-09-14, MIT, D npm) and **Oxigraph** (`oxigraph` 0.5.12,
  2026-10-18, MIT OR Apache-2.0, D npm; a Rust engine compiled to Wasm for Node and browsers).
- Python: **rdflib** 7.6.0 (2026-02-13, BSD-3-Clause, D PyPI) and **pyoxigraph** 0.5.12 (2026-10-18, D PyPI).
- Parameters: SPARQL has no parameter syntax; `VALUES` is inline data in the query (D, spec). Engines pre-bind variables:
  Comunica's `initialBindings`, "Variables that have to be pre-bound to values in the query" (D,
  [context options](https://comunica.dev/docs/query/advanced/context/)); rdflib's `initBindings` (D,
  [Querying with SPARQL](https://rdflib.readthedocs.io/en/stable/intro_to_sparql/)), which behaves differently between
  rdflib's stores (D, [rdflib issue #1772](https://github.com/RDFLib/rdflib/issues/1772)). Oxigraph's JS `query` options
  document no binding option (D, [js/README.md](https://github.com/oxigraph/oxigraph/blob/main/js/README.md)).

#### Constructs checked (all D, SPARQL 1.1 Query)

Property paths `^elt` (inverse), `elt+`, `elt*`, `elt1/elt2`; `VALUES ?z { "abc" "def" }`; `REGEX(?x, "web", "i")`;
`CONTAINS`, `LCASE`, `SUBSTR`, `STRSTARTS`; `COUNT(DISTINCT? *|expr)`, `GROUP_CONCAT(...; SEPARATOR=...)`; `GROUP BY`;
`ORDER BY DESC(...)`; `OPTIONAL`; `BIND`; `(expr AS ?v)` in `SELECT`. `IN` in a filter is from the spec's operator list
(U: not quoted today).

#### The scenarios

Every query starts with the same prologue, left out below:

```sparql
BASE <https://store.example/>
PREFIX vmd: <https://vmd.example/ns#>
PREFIX f: <https://store.example/.vmd/field/>
```

**S1.** The address is the IRI, so the section can be named directly (H); here by record and key.

```sparql
SELECT ?body WHERE {
  <decisions/F7.md> vmd:section ?s .
  ?s vmd:key "decision" ; vmd:body ?body .
}
```

**S2.**

```sparql
SELECT ?t ?title WHERE {
  ?t vmd:collection "tickets" ; vmd:title ?title ;
     f:status ?status ; f:severity ?sev ; f:component "log-v3" .
  FILTER (?status != "Closed" && ?sev IN ("Critical", "High"))
}
ORDER BY STR(?t)
```

**S3.**

```sparql
SELECT ?id ?status ?date ?decision WHERE {
  ?d vmd:collection "decisions" ; f:round "U" ; f:id ?id ; f:status ?status ; f:date ?date .
  OPTIONAL { ?d vmd:section ?s . ?s vmd:key "decision" ; vmd:body ?decision . }
}
ORDER BY DESC(?date) STR(?d)
```

**S4.** Substring search; the excerpt is the start of the body.

```sparql
SELECT ?s ?excerpt WHERE {
  ?d vmd:collection "decisions" ; vmd:section ?s .
  ?s vmd:key "owners-note" ; vmd:body ?body .
  FILTER (CONTAINS(LCASE(?body), "selector"))
  BIND (SUBSTR(?body, 1, 100) AS ?excerpt)
}
ORDER BY STR(?s)
```

**S5.** (a) Forward, and backward with `^`:

```sparql
SELECT ?old ?title WHERE {
  <decisions/G9.md> f:supersedes ?old .
  ?old vmd:title ?title .
}
```

```sparql
SELECT ?newer WHERE { <decisions/F9.md> ^f:supersedes ?newer . }
```

(b) Backlinks into F7.md or any section of it, through the reference resources; `vmd:section*` is zero or more steps.

```sparql
SELECT ?path ?at ?field ?status WHERE {
  <decisions/F7.md> vmd:section* ?target .
  ?ref a vmd:Ref ; vmd:to ?target ; vmd:from ?from ; vmd:at ?at ; vmd:status ?status .
  OPTIONAL { ?ref vmd:field ?field }
  ?rec vmd:section* ?from ; vmd:path ?path .
}
ORDER BY ?path ?at
```

**S6.** A sequence path.

```sparql
SELECT DISTINCT ?d WHERE {
  ?d f:superseded_by/f:tickets ?t .
  ?t f:status ?status .
  FILTER (?status != "Closed")
}
```

**S7.**

```sparql
SELECT DISTINCT ?later ?status (?status = "accepted" AS ?in_force) WHERE {
  <decisions/F4.md> f:superseded_by+ ?later .
  ?later f:status ?status .
}
ORDER BY STR(?later)
```

**S8.** A multi-valued `f:component` unnests by itself.

```sparql
SELECT ?component ?severity (COUNT(?t) AS ?tickets) WHERE {
  ?t vmd:collection "tickets" ; f:status ?status ; f:severity ?severity ; f:component ?component .
  FILTER (?status != "Closed")
}
GROUP BY ?component ?severity
ORDER BY ?component ?severity
```

**S9.** Parameters as `VALUES`, or the same query without the `VALUES` line and with `initialBindings` (Comunica) or
`initBindings` (rdflib).

```sparql
SELECT ?id ?title ?date WHERE {
  VALUES (?section ?status) { ("§7.4" "accepted") }
  ?d vmd:collection "decisions" ; f:sections ?section ; f:status ?status ;
     f:id ?id ; vmd:title ?title ; f:date ?date .
}
ORDER BY DESC(?date) STR(?d)
```

#### For the comparison

- Expressiveness: S1 yes (an address maps naturally to an IRI with a fragment, H); S2 yes (enum order by hand); S3 yes;
  S4 partly (substring or regex, no tokens, no excerpt around the hit); S5 yes, `^` for backlinks; S6 yes (`a/b`); S7 yes
  (`+`), though a path does not return the route or the hop count; S8 yes; S9 yes, by `VALUES` or engine pre-binding.
- Readability (O): good for S5 to S7; the IRI and prefix ceremony makes every query long, and RDF's sets of values lose
  the order of arrays, which §5 treats as data.
- Implementation (O): mature libraries on both sides (Comunica, Oxigraph, rdflib). vmd would emit triples from the index,
  a second data model beside the value view (H).
- Agent reliability (O): agents know SPARQL from Wikidata, but prefixes and IRIs are a common source of mistakes; no
  measurement found.
- Singular address (§7.4): no analogue; a pattern yields a multiset of solutions.
- CLI: one argument in single quotes; `?var` is safe inside single quotes, and `"` is the usual string quote, so the
  shell's single quotes hold. Portable index: Oxigraph's Wasm build can run in a browser over triples built from the
  JSONL lines (H).

### 4.8 Datalog, in Datomic's style

#### Description

Datalog queries are sets of clauses over facts. In Datomic's form a fact is `[entity attribute value]`, a query is
`[:find ... :in ... :where ...]` in EDN, variables join by name, and *rules* name reusable clauses, recursive ones
included. Direction does not exist: a reference can be matched from either end.

**Mapping (H).** One entity per record and per section. Attributes: `:vmd/path`, `:vmd/collection`, `:vmd/key`,
`:vmd/title`, `:vmd/body`, `:vmd/address`, `:vmd/section` (a reference, cardinality many, record or section to child
section). Fields are `:f/<field>`; an array is a cardinality-many attribute; a typed reference is a reference attribute
(`:f/superseded_by`). Each row of the `refs` table is an entity with `:ref/source-path`, `:ref/at`, `:ref/field` (absent
for a Markdown link), `:ref/target-path`, `:ref/target` (the resolved entity) and `:ref/status`.

#### Prior art and implementations

- Specification: Datomic's [query reference](https://docs.datomic.com/query/query-data-reference.html) (D): find specs,
  `:in` with `$`, scalars and collection bindings `[?x ...]`, rules passed as `%`, `not`, `not-join`, `or`, predicate and
  function expressions, `get-else`, `missing?`, aggregates (`count`, `count-distinct`, `distinct`, `min`, `max`, `sum`...).
  The reference has no `order by` (results are sets, sorted by the caller) and no recursive rule example; recursive rules
  are shown in Datomic's forum (secondary, [Recursive query?](https://forum.datomic.com/t/recursive-query/1370)). The
  find-scalar `:find ?a .` is "Peer" API only. Lookup refs, `[:person/email "joe@example.com"]`, name one entity by an
  attribute that "must be defined as either :db.unique/value or :db.unique/identity" (D,
  [identity](https://docs.datomic.com/schema/identity.html)).
- TypeScript: **DataScript**, an in-memory Datalog database with a Datomic-like query engine, which "can be used from any JS
  engine without additional dependencies"; from JavaScript "Query and rules should be EDN passed as strings". It lists
  "Rules, recursive rules", "Aggregates", "Pull API" and "Find specifications", and differs from Datomic in a simplified,
  unqueryable schema and "No full-text search" (D, [README](https://github.com/tonsky/datascript)). npm `datascript`
  1.8.1 of 2026-08-15; EPL-1.0 (D, npm and GitHub API). Its query functions include `re-find`, `re-pattern`,
  `clojure.string/includes?`, `contains?`, `get-else`, `missing?`, and aggregates `count`, `count-distinct`, `distinct`
  (D, [built_ins.cljc](https://github.com/tonsky/datascript/blob/master/src/datascript/built_ins.cljc)). It is written in
  ClojureScript, so the JS bundle carries that runtime (O).
- Python: **pyDatalog**, "a pure-python implementation of Datalog", LGPL, led by Pierre Carbonnelle (D,
  [docs](https://pydatalog.readthedocs.io/en/latest/)); PyPI shows releases 0.22.0 to 0.22.4 uploaded from 2026-06-11 to
  2026-06-13 (D, [PyPI](https://pypi.org/pypi/pyDatalog/json), read on 2026-10-21), so it is active. Its syntax is Python operators (`factorial[N] = N*factorial[N-1]`), not Datomic's EDN, so the two
  implementations would not share a query text. No Python port of DataScript was found (U, not searched exhaustively).
- Markdown prior art: **Logseq**'s advanced queries are Datalog over DataScript ("Logseq queries are based on datomic,
  which is based on datalog"; "The respective database is ... called Datascript"), with pages and blocks as entities, e.g.
  `[:find ?name :in $ ?tag :where [?t :block/name ?tag] [?p :block/tags ?t] [?p :block/name ?name]]` (secondary: the
  forum's [step-by-step explainer](https://discuss.logseq.com/t/how-advanced-queries-work-step-by-step-explainer/30544);
  Logseq's own documentation page could not be loaded today, U). Users there call its documentation thin.

#### The scenarios

Results are sets; ordering is done by the caller in every scenario.

**S1.** By path and key; `:vmd/address` would match the canonical address only (H). The scalar find is Peer-only in
Datomic.

```clojure
[:find ?body .
 :where [?d :vmd/path "decisions/F7.md"]
        [?d :vmd/section ?s]
        [?s :vmd/key "decision"]
        [?s :vmd/body ?body]]
```

**S2.**

```clojure
[:find ?key ?title
 :where [?t :vmd/collection "tickets"]
        [?t :vmd/key ?key]
        [?t :vmd/title ?title]
        [?t :f/component "log-v3"]
        [?t :f/severity ?sev]
        [(contains? #{"Critical" "High"} ?sev)]
        (not [?t :f/status "Closed"])]
```

**S3.**

```clojure
[:find ?id ?status ?date ?text
 :where [?d :vmd/collection "decisions"]
        [?d :f/round "U"]
        [?d :f/id ?id]
        [?d :f/status ?status]
        [?d :f/date ?date]
        [?d :vmd/section ?s]
        [?s :vmd/key "decision"]
        [?s :vmd/body ?text]]
```

**S4.** A regular expression with `(?i)`; that ClojureScript's `re-pattern` honours the flag prefix is U.

```clojure
[:find ?addr ?body
 :where [?d :vmd/collection "decisions"]
        [?d :vmd/section ?s]
        [?s :vmd/key "owners-note"]
        [?s :vmd/body ?body]
        [(re-pattern "(?i)selector") ?re]
        [(re-find ?re ?body)]
        [?s :vmd/address ?addr]]
```

**S5.** (a) Forward; the backward question only swaps the bound variable (`[?newer :f/supersedes ?g]`).

```clojure
[:find ?id ?title
 :where [?g :vmd/path "decisions/G9.md"]
        [?g :f/supersedes ?old]
        [?old :f/id ?id]
        [?old :vmd/title ?title]]
```

(b) Backlinks, over the reference entities.

```clojure
[:find ?source ?at ?field ?status
 :where [?r :ref/target-path "decisions/F7.md"]
        [?r :ref/source-path ?source]
        [?r :ref/at ?at]
        [?r :ref/status ?status]
        [(get-else $ ?r :ref/field "(link)") ?field]]
```

**S6.**

```clojure
[:find ?id
 :where [?d :f/superseded_by ?d2]
        [?d2 :f/tickets ?t]
        (not [?t :f/status "Closed"])
        [?d :f/id ?id]]
```

**S7.** A recursive rule, passed as `%`, and the start as a parameter.

```clojure
[:find ?id ?status
 :in $ % ?start
 :where [?s :vmd/path ?start]
        (replaced-by ?s ?later)
        [?later :f/id ?id]
        [?later :f/status ?status]]
```

```clojure
[[(replaced-by ?a ?b) [?a :f/superseded_by ?b]]
 [(replaced-by ?a ?b) [?a :f/superseded_by ?c] (replaced-by ?c ?b)]]
```

**S8.** Grouping is by the non-aggregated find variables.

```clojure
[:find ?component ?severity (count ?t)
 :where [?t :vmd/collection "tickets"]
        [?t :f/component ?component]
        [?t :f/severity ?severity]
        (not [?t :f/status "Closed"])]
```

**S9.** Parameters are part of the language, in `:in`.

```clojure
[:find ?id ?title ?date
 :in $ ?section ?status
 :where [?d :vmd/collection "decisions"]
        [?d :f/sections ?section]
        [?d :f/status ?status]
        [?d :f/id ?id]
        [?d :vmd/title ?title]
        [?d :f/date ?date]]
```

#### For the comparison

- Expressiveness: S1 partly (by key; addresses are not a concept); S2 yes (enum order by hand); S3 yes but unsorted; S4
  partly (regex in DataScript, no full text: "No full-text search"); S5 yes, no direction to choose; S6 yes; S7 yes, by a
  recursive rule; S8 yes; S9 yes, `:in` parameters are first-class. No ordering or paging in the language anywhere.
- Readability (O): uniform and small, but EDN and logic variables are unfamiliar to most readers of tickets and docs.
- Implementation (O, with D facts): DataScript covers the TypeScript side, under EPL-1.0 and with a ClojureScript runtime;
  Python has pyDatalog, which is active but has its own syntax, so the two implementations would not share a query text, and
  a Python engine for Datomic's syntax would have to be written. A Datalog core (joins, `not`,
  recursion to a fixed point) is small to write compared with SQL or Cypher (O).
- Agent reliability (O): less training material than SQL or Cypher; Logseq users report the syntax is "fussy"
  (secondary, forum). No measurement found.
- Singular address (§7.4): a partial analogue. A lookup ref on a `:db.unique/value` or `:db.unique/identity` attribute names
  at most one entity, by the attribute's declared uniqueness, as a `type: map` level lets vmd prove a step unique; but "Lookup
  refs cannot be used in the body of a query though they can be used as inputs in a parameterized query" (D,
  [identity](https://docs.datomic.com/schema/identity.html)). The find-scalar `.` only takes one value; it proves nothing.
- CLI: EDN in single quotes is shell-safe (`?x`, `#{}`, `[]`, `"`); `%` and `$` are inside single quotes. Rules make
  queries two arguments. Portable index: facts can be loaded from the JSONL lines into DataScript in a browser (H).

### 4.9 Obsidian Dataview (DQL)

#### Description

Dataview is an Obsidian plugin that indexes a vault's Markdown metadata and answers queries written in fenced ```` ```dataview ````
blocks inside notes. A query is a query type (`LIST`, `TABLE`, `TASK`, `CALENDAR`), then at most one `FROM` (sources: tags,
folders, specific files, links), then data commands (`WHERE`, `SORT`, `GROUP BY`, `FLATTEN`, `LIMIT`) executed top to bottom, each on the
previous command's result. Its unit is the page (a file), plus list items and tasks; it has no section, heading or body text
model.

**Mapping (H).** A vmd store is a vault; a collection is a folder (`FROM "decisions"`); front matter fields are page fields.
A typed reference written as a relative path string (`supersedes: [C20.md]`) is a string to Dataview, not a link: a link in
front matter must be written quoted as `"[[Link]]"` (D, [types of metadata](https://blacksmithgu.github.io/obsidian-dataview/annotation/types-of-metadata/)).
So the examples assume either string comparison or front matter rewritten as `"[[C20]]"` (H), and say which.

#### Prior art and sources

- Sources, "four source types": `#tag`, `"folder"`, a specific file by its full path, `"folder/File"`, and `[[note]]` for
  "all pages which link **to** `[[note]]`", with `outgoing([[note]])` for the links from it, combined with `and`, `or`, `!` and
  parentheses (D, [sources](https://blacksmithgu.github.io/obsidian-dataview/reference/sources/)).
- Query types `LIST`, `TABLE ... AS "Header"`, `TABLE WITHOUT ID`, `TASK`, `CALENDAR` (D, [query types](https://blacksmithgu.github.io/obsidian-dataview/queries/query-types/));
  `LIST WITHOUT ID length(rows) + " pages of type " + key` with `GROUP BY type` shows the group's `key` and `rows` (D,
  [query-types.md](https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/queries/query-types.md)).
- Data commands: `WHERE`, `SORT field [ASC/DESC], ...`, `GROUP BY (computed_field) AS name` with a `rows` array and
  "swizzling" (`rows.test`), `FLATTEN` "yielding one result row per entry in the array", `LIMIT`; "Commands are executed in
  order" (D, [data commands](https://blacksmithgu.github.io/obsidian-dataview/queries/data-commands/)). Only zero or one `FROM`,
  "right after your Query Type" (D, [structure](https://blacksmithgu.github.io/obsidian-dataview/queries/structure/)).
- Implicit fields: `file.name`, `file.folder`, `file.path`, `file.link`, `file.inlinks` ("all files that contain a link to
  this file"), `file.outlinks`, `file.tags`, `file.lists`, `file.tasks`, `file.frontmatter`, and others; none holds the body
  text, headings or sections (D, [metadata on pages](https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-pages/)).
  A list item or task has `text` and `section`, "Link to the section this task is contained in" (D,
  [metadata-tasks.md](https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/annotation/metadata-tasks.md)).
- "Dataview operates on metadata in your Markdown files. It cannot read everything in your vault, but only specific data"
  (D, [docs index](https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/index.md)). So no full-text search.
- Functions: `contains`, `icontains`, `econtains`, `length`, `regextest`, `regexmatch`, `filter`, `map`, `any`, `all`,
  `default`, `choice`, `date`, `lower`, `startswith`, `link`, `meta` (D, [functions](https://blacksmithgu.github.io/obsidian-dataview/reference/functions/));
  `[[Link]].value` fetches a field of the linked page, and links held in fields can be indexed through (D,
  [expressions.md](https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/reference/expressions.md));
  `this.file.name` appears in an example, referring to the page holding the query (D, same file, line 188); `+` concatenates
  strings (D, same file).
- Licence and status: MIT; the npm package `obsidian-dataview` 0.5.68 (2025-03-15) is "TypeScript typings for all of its APIs"
  for plugin developers (D, [github.com/blacksmithgu/obsidian-dataview](https://github.com/blacksmithgu/obsidian-dataview),
  [registry.npmjs.org/obsidian-dataview](https://registry.npmjs.org/obsidian-dataview)). No standalone engine or specification
  of DQL was found; the evaluator lives inside the plugin and Obsidian's metadata cache (O, from the README; U whether it can
  be run headless).
- Other Markdown-vault query systems: Logseq's advanced queries are Datalog over Datascript, per Logseq's own hub page as
  summarised by a search engine; the page itself failed to load (U, [Getting started with advanced queries](https://hub.logseq.com/features/av5LyiLi5xS7EFQXy4h4K8/getting-started-with-advanced-queries/8xwSRJNVKFJhGSvJUxs5B2)).
  That makes Logseq prior art for Datalog over Markdown notes rather than for DQL's style.

#### The scenarios

S1. Not expressible: DQL returns pages and fields, never a section's text. The nearest is a link to the heading, written as a
header link, which `meta()` reports as of type `"header"` (D, [functions](https://blacksmithgu.github.io/obsidian-dataview/reference/functions/)),
from the specific file `"decisions/F7"`.

```dataview
LIST WITHOUT ID [[decisions/F7#Decision]]
FROM "decisions/F7"
```

S2. Enum order is lost; `contains` on the `component` list.

```dataview
TABLE status, severity, component
FROM "tickets"
WHERE status != "Closed" AND (severity = "Critical" OR severity = "High") AND contains(component, "log-v3")
```

S3. Partly: the Decision section's text is not available; fields only.

```dataview
TABLE id, status, date
FROM "decisions"
WHERE round = "U"
SORT date DESC, file.path ASC
```

S4. Not expressible: no body text and no sections (D, docs index). List items carry `text` and `section`, but the Owner's
notes are block quotes, not lists.

S5 (a) forward, with front matter written as links (H: `supersedes: ["[[F9]]"]`), indexing through the link; (b) pages
linking to F7 by `FROM [[F7]]`, which gives citing pages, not the field, section or status of each reference. Whether a
Markdown link `[F7](F7.md)` in a body counts as a link here was not verified (U); Dataview's documentation says a quoted front matter link
is "only a link for dataview" (D, types of metadata), while Obsidian's own Properties now read a quoted `"[[Link]]"` in a text or
list property as an internal link (D, [Obsidian help, Properties](https://obsidian.md/help/properties): "Internal links in text properties must be
surrounded with quotes", read on 2026-10-21).

```dataview
LIST WITHOUT ID map(supersedes, (d) => d.title)
FROM "decisions/G9"
```

```dataview
LIST
FROM [[F7]]
```

S6. Partly, with front matter links (H); lambdas over links indexed through are documented pieces, but the combination was
not run (U).

```dataview
TABLE title
FROM "decisions"
WHERE any(map(superseded_by, (d) => any(map(d.tickets, (t) => t.status != "Closed"))))
```

S7. Not expressible: DQL has no recursion; DataviewJS (JavaScript inside the note) could do it, but that is a program, not a
query.

S8. `FLATTEN` gives one row per component, then a computed group key.

```dataview
TABLE WITHOUT ID key AS "Component / severity", length(rows) AS "Open tickets"
FROM "tickets"
WHERE status != "Closed"
FLATTEN component
GROUP BY component + " / " + severity
```

S9. Partly: no parameters; a query can read the fields of the page that holds it through `this`, so the "parameter" is a
front matter field of that page (H: a note with `target_section: "§7.4"`).

```dataview
TABLE id, title
FROM "decisions"
WHERE contains(sections, this.target_section) AND status = "accepted"
SORT date DESC
```

#### For the comparison

- Expressiveness: S1 no; S2 yes; S3 partly (no section text); S4 no; S5 partly (page-level backlinks, typed references only
  if written as `[[...]]`); S6 partly (U); S7 no; S8 yes; S9 partly (through `this`).
- Readability (O): the most readable here for page-level questions (S2, S3, S8); it reads like SQL with sources.
- Implementation (O): nothing to reuse outside Obsidian; DQL has no specification, so vmd would reimplement a dialect from
  its documentation.
- Agent reliability (O): the syntax is small and SQL-like; less training data than SQL; no evidence found.
- Singular addresses: none; every query returns pages or rows.
- CLI fit (O): moderate: one line is possible, but `"folder"` quotes, `[[...]]` and `!` negation need single quotes in a
  shell.
- Portable index fit (O): its model (pages, fields, in- and out-links) is close to `records-*.jsonl` plus the refs table, so a
  dialect could run in the browser over the published index, but only by reimplementing it.
- Why it matters as prior art (O): it is the closest existing product to vmd's use (queries over front matter and links in a
  Markdown store, run by people), and it stops exactly where vmd goes further: sections, prose, typed references, recursion.

### 4.10 MongoDB query documents

#### Description

MongoDB queries are JSON documents. `find(query, projection, options)` filters one collection with a query document
(`{status: {$ne: "Closed"}}`) and shapes results with a projection; the aggregation pipeline is an array of stages
(`$match`, `$project`, `$unwind`, `$group`, `$sort`, `$lookup` for joins, `$graphLookup` for recursive traversal). Field
paths use dots; operators are keys beginning with `$`.

**Mapping (H).** One MongoDB collection per vmd collection; a document is a record's value view with `_id` its store path.
vmd's `$` members must be renamed, because MongoDB says of dollar-prefixed and dotted field names: "You can't query these
fields directly. To read or modify them, you need helper methods like `$getField`, `$setField`, and `$literal`", and such
fields "cannot: Be indexed … Be validated using `$jsonSchema`" (D, [Field Names with Periods and Dollar Signs](https://www.mongodb.com/docs/manual/core/dot-dollar-considerations/)).
Querying them would need `{ $expr: { $gt: [ { $getField: {$literal: "$price" } }, 200 ] } }` for every access (D,
[$getField](https://www.mongodb.com/docs/manual/reference/operator/aggregation/getField/)). So here `$title`, `$body`,
`$sections` become `_title`, `_body`, `_sections` (H), and each section carries its computed key as `_key` (H). A field name
that contains a dot, which vmd allows, has the same problem and no renaming that is safe in general (O). References are
stored as resolved store paths (`superseded_by: ["decisions/C20.md"]`), not as the relative paths the records hold (H), and
backlinks come from a `refs` collection mirroring §14.2's table: `{source, at, target, status}` (H).

#### Prior art and sources

- `db.collection.find( <query>, <projection>, <options> )`; projection with dot notation and `_id: 0`; `.sort({name: 1})`,
  `.limit(5)` (D, [db.collection.find()](https://www.mongodb.com/docs/manual/reference/method/db.collection.find/)).
- `{ <field>: <value> }` on an array matches when "the array field contains at least *one* element with the specified value"
  (D, [Query an Array](https://www.mongodb.com/docs/manual/tutorial/query-arrays/)).
- `$elemMatch` projection returns "only the **first** element matching" (D, [$elemMatch (projection)](https://www.mongodb.com/docs/manual/reference/operator/projection/elemMatch/)).
- `$regex` with `$options: "i"`; string and `/pattern/` forms (D, [$regex](https://www.mongodb.com/docs/manual/reference/operator/query/regex/)).
- `$lookup` with `from`, `localField`, `foreignField`, optional `pipeline`, `as`; "If the `localField` is an array, you can match
  the array elements against a scalar `foreignField` without an `$unwind` stage" (D, [$lookup](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/)).
- `$graphLookup` with `from`, `startWith`, `connectFromField`, `connectToField`, `as`, `maxDepth`, `depthField`,
  `restrictSearchWithMatch`; an array `connectFromField` is followed element by element; results "are not guaranteed to be in
  any order"; over 100 MB it spills to disk or fails without `allowDiskUse` (D, [$graphLookup](https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphLookup/)).
- `$group` with `_id: <expression>` as the group key and accumulators; `$group` "does _not_ order its output documents" (D,
  [$group](https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/)). `$filter` with `input`, `as`, `cond`
  (D, [$filter](https://www.mongodb.com/docs/manual/reference/operator/aggregation/filter/)).
- Query documents in a shell argument: `mongodump ... -q='{"year": {"$regex": "20"}}'`, single-quoted, in Extended JSON v2 (D,
  [$regex](https://www.mongodb.com/docs/manual/reference/operator/query/regex/)).
- Libraries without a server: **mingo** (JS/TS), 7.2.5, MIT, released 2026-10-15 (D, [registry.npmjs.org/mingo](https://registry.npmjs.org/mingo)),
  "MongoDB query language for in-memory objects", with `find` and an `Aggregator` (D, [github.com/kofrasa/mingo](https://github.com/kofrasa/mingo));
  its source has `$lookup`, `$graphLookup`, `$unwind`, `$group`, `$elemMatch`, `$regex`, `$getField` and `$literal` (D,
  [mingo source tree](https://github.com/kofrasa/mingo/tree/main/src/operators)); `$text` is not among them (D, same tree).
  **mongomock** (Python), 4.3.0, ISC, uploaded 2024-11-16 (D, [pypi mongomock](https://pypi.org/pypi/mongomock/json)), a library
  "for mocking pymongo collection objects for testing purposes", which lists `$text` and other pipeline stages as missing (D,
  [Missing_Features.rst](https://github.com/mongomock/mongomock/blob/develop/Missing_Features.rst)); **mongita** (Python), 1.2.0,
  BSD, uploaded 2023-04-03 (D, [pypi mongita](https://pypi.org/pypi/mongita/json)); whether mongita supports `$lookup` or
  `$graphLookup` was not checked (U). No Python library matching mingo's coverage was found (O, from this search only).

#### The scenarios

S1. `$elemMatch` projection picks the section by its key.

```javascript
db.decisions.find(
  { _id: "decisions/F7.md" },
  { _id: 0, _sections: { $elemMatch: { _key: "decision" } } }
)
```

S2. `severity >= High` is spelled as a set: MongoDB compares strings, not enum order. A scalar against the `component` array
matches any element.

```javascript
db.tickets.find(
  { status: { $ne: "Closed" }, severity: { $in: ["Critical", "High"] }, component: "log-v3" },
  { _key: 1, _title: 1, status: 1, severity: 1 }
)
```

S3.

```javascript
db.decisions.find(
  { round: "U" },
  { id: 1, status: 1, date: 1, _sections: { $elemMatch: { _key: "decision" } } }
).sort({ date: -1, _id: 1 })
```

S4. Partly: `$regex` is a substring match, not VQL's tokens or simple case folding; `$text` needs a text index on the server
and is missing from mingo and mongomock. The address is built by string concatenation (H: the canonical address rule of §7.5
is not available). No excerpt.

```javascript
db.decisions.aggregate([
  { $unwind: "$_sections" },
  { $match: { "_sections._key": "owners-note", "_sections._body": { $regex: "selector", $options: "i" } } },
  { $project: { _id: 0, address: { $concat: ["$_id", "#owners-note"] }, body: "$_sections._body" } }
])
```

S5 (a) forward with `$lookup` on the array of paths; (b) backlinks from the H `refs` collection, prefix-matched so that
references into F7's sections count too.

```javascript
db.decisions.aggregate([
  { $match: { _id: "decisions/G9.md" } },
  { $lookup: { from: "decisions", localField: "supersedes", foreignField: "_id", as: "superseded" } },
  { $project: { _id: 0, titles: "$superseded.title" } }
])
```

```javascript
db.refs.find(
  { target: { $regex: "^decisions/F7\\.md(#|$)" } },
  { _id: 0, source: 1, at: 1, status: 1 }
)
```

S6. Two `$lookup`s, the second with a `pipeline` that keeps open tickets; one row per (decision, superseding decision).

```javascript
db.decisions.aggregate([
  { $lookup: { from: "decisions", localField: "superseded_by", foreignField: "_id", as: "by" } },
  { $unwind: "$by" },
  { $lookup: { from: "tickets", localField: "by.tickets", foreignField: "_id", as: "open",
               pipeline: [ { $match: { status: { $ne: "Closed" } } } ] } },
  { $match: { open: { $ne: [] } } },
  { $project: { _id: 1, title: 1, "by._id": 1, "open._id": 1 } }
])
```

S7. `$graphLookup` is the transitive closure, with the depth of each hit; its output is unordered.

```javascript
db.decisions.aggregate([
  { $match: { _id: "decisions/F4.md" } },
  { $graphLookup: { from: "decisions", startWith: "$superseded_by", connectFromField: "superseded_by",
                    connectToField: "_id", as: "replaced_by", depthField: "depth" } },
  { $project: { _id: 0, "replaced_by._id": 1, "replaced_by.status": 1, "replaced_by.depth": 1 } }
])
```

S8. `$unwind` counts a ticket once per component. The sort on severity is alphabetical, not the enum's order.

```javascript
db.tickets.aggregate([
  { $match: { status: { $ne: "Closed" } } },
  { $unwind: "$component" },
  { $group: { _id: { component: "$component", severity: "$severity" }, count: { $sum: 1 } } },
  { $sort: { "_id.component": 1, "_id.severity": 1 } }
])
```

S9. Partly: `find` and `aggregate` take a `let` document of variables, "Added in MongoDB 5.0", read as `$$name`, and "To use
a variable to filter results, you must access the variable within the `$expr` operator" (D, [find command](https://www.mongodb.com/docs/manual/reference/command/find/),
[db.collection.find()](https://www.mongodb.com/docs/manual/reference/method/db.collection.find/)). The variables are untyped,
have no defaults, and work only inside expressions, so the filter is written with the aggregation operators `$in`, which
"fails with an error" when its second argument is not an array, and `$ifNull`, which "treats undefined values and missing fields
as null" (D, [$in](https://www.mongodb.com/docs/manual/reference/operator/aggregation/in/),
[$ifNull](https://www.mongodb.com/docs/manual/reference/operator/aggregation/ifNull/), read on 2026-10-21).

```javascript
db.decisions.find(
  { $expr: { $and: [
      { $in: ["$$section", { $ifNull: ["$sections", []] }] },
      { $eq: ["$status", "$$status"] } ] } },
  { _id: 0, id: 1, title: 1 },
  { let: { section: "§7.4", status: "accepted" } }
).sort({ date: -1, _id: 1 })
```

#### For the comparison

- Expressiveness: S1 yes; S2 yes, enum order lost; S3 yes; S4 partly (regex, no tokens, no excerpt, address hand-built);
  S5 yes with an H `refs` collection; S6 yes (two `$lookup`s); S7 yes (`$graphLookup`, unordered); S8 yes; S9 partly (`let`
  variables: untyped, no defaults, only inside `$expr`).
- Readability (O): `find` reads well for S1-S3; pipelines (S4, S6) are verbose JSON that is hard to scan.
- Implementation (D/M/O): mingo has the operators used here in TypeScript (D), but has the names more than the semantics: its
  `$lookup` with `localField`, `foreignField` and a `pipeline`, as in S6, returned every open ticket for every decision, whatever
  the keys (M, mingo 7.2.5, in the review of this document, run again on 2026-10-21); Python has only testing mocks, mongomock
  without `$text` and with stages missing (D), so a Python implementation means writing an evaluator (O: large, since the
  operator set is large and its semantics, for example comparison across BSON types, are defined by MongoDB's server).
  vmd would also have to pick a subset, specify it, and test it in the conformance suite (O).
- Agent reliability (O): MongoDB syntax is widespread and agents write it fluently; the `$`-renaming of vmd's members is a
  trap, since an agent that writes `"$sections.$body"` gets field-path semantics, not the member.
- Singular addresses: none. `find` returns a cursor; `findOne` returns the first match without proving there is only one
  (O; `findOne` not looked up here, U). `$elemMatch` projection silently returns the first match only (D), which is the
  "first occurrence wins" that vmd's §5.7 forbids.
- CLI fit (O): poor: every operator begins with `$`, so a query must be single-quoted (the documented `mongodump -q='...'`
  form), and it is long.
- Portable index fit (O): good in the browser: `records-*.jsonl` and `values/*.json` are already documents, and mingo runs on
  arrays in memory (D for mingo's in-memory model).

### 4.11 Considered and dropped as approaches

These were looked at and are not written as approaches of their own, for these reasons (O, each resting on the facts in its
subsection):

| Language | Why it is dropped as an approach | What it offers as prior art |
|---|---|---|
| JSONPath (RFC 9535) | it selects within one JSON value: no projection of several fields, no joins, no sorting, no aggregates, so S5a and S6 to S8 cannot be written | singular queries, proved from the syntax alone, the nearest analogue of §7.4 |
| JMESPath | the same gaps, and case-sensitive matching only | the multiselect hash `{id: id, title: title}` for projection |
| XPath 3.1 and XQuery 3.1 | XQuery can express every scenario, but its axes do not apply to JSON maps, and the maintained engines are Saxon's (SaxonJS is not open source and has no XQuery) or partial (fontoxpath) | axes such as `ancestor::` and `following-sibling::`, and predicates in steps |
| Kusto (KQL) | no open-source engine runs it in TypeScript or the browser, and its identifier rules refuse vmd's `$title` and `$body` as column names | pipeline syntax, and graph operators `make-graph` and `graph-match` |
| EdgeQL | it runs only in Gel's server, and Gel Data Inc. is shutting down | backlinks in a path, `.<author[is BlogPost]` |
| CSS selectors, GitHub search, Lucene | selection languages without projection | `:is`, `:not` and `:has` for #47; VQL's own origins |

#### JSONPath (RFC 9535)

**What it is.** RFC 9535 standardises JSONPath: a query selects a nodelist from one JSON value, through
segments of selectors (name, wildcard, index, array slice, filter) and the descendant segment `..`. It has
filter expressions with comparisons, `&&`, `||`, `!`, existence tests and five functions, and no
projection into new objects, no joins, no sorting and no aggregates (D, below). Mapped onto vmd: the query
runs over one exported value, a record's value view or an array of records (the H shape of section 4.5).

**Prior art and implementations.**

- RFC 9535, *JSONPath: Query Expressions for JSON*
  ([rfc-editor.org/rfc/rfc9535](https://www.rfc-editor.org/rfc/rfc9535.html), read on 2026-10-20):
  selectors (§2.3.1 to §2.3.5), filter expressions (§2.3.5.1), the descendant segment, "a double dot `..`
  followed by a child segment" (§2.5.2.1), function extensions `length`, `count`, `match` (the whole string
  matches an I-Regexp, RFC 9485), `search` (a substring matches), `value` (§2.4), results as nodelists in
  which "Duplicate nodes are not removed" (§2.1.2), and Normalized Paths, "a unique representation of the
  location of a node" (§2.7), such as `$['a'][1]`.
- **Singular queries, the analogue of §7.4.** RFC 9535 defines a singular query as one that "produces a
  nodelist containing at most one node" (§1.1), and makes it a syntactic property (§2.3.5.1): a
  `singular-query` is `@` or `$` followed only by name segments and index segments
  (`singular-query-segments = *(S (name-segment / index-segment))`). Comparisons accept only singular
  queries, "each of which selects at most one node" (§2.3.5.1). So JSONPath proves "at most one" from the
  syntax alone, while vmd proves, from the schema and the record's first step, that every step crosses a level
  whose keys are unique, so that the address names one node or none (§7.4). The difference matters for vmd: a keyed-list step (`#benchmarks/append-4k`, a section by `@key`)
  is a filter in JSONPath (`[?@.name=='append-4k']`) and therefore never singular there; only vmd's exact
  path (`$['$sections'][0]['$body']`) maps onto a singular query.
- The JSONPath Compliance Test Suite "may be used to test implementations of JSONPath RFC 9535"
  ([github.com/jsonpath-standard/jsonpath-compliance-test-suite](https://github.com/jsonpath-standard/jsonpath-compliance-test-suite),
  read on 2026-10-20). Its README lists no passing implementations. A comparison of many implementations
  across languages is at [cburgmer.github.io/json-path-comparison](https://cburgmer.github.io/json-path-comparison/)
  (read on 2026-10-20).
- TypeScript: `jsonpath-rfc9535` 1.3.0, Apache-2.0, published 2025-04-04
  ([registry.npmjs.org/jsonpath-rfc9535](https://registry.npmjs.org/jsonpath-rfc9535)); its README says "It
  passes the entire JSONPath Compliance Test Suite with a 100% success rate (tested against commit
  05f6cac)" ([github.com/P0lip/jsonpath-rfc9535](https://github.com/P0lip/jsonpath-rfc9535)). `json-p3` 3.0.1,
  MIT, published 2026-10-09: "We follow RFC 9535 and test against the JSONPath Compliance Test Suite"
  ([github.com/jg-rp/json-p3](https://github.com/jg-rp/json-p3)). `@jsonpath-tools/jsonpath` 1.0.0, MIT,
  2026-05-24 (registry metadata only; compliance U). Older non-RFC libraries (`jsonpath`, `jsonpath-plus`)
  implement pre-RFC dialects (O from their descriptions). All read on 2026-10-20.
- Python: `jsonpath-rfc9535` 2.0.2, MIT, 2026-10-10: "We follow RFC 9535 strictly and test against the
  JSONPath Compliance Test Suite" ([github.com/jg-rp/python-jsonpath-rfc9535](https://github.com/jg-rp/python-jsonpath-rfc9535));
  `python-jsonpath` 2.2.2, MIT, 2026-10-17, the same author's package "with additional features"
  ([pypi.org/pypi/python-jsonpath/json](https://pypi.org/pypi/python-jsonpath/json)). All read on 2026-10-20.

**The scenarios.** Run with `jsonpath-rfc9535` 1.0.1 for Python (the latest that installs on Python 3.9)
over the H array of records (M). Strings are in single quotes here; RFC 9535 also allows double quotes,
which suit a single-quoted shell argument better.

S1. Expressible, but not singular: the section is reached by a filter on `@key`. The exact path is singular.

```jsonpath
$[?@.path=='decisions/F7.md'].value['$sections'][?@['@key']=='decision']['$body']
```

S2. Partly: the filter is expressible, the result is the whole record (no projection), and the severity
order is spelled out.

```jsonpath
$[?@.collection=='tickets' && @.value.status!='Closed' && (@.value.severity=='Critical' || @.value.severity=='High') && @.value.component[?@=='log-v3']]
```

S3. Partly: the Decision bodies of round U, without ids, dates or order. JSONPath cannot build an object of
several fields or sort.

```jsonpath
$[?@.collection=='decisions' && @.value.round=='U'].value['$sections'][?@['@key']=='decision']['$body']
```

S4. Partly: the matching sections, at any depth through `..`. I-Regexp has no flags, so case is written
into the pattern; the address comes from the Normalized Path, not from vmd's canonical address; no excerpt.

```jsonpath
$[?@.collection=='decisions']..['$sections'][?@['@key']=='owners-note' && search(@['$body'], '[Ss]elector')]
```

S5a. No: following a reference is a join between two documents. S5b. Partly, over the H `refs` rows:

```jsonpath
$[?@.target=='decisions/F7.md']
```

S6, S7, S8. No: no joins, no recursion along references (`..` descends the JSON tree, not references), no
grouping. `count()` counts the nodes of one query, not per group.

S9. Partly: RFC 9535 has no parameters, so the caller substitutes the values into the text; no sort.

```jsonpath
$[?@.collection=='decisions' && @.value.status=='accepted' && @.value.sections[?@=='§7.4']].value.id
```

**Notes for the comparison table (JSONPath).** Expressiveness: S1 yes, S2-S5b and S9 partly, S5a and
S6-S8 no. Readability (O): good for paths, poor for long filters. Implementation: libraries with compliance
claims in both languages (D). Agent reliability (O): many pre-RFC dialects in circulation, so an agent may
write a dialect the RFC rejects. §7.4: the closest prior art (syntactic singular queries). CLI: `$`, `@`,
`'` and `?` all appear; one argument in single quotes, with double-quoted strings inside. Verdict (O): prior
art for the path language, not an approach of its own.

#### JMESPath

**What it is.** A JSON query language with projections (`[*]`, `[]`), filters (`[?expr]`), multiselect
lists and hashes (`{a: b}`), pipes and a fixed function library. One JSON value in, one out; no variables in
the original specification, no joins, no group-by, no regular expressions (D, below).

**Prior art and implementations.**

- The specification ([jmespath.org/specification.html](https://jmespath.org/specification.html), read on
  2026-10-20): projections, flatten, filters (ordering comparators apply to numbers only), multiselect hash
  and list, pipes, `@`, raw string literals `'...'`, JSON literals in backticks, and functions such as
  `sort_by`, `length`, `contains`, `starts_with`, `max_by`, `join`. "Any identifier that does not start
  with `A-Za-z_` must be quoted", so `"$sections"` and `"@key"` are written quoted. Joins between documents,
  group-by, variables and regular expressions are not in it (D: absent from the specification read).
- The JMESPath Community specification adds `let`, accepted as JEP 11a: `let $foo = bar in {a: myvar, b:
  $foo}` ([github.com/jmespath-community/jmespath.spec, jep-011a](https://github.com/jmespath-community/jmespath.spec/blob/main/jep-011a-lexical-scope.md),
  read on 2026-10-20). The Python `jmespath` 1.1.0 refuses it (M: `LexerError ... Unknown token $`).
- Libraries: Python `jmespath` 1.1.0, MIT, 2026-01-22 ([pypi.org/pypi/jmespath/json](https://pypi.org/pypi/jmespath/json));
  JavaScript `jmespath` 0.16.0, Apache-2.0, last published 2022-01-19
  ([registry.npmjs.org/jmespath](https://registry.npmjs.org/jmespath)); `@jmespath-community/jmespath`
  1.3.0, MPL-2.0, 2025-07-16 ([registry.npmjs.org/@jmespath-community/jmespath](https://registry.npmjs.org/@jmespath-community/jmespath)),
  whose README lists custom functions, root access with `$` and experimental ternaries
  ([github.com/jmespath-community/typescript-jmespath](https://github.com/jmespath-community/typescript-jmespath)).
  All read on 2026-10-20.

**The scenarios.** Run with Python `jmespath` 1.1.0 over the H array of records (M).

S1. Yes; `| [0]` takes the first match, which is the opposite of a proof.

```jmespath
[?path=='decisions/F7.md'].value."$sections"[] | [?"@key"=='decision']."$body" | [0]
```

S2. Yes, with the severity order spelled out.

```jmespath
[?collection=='tickets' && value.status!='Closed' && (value.severity=='Critical' || value.severity=='High') && contains(value.component, 'log-v3')].{path: path, title: value."$title", severity: value.severity}
```

S3. Yes, but `reverse` also reverses the tie order, so ties come by path descending (S3 asks for
ascending; one `sort_by` key only).

```jmespath
reverse(sort_by([?collection=='decisions' && value.round=='U'], &value.date))[].{id: value.id, status: value.status, date: value.date, decision: value."$sections"[?"@key"=='decision']."$body" | [0]}
```

S4. Partly: `contains` is case-sensitive and there is no lower-case function or regular expression, so
`'selector'` misses "Selector" (M: the query returned nothing on the test data until the pattern's case
matched); top-level sections only, since there is no recursive descent.

```jmespath
[?collection=='decisions'].{path: path, notes: value."$sections"[?"@key"=='owners-note' && contains("$body", 'selector')]."$body"} | [?length(notes) > `0`]
```

S5a. No (no joins). S5b. Partly, over the H `refs` rows:

```jmespath
[?target=='decisions/F7.md'].{from: path, in: address, status: status}
```

S6, S7, S8. No: no joins, no recursion, no grouping.

S9. Partly: no parameters in the original specification (the community's `let` would bind them, but is not
in the Python library), so values are substituted into the text.

```jmespath
reverse(sort_by([?collection=='decisions' && value.status=='accepted' && contains(value.sections || `[]`, '§7.4')], &value.date))[].{id: value.id, title: value.title}
```

**Notes for the comparison table (JMESPath).** S1-S3 yes, S4, S5b, S9 partly, S5a and S6-S8 no. Readable
for projections (O). Libraries in both languages; the reference JavaScript library has had no release since
2022 (D). Backticks in JSON literals are command substitution inside a double-quoted shell argument, so the
query must be single-quoted (O). No singularity notion. Verdict (O): prior art for projection syntax (the
multiselect hash), not an approach.

#### XPath 3.1 and XQuery 3.1

**What it is.** XPath is the path language over XML trees: steps along axes with predicates. XQuery 3.1
"extends XQuery to support JSON as well as XML, adding maps and arrays to the data model"
([w3.org/TR/xquery-31](https://www.w3.org/TR/xquery-31/), W3C Recommendation 21 March 2017, read on
2026-10-20), with FLWOR expressions (`for`, `let`, `where`, `group by`, `order by`, `count`, window
clauses, `return`), recursive functions, and the lookup operator `?`. Two mappings are possible, both H:
(1) the H JSON export read with `fn:json-doc` as maps and arrays; (2) an XML rendering of each record, with
sections as nested elements. The choice matters: axes apply only to nodes. "If the context item is a node,
an axis step returns a sequence of zero or more nodes", and otherwise it is a type error, XPTY0020 (XQuery
3.1, §3.3.2), so over maps there is no `ancestor::` and no `parent::`, which is what VQL's upward field
resolution in `nodes` mode needs (§10.4). The XML rendering gets the axes and loses the JSON value view as
the model.

**Prior art and specifics (D, XQuery 3.1 and Functions and Operators 3.1).**

- Axes, §3.3.2.1: forward child, descendant, attribute, self, descendant-or-self, following-sibling,
  following; reverse parent, ancestor, ancestor-or-self, preceding, preceding-sibling.
- Lookup, §3.11.3: unary `?name`, `?2`, `?*`, `?(expr)`; postfix `E?S`; examples
  `map { "first" : "Jenna", "last" : "Scott" }?first` and `[4, 5, 6]?2`. A key such as `$sections` is
  written `?("$sections")`.
- `group by` and `order by` in FLWOR (§3.12), with the specification's own example grouping revenue by
  store and category.
- `fn:parse-json` and `fn:json-doc` are §17.5.1 and §17.5.2 of XPath and XQuery Functions and Operators 3.1
  ([w3.org/TR/xpath-functions-31](https://www.w3.org/TR/xpath-functions-31/), read on 2026-10-20; the
  signatures were not read, U). `fn:exactly-one` is a runtime cardinality check in the same document (U: not
  read today).
- Libraries. JavaScript: `fontoxpath` 3.34.0, MIT, 2025-12-24 ([registry.npmjs.org/fontoxpath](https://registry.npmjs.org/fontoxpath)),
  "Not all XPath 3.1 functions are implemented yet", XQuery available but "Some parts of FLWOR
  expressions" missing, XQuery Update Facility 3.0 supported, and it evaluates over a DOM
  ([github.com/FontoXML/fontoxpath](https://github.com/FontoXML/fontoxpath)). SaxonJS: "free of charge but
  not open source", conforms to XSLT 3.0 and XPath 3.1, no XQuery mentioned; 2.7 (2024-10-17), 3.0.0-beta2
  (2025-06-02) ([saxonica.com/saxonjs](https://www.saxonica.com/saxonjs/index.xml)). Python: `elementpath`
  5.1.4, MIT, 2026-08-08, "XPath 1.0/2.0/3.0/3.1 parsers and selectors for ElementTree and lxml"
  ([pypi.org/pypi/elementpath/json](https://pypi.org/pypi/elementpath/json)), no XQuery; `saxonche` 13.1.0,
  2026-10-15, "SaxonC-HE: open-source Home Edition ... for XSLT 3.0, XQuery 3.1, XPath 3.1"
  ([pypi.org/project/saxonche](https://pypi.org/project/saxonche/); its licence is not named on that page,
  U), a native extension. All read on 2026-10-20.

**The scenarios S1, S4, S5b and S7, in XQuery over mapping (1).** Run with `saxonche` 13.1.0 over the H
export, `records.json` and `refs.json` as JSON arrays (M).

```xquery
(: S1 :)
json-doc("records.json")?*[?path = "decisions/F7.md"]
  ?value?("$sections")?*[?("@key") = "decision"]?("$body")
```

```xquery
(: S4: sections at any depth through a recursive function, since maps have no descendant axis :)
declare function local:sections($s as map(*)) as map(*)* {
  $s?("$sections")?* ! (., local:sections(.))
};
for $r in json-doc("records.json")?*[?collection = "decisions"]
for $s in local:sections($r?value)
where $s?("@key") = "owners-note" and matches($s?("$body"), "selector", "i")
return map { "address": $r?path || $s?("@address"),
             "excerpt": substring($s?("$body"), 1, 100) }
```

```xquery
(: S5b, over the H refs rows :)
json-doc("refs.json")?*[?target = "decisions/F7.md"]
  ! map { "from": ?path, "in": ?address, "status": ?status }
```

```xquery
(: S7: closure by a recursive function that carries the visited set, so a cycle ends :)
declare variable $refs := json-doc("refs.json")?*;
declare function local:replaced-by($p as xs:string, $seen as xs:string*) as xs:string* {
  for $t in $refs[?path = $p and starts-with(?at, "/superseded_by/")]?target
  where not($t = $seen)
  return ($t, local:replaced-by($t, ($seen, $t)))
};
let $records := json-doc("records.json")?*
for $p in distinct-values(local:replaced-by("decisions/F4.md", "decisions/F4.md"))
let $status := $records[?path = $p]?value?status
return map { "path": $p, "status": $status, "in_force": $status = "accepted" }
```

S8 also runs (M), with `group by`:

```xquery
for $t in json-doc("records.json")?*[?collection = "tickets" and ?value?status != "Closed"],
    $c in $t?value?component?*
group by $c, $sev := $t?value?severity
order by $c, $sev
return map { "component": $c, "severity": $sev, "count": count($t) }
```

**Standalone or prior art?** Prior art only (O): XQuery can express every scenario, but its JSON support is
an addition to an XML language, its axes do not apply to the JSON model vmd uses, and the maintained
engines with XQuery 3.1 are Saxon's (SaxonJS not open source and without XQuery; SaxonC-HE a native build)
or partial (fontoxpath). Its axes and predicates are the vocabulary to borrow for the path language
(`ancestor::`, `following-sibling::`, predicates in steps).

#### Kusto Query Language (KQL)

**Description.** A tabular pipeline (`T | where ... | project ... | summarize ... by ...`), with `join`, `mv-expand` for
arrays and, newer, graph operators `make-graph` and `graph-match`. Over vmd it needs the same tables as SQL (4.2), with `component` and
`sections` as `dynamic` arrays (H).

**Prior art and libraries.**
- `graph-match`: `G | graph-match [cycles=...] Pattern [where Constraints] project ...`; variable-length edges as
  `-[e*3..5]-`, where "Both the minimum and maximum values must be integer scalars", so a closure needs an explicit upper bound;
  `cycles` defaults to `unique_edges` (D, [graph-match](https://learn.microsoft.com/en-us/kusto/query/graph-match-operator)).
  `make-graph SourceNodeId --> TargetNodeId [with Nodes1 on NodeId1 [, Nodes2 on NodeId2]]` (D,
  [make-graph](https://learn.microsoft.com/en-us/kusto/query/make-graph-operator)).
- `mv-expand Column [to typeof(T)]` (D, [mv-expand](https://learn.microsoft.com/en-us/kusto/query/mv-expand-operator)); `join
  kind=...` defaulting to `innerunique`, with `$left.a == $right.b` (D, [join](https://learn.microsoft.com/en-us/kusto/query/join-operator));
  `sort by` whose "Default is `desc`" (D, [sort](https://learn.microsoft.com/en-us/kusto/query/sort-operator)); `has` matches a
  whole term, case-insensitively (D, [has](https://learn.microsoft.com/en-us/kusto/query/has-operator)); `declare
  query_parameters(Name:Type [= Default], ...)` (D, [query parameters](https://learn.microsoft.com/en-us/kusto/query/query-parameters-statement));
  `set_has_element(set, value)` (D, [set_has_element](https://learn.microsoft.com/en-us/kusto/query/set-has-element-function)).
- **Identifiers.** A name that is a keyword or holds `-` must be written `['name']`; KQL recommends names starting with a
  capital letter or an underscore to avoid keywords, and "The `$` character is allowed in entity names when generated by a
  KQL operator" only (D, [entity names](https://learn.microsoft.com/en-us/kusto/query/schema-entities/entity-names)). vmd's
  lower-case field names collide: duckdb-kql refused `title`, `date` and `kind` unquoted (M; whether Kusto itself refuses them
  is U), and `$title`, `$body` cannot be column names at all.
- **No embeddable engine for TypeScript.** Microsoft's open-source `Kusto-Query-Language` is "a C# parser and a semantic
  analyzer", with a translator that generates JavaScript versions of those libraries, Apache-2.0 (D,
  [github.com/microsoft/Kusto-Query-Language](https://github.com/microsoft/Kusto-Query-Language)); it does not execute queries
  (U: not stated). The Kusto emulator is a local Docker image under Microsoft Software License Terms, not open source (D per the
  search summary of [learn.microsoft.com Kusto emulator](https://learn.microsoft.com/en-us/azure/data-explorer/kusto-emulator-overview);
  the page itself not read in full, U). For Python, `duckdb-kql` (MIT, 1.0.11, 2026-10-18, Python 3.10 or later) translates KQL
  to DuckDB SQL and documents its gaps operator by operator, `graph-match` included (D,
  [kql-support.md](https://github.com/mmaitre314/duckdb-kql/blob/main/docs/kql-support.md)). Nothing comparable for JavaScript
  was found (U).

**The scenarios** (each run through duckdb-kql, M; the S9 run stored `sections` as JSON text and needed `parse_json(sections)`):

```kusto
// S1
nodes
| where path == "decisions/F7.md" and key == "decision" and depth == 1
| project body
```

```kusto
// S2: == and in are case-sensitive; =~ and in~ are the case-insensitive forms
tickets
| where status != "Closed" and severity in ("Critical", "High")
| mv-expand component to typeof(string)
| where component == "log-v3"
| sort by path asc
| project key, status, severity
```

```kusto
// S3: `date` quoted as an identifier
decisions
| where round == "U"
| join kind=leftouter (nodes | where depth == 1 and key == "decision" | project path, decision = body) on path
| sort by ['date'] desc, path asc
| project id, status, ['date'], decision
```

```kusto
// S4: has matches whole terms; hasprefix finds "selectors"
nodes
| where key == "owners-note" and path startswith "decisions/" and body hasprefix "selector"
| sort by path asc
| project address, excerpt = substring(body, max_of(indexof(tolower(body), "selector") - 40, 0), 120)
```

```kusto
// S5 (a) forward
field_refs
| where source_path == "decisions/G9.md" and field == "supersedes"
| join kind=inner (decisions) on $left.target_path == $right.path
| project id, ['title']
```

```kusto
// S5 (b) backlinks
refs
| where target_path == "decisions/F7.md"
| sort by source_path asc, source_exact_path asc
| project source_path, source_exact_path, status
```

```kusto
// S6: t.['kind'] is accepted by duckdb-kql; Kusto's form for a quoted property is U
let records = union
    (decisions | project path, ['kind'] = "decision", id, ['title'], status),
    (tickets | project path, ['kind'] = "ticket", id = key, ['title'], status);
field_refs
| where field in ("superseded_by", "tickets")
| make-graph source_path --> target_path with records on path
| graph-match (d)-[s]->(d2)-[c]->(t)
    where s.field == "superseded_by" and c.field == "tickets" and t.['kind'] == "ticket" and t.status != "Closed"
    project id = d.id, ['title'] = d.['title']
| distinct id, ['title']
```

```kusto
// S7: the upper bound (10) is required
field_refs
| where field == "superseded_by"
| make-graph source_path --> target_path with decisions on path
| graph-match (a)-[s*1..10]->(b)
    where a.id == "F4"
    project id = b.id, status = b.status
| distinct id, status
| extend in_force = status == "accepted"
| sort by id asc
```

```kusto
// S8
tickets
| where status != "Closed"
| mv-expand component to typeof(string)
| summarize tickets = count() by component, severity
| sort by component asc, severity asc
```

```kusto
// S9: parameter names must differ from column names (status == status would compare the column with itself)
declare query_parameters(p_section:string, p_status:string = "accepted");
decisions
| where status == p_status and set_has_element(sections, p_section)
| sort by ['date'] desc, path asc
| project id, ['title'], ['date']
```

**Verdict (O).** Dropped as an approach: no open-source engine runs it in TypeScript or in the browser, and
its identifier rules clash with vmd's field names and forbid `$` members; keep it as prior art for pipeline syntax and for
`make-graph`/`graph-match`, which PRQL lacks. PRQL is the pipeline representative, at the cost of being a compiler to SQL that
inherits all of 4.2's tables.

#### EdgeQL

- **EdgeQL (Gel, formerly EdgeDB).** Paths follow links forward, `BlogPost.author.email`, and backward with `.<`:
  `select User.<author[is BlogPost];` gives "BlogPost objects that link to the user via a link named author"; without
  `[is ...]` the result is typed `BaseObject` (D, [Gel docs, paths](https://docs.geldata.com/reference/edgeql/paths)). It is
  the closest prior art for a *path* language with backlinks. Gel runs as a server over PostgreSQL; Gel Data Inc. announced
  on 2025-12-02 that it is "shutting down" and joining Vercel, Gel Cloud ending on 2026-01-31, while "Gel will remain fully
  open source and available on GitHub" (D, [geldata.com/p/sunset](https://www.geldata.com/p/sunset)). No embeddable
  implementation was found (U).

#### CSS selectors, GitHub search and Lucene

- **CSS Selectors Level 4** (W3C Working Draft, 22 January 2026,
  [w3.org/TR/selectors-4](https://www.w3.org/TR/selectors-4/), read on 2026-10-20): `.class` (class
  selector, §6.6) and `#id` (§6.7), already vmd's model for tags and anchors (§6.1); `:is()`, `:not()` (any
  and none of a list, §4.2, §4.3) and `:has()`, which matches an element "if there exists an element that
  matches either of the relative selectors ... when evaluated with E as the anchor elements"; attribute
  selectors such as `[att~=val]` (one of a whitespace-separated list, §6.1); combinators: descendant (space),
  child `>`, next-sibling `+`, subsequent-sibling `~` (§14). Prior art for #47's and, or and not (`:is`,
  `:not`), for selecting a section by what it contains (`:has`), and for descent (combinators). It selects
  only; it has no projection.
- **GitHub's issue search** (VQL's model, §10.1): qualifiers `name:value`, `-` to exclude, and, documented
  today, `AND` and `OR` with parentheses: "You can nest filters using parentheses up to five levels deep"; a
  space means AND, and `label:"bug","wip"` is an OR within one qualifier
  ([docs.github.com, filtering and searching issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests),
  read on 2026-10-20). The general search syntax has `>`, `>=`, `<`, `<=`, ranges `n..n` and `n..*`, ISO 8601
  dates, and `NOT` "only ... for string keywords"
  ([docs.github.com, understanding the search syntax](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax),
  read on 2026-10-20). The comma OR is documented for `label:`; VQL has no such form.
- **Lucene's classic query parser** (Lucene 10.3.0,
  [lucene.apache.org, queryparser.classic](https://lucene.apache.org/core/10_3_0/queryparser/org/apache/lucene/queryparser/classic/package-summary.html),
  read on 2026-10-20): `field:term`, phrases, `?` and `*` wildcards, `/regex/`, fuzzy `~`, ranges
  `[a TO b]` inclusive and `{a TO b}` exclusive, `AND` (`&&`), `OR` (`||`, the default), `NOT` (`!`), `+`
  and `-`, grouping and field grouping `title:(+return +"pink panther")`, and backslash escaping of
  `+ - && || ! ( ) { } [ ] ^ " ~ * ? : \ /`. Its default operator is OR, where GitHub's and VQL's
  juxtaposition is AND.

## 5. Comparison

### 5.1 Which scenarios each approach can express

**yes**: expressible as the scenario states it; **part**: only in part, for the reason given in the approach's section;
**no**: not expressible; **H**: only with a hypothetical extension of the language itself. Every cell outside the first row also
rests on the approach's H mapping of vmd's data (section 4). S5 is split into (a) forward and (b) backlinks.

| Approach | S1 lookup | S2 filter | S3 projection | S4 section search | S5 refs (a / b) | S6 multi-hop | S7 closure | S8 aggregate | S9 parameters |
|---|---|---|---|---|---|---|---|---|---|
| 4.1 path language (VQL) | yes | yes | yes | yes | H / yes | H | H | H | part; H |
| 4.2 SQL (SQLite; SQL/PGQ) | part | yes | yes | yes | yes / yes | yes | yes | yes | yes |
| 4.3 PRQL | part | yes | yes | part | yes / yes | yes | yes, experimental | yes | yes |
| 4.4 GraphQL | yes | yes | yes | part | yes / yes | yes | no | part | yes |
| 4.5 jq | yes | yes | yes | yes | yes / yes | yes | yes | yes | yes |
| 4.6 Cypher, GQL | part | yes | yes | part | yes / yes | yes | yes | yes | yes |
| 4.7 SPARQL | yes | yes | yes | part | yes / yes | yes | yes | yes | yes |
| 4.8 Datalog | part | yes | part | part | yes / yes | yes | yes | yes | yes |
| 4.9 Dataview DQL | no | yes | part | no | part / part | part | no | yes | part |
| 4.10 MongoDB | yes | yes | yes | part | yes / yes | yes | yes | yes | part (`let`) |
| JSONPath | yes | part | part | part | no / part | no | no | no | part |
| JMESPath | yes | yes | yes | part | no / part | no | no | no | part |
| XQuery 3.1 | yes | yes | yes | yes | yes / yes | yes | yes | yes | yes |
| KQL | part | yes | yes | yes | yes / yes | yes | yes, bounded | yes | yes |

Three things the table does not show:

- **S1 "yes" outside the first row means a lookup by record and section key, not by a vmd address.** No other language resolves
  an address: a derived anchor, a deep explicit anchor, a semantic path of several steps or an alias needs vmd's resolver (4.2).
  The one exception is GraphQL's H root field `node(address:)` (4.4), which hands the address to that resolver.
- **S2's enum order is lost everywhere but in the first row.** Only vmd reads `x-vmd-ordered` (§9.3), so `severity >= High` becomes
  a list of values in every other approach.
- **XQuery's row** rests on five of the nine scenarios written and run (S1, S4, S5b, S7, S8); the other four are the author's
  reading of the specification (O).

### 5.2 What each approach costs and offers

Library facts are D, from the approach's section. Readability and agent reliability are O throughout: no measurement of either
was found for these languages on data like vmd's, apart from one benchmark figure for SQL.

| Approach | TypeScript | Python | Agents (O) | Singular address (§7.4) | CLI | Portable index (§14.4) |
|---|---|---|---|---|---|---|
| 4.1 path language | vmd's own; the draft estimates a few hundred lines (§10.6) | the same | GitHub-search syntax, already a skill-file's worth; no model knows the H extensions | native: addresses are proved, selectors are not, and only addresses are references or write targets | one short single-quoted argument | VQL in the browser over `records-*.jsonl` covers summary fields only; S2, S3 and S8 also need `values/*.json` or the nodes, and references `refs-*.jsonl` |
| 4.2 SQL | `node:sqlite` (built in; a release candidate in Node 24), `better-sqlite3` (native), `sql.js` (Wasm, no FTS5), DuckDB for Node and Wasm | `sqlite3` (standard library, the system's SQLite), `duckdb` | the most familiar; BIRD's top entry scores 82.95 against humans' 92.96 on unfamiliar databases; the H views are where an agent errs | keys prove at most one row of a table, not an address; a scalar subquery silently takes the first row | long, and SQL's string literals are single-quoted ([sqlite.org/lang_expr](https://sqlite.org/lang_expr.html)), which ends a single-quoted shell argument | DuckDB reads `records-*.jsonl` directly (M), and DuckDB-Wasm runs in the browser |
| 4.3 PRQL | `prqlc` 0.13.14 bindings (pre-1.0), plus a SQL engine | the same | little text to learn from | none | strings in double quotes fit a single-quoted argument; `$name` parameters | as SQL |
| 4.4 GraphQL | `graphql` 17.0.2; vmd writes the schema generator, filters and resolvers | `graphql-core` 3.3.0, the same | syntax well known; the filter vocabulary differs per server | list and non-list field types: the cardinality is in the schema, checked at execution | poor: multi-line, braces, `$variables` | `graphql-js` runs in the browser; resolvers need the targets' values |
| 4.5 jq | `jq-wasm`, `jq-web` (Wasm) | `jq` 1.13.0 (a C extension) | high for filters, lower for `INDEX`, `recurse`, `def` | none; `first` and `limit` take the first match | single-quoted; members written `.["$body"]` | needs the value views and computed fields inlined (H) |
| 4.6 Cypher, GQL | LadybugDB (formerly Kùzu; native and Wasm); `falkordblite` | LadybugDB, from the same engine; FalkorDBLite (a bundled server, SSPL) | familiar | none | single-quoted; Cypher's strings take double quotes too ([Neo4j](https://neo4j.com/docs/cypher-manual/current/values-and-types/boolean-numeric-string/)) | a graph built from `nodes` and `refs` lines (H) |
| 4.7 SPARQL | Comunica 5.4.1, Oxigraph 0.5.12 (Wasm) | rdflib 7.6.0, pyoxigraph 0.5.12 | known from Wikidata; prefixes and IRIs trip writers | none, though an address maps naturally onto an IRI with a fragment | fine in single quotes | triples built from the lines (H); RDF loses the order of arrays |
| 4.8 Datalog | DataScript 1.8.1 (EPL-1.0, a ClojureScript runtime) | pyDatalog 0.22.4, active, in its own syntax; none in Datomic's | little text to learn from | lookup refs on a unique attribute name at most one entity, but only as a query's input | fine; rules are a second argument | facts loaded into DataScript (H) |
| 4.9 Dataview DQL | nothing outside Obsidian; no specification | nothing | small, SQL-like | none | moderate | close to records plus refs, but a reimplementation |
| 4.10 MongoDB | mingo 7.2.5, whose `$lookup` with a `pipeline` gave wrong results for S6 (M) | testing mocks only (mongomock, mongita) | fluent; the renaming of `$` members is a trap | none; `$elemMatch` projection returns the first match | every operator starts with `$`; single quotes | documents in memory, through mingo |

## 6. Observations

**These are the author's observations (O), not recommendations.** Each says what it rests on, so that it can be checked.

1. **VQL as drafted already answers the single-record and single-collection scenarios.** S1 to S4 and S5b need nothing beyond the
   draft (4.1). What it cannot say is everything that crosses records: following a reference (S5a), joining over two of them (S6),
   following one any number of times (S7), counting (S8), and binding parameters outside the query text (S9). So the owner's
   choice between "a simple path language" and "a larger query language" is, on these scenarios, a choice about those five.
2. **Two questions are bundled in "the query language".** A selector (#47) is written into records, as a reference declared
   `cardinality: many`, so it falls under the format's versioning rules (§9.1: minor versions only add, every addition detectable)
   and must give the same answer in every implementation. A query is typed by an agent and thrown away. Nothing in the scenarios
   requires the two to be one grammar, and nothing prevents it.
3. **The mapping, not the parser, is the cost of every other language, and it is nearly the same mapping for all of them.** Every
   approach in 4.2 to 4.10 needs what only vmd computes: section keys (`@key`) and canonical addresses (`@address`), the resolved
   target of every reference with the field it sits in, the record part of the target apart from its fragment, the enum order of
   `x-vmd-ordered`, and the section bodies. Those are the H columns of 4.2, the H export of 4.5, the H graph of 4.6. Specifying that
   data once, as part of the index (§14.2, §14.4), is useful whichever language uses it, and the browser site of §16 needs some of
   it anyway.
4. **Some of vmd's semantics do not survive a mapping.** VQL matches a field or a section by the same name (`status:open` and
   `## Status`, §10.3), resolves a field term upwards through a section's ancestors (§10.4), folds case by Unicode simple case
   folding (F10), and orders ties by path bytes, then document order (C25). In the mapped languages these become, in turn: two
   different columns or properties; an explicit join to the ancestors; ASCII-only `NOCASE` and `LIKE` in SQLite, FTS5's own
   tokenizer, Cypher's `toLower`, a regex flag; and orders that MongoDB's `$group` and `$graphLookup`, and Datalog's sets, leave
   undefined. SQLite's `BINARY` collation does match C25's byte order. A second engine would therefore answer some queries
   differently from VQL unless its semantics are pinned and tested by the conformance suite (§19.1).
5. **"First occurrence wins" is built into several of them.** A SQLite scalar subquery takes the first row, MongoDB's `$elemMatch`
   projection the first element, jq's `first` and JMESPath's `[0]` the first match. §5.7 rejects exactly that for references. The
   draft already keeps engine results away from references: an engine's results "are addresses with projected values" (§18.2),
   and only singular addresses are references or write targets (§7.4).
6. **§7.4's guarantee has partial analogues, of three kinds.** JSONPath proves a query singular from its syntax alone (name and
   index steps); GraphQL declares cardinality in the schema (a non-list field type, checked when the result is coerced); Datomic's
   lookup refs and SQL's keys rest on declared uniqueness, and give at most one entity or row, a lookup ref only as a query's
   input. vmd's proof is closest to the second kind, from the schema and the record's first step. In every approach but the
   first, the guarantee holds only where the query hands an address to vmd's resolver (the H `node(address:)` field of 4.4, the H
   `vmd_resolve` of 4.2) instead of resolving it itself.
7. **The graph scenarios are where the languages differ most.** S5 to S7 read most directly in Cypher's arrows, SPARQL's property
   paths (`^` for backlinks, `+` for closure) and Datalog's rules. SQL needs a recursive CTE, longer but in every SQLite. SQL/PGQ
   reads like Cypher; its one embeddable implementation, `duckpgq`, is a research project that runs on DuckDB 1.4.4 only, and
   needs `ANY SHORTEST` for an unbounded path, though not for a bounded one. GraphQL cannot express S7 at all. MongoDB's `$graphLookup` can, unordered.
8. **Two implementations narrow the field.** The owner's requirement asks that an implementation without git or SQLite be able to
   implement the core, in several programming languages (v0.1-6). Libraries exist on both the TypeScript and the Python side for
   SQL (SQLite, DuckDB), SPARQL (Oxigraph on both, Comunica, rdflib), jq (Wasm and a C extension), GraphQL (parsers and executors
   only), JSONPath and JMESPath, and for Cypher through native engines (LadybugDB on npm and PyPI from one engine, FalkorDBLite).
   Datalog has engines on both sides in two different syntaxes (DataScript in Datomic's, pyDatalog in its own). MongoDB's
   language has an in-memory engine in TypeScript only, mingo, which got S6 wrong; Python has testing mocks. Dataview has nothing
   outside Obsidian, and KQL nothing for TypeScript. Some of these are native code (SQLite through `better-sqlite3`, DuckDB,
   LadybugDB, the jq extension), some WebAssembly (`sql.js`, `jq-wasm`, Oxigraph's JavaScript build), which is not a native
   module, and `node:sqlite` is built into Node and a release candidate in Node 24. The draft's "needs no native modules" (§14.3)
   describes how the reference implementation stores its index, not a rule for query libraries.
9. **The shell is part of the language.** §1.3 and §12.4 keep VQL free of characters a shell expands. The others bring their own
   hazards: SQL's single-quoted strings inside a single-quoted argument, `$` in GraphQL variables, SQLite and PRQL parameters and
   MongoDB operators, `>` in Cypher's arrows and in the path extension's `->`. Most of the larger languages would in practice be
   given in a file, not on the command line (`-f q.sql`).
10. **Prior art has grown filter languages both by syntax and by parameters.** GitHub's issue search added syntax: `AND`, `OR`
    and parentheses nested up to five levels. Solr counts by facets passed as request parameters, and VQL already puts sorting,
    projection and paging in parameters (§10.1). Among tools for Markdown notes, Dataview stops at pages and their fields and links,
    where vmd's sections, prose, typed references and closure begin, and Logseq chose Datalog (a secondary source, 4.8).

## 7. Open questions for the discussion

1. **What I3 must answer.** The plan's I3 is VQL as drafted (I3.1 to I3.6), and its demonstration reproduces the ticket index's
   views by status, severity, component and text (I3.8). Are S5a and S6 to S9, or some of them, part of I3, or of a later phase?
2. **One language, or a core with engines?** §10.1 and §18.2 already allow engines beside VQL, and §21 puts GraphQL and the SQL
   profile in I8. Does the cross-record part go into VQL, into an engine, or into both?
3. **If VQL grows, how far?** Reference traversal (`->`), closure (`+`), value groups, counts as a parameter, and bound parameters
   are the five extensions the scenarios ask for (4.1). Which of them, and does closure belong in the Query profile, which today requires "VQL core and the parameters of
   §10.5" (§19.2)?
4. **The selector language of #47 and the query language**: one grammar, a subset, or two? A selector is stored in records and
   falls under §9.1's versioning; a query is not.
5. **What an engine returns.** Must every engine's results be addresses with projected values (§18.2), or may one return rows and
   aggregates, as S8 needs?
6. **How alike must engines be?** Must a second engine reproduce VQL's semantics (case folding, field and section equivalence,
   enum order, tie order) and pass the conformance suite, or may its answers differ, as documented?
7. **Dependencies.** Does a language whose implementations are native code (SQLite through `better-sqlite3`, DuckDB,
   LadybugDB) or WebAssembly builds (`sql.js`, Oxigraph, jq) meet v0.1-6's requirement? Is `node:sqlite`, built into Node and a
   release candidate in Node 24, acceptable? Which approach must the Python implementation support (§21)?
8. **The shared data.** Should the data every mapping needs (computed keys and addresses, references with their field and their
   resolved target, enum order, section bodies) be specified as part of the index (§14.2, §14.4) independently of the language?
9. **Agents.** Is agent reliability worth measuring before choosing, for example by having agents write these nine scenarios in
   two or three of the candidates against the real stores?

## Appendix. Sources, by group of approaches

The links each approach used, as its research recorded them, every one read on 2026-10-20. The corrections after review read
these on 2026-10-21: [Lucene 10.3.0](https://lucene.apache.org/core/10_3_0/queryparser/org/apache/lucene/queryparser/classic/package-summary.html),
[Neo4j's FOR](https://neo4j.com/docs/cypher-manual/current/clauses/for/) and
[string functions](https://neo4j.com/docs/cypher-manual/current/functions/string/),
[LadybugDB's README](https://github.com/LadybugDB/ladybug), [falkordblite on npm](https://registry.npmjs.org/falkordblite),
[pyDatalog on PyPI](https://pypi.org/pypi/pyDatalog/json),
[MongoDB's `$in`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/in/) and
[`$ifNull`](https://www.mongodb.com/docs/manual/reference/operator/aggregation/ifNull/), and
[Obsidian's Properties](https://obsidian.md/help/properties). They also used copies made on 2026-10-20 by the review of this
document of [Node 24's sqlite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html),
[MongoDB's find command](https://www.mongodb.com/docs/manual/reference/command/find/),
[Datomic's identity](https://docs.datomic.com/schema/identity.html),
[Dataview's sources](https://blacksmithgu.github.io/obsidian-dataview/reference/sources/) and
[functions](https://blacksmithgu.github.io/obsidian-dataview/reference/functions/), [SQLite's FTS5](https://sqlite.org/fts5.html),
[PRQL's loop](https://prql-lang.org/book/reference/stdlib/transforms/loop.html) and
[DuckDB-Wasm](https://duckdb.org/docs/current/clients/wasm/overview).

### SQL and pipelines

- https://sqlite.org/json1.html — JSON functions built in since 3.38.0; `->`/`->>`; `json_each` columns; path syntax.
- https://sqlite.org/lang_with.html — `WITH RECURSIVE`, `UNION` vs `UNION ALL` on cycles, restrictions.
- https://sqlite.org/fts5.html — FTS5 syntax, `snippet()`, `SQLITE_ENABLE_FTS5`, unicode61 case-independence.
- https://sqlite.org/lang_expr.html — parameter forms; LIKE's ASCII-only folding and wildcards; scalar subquery takes the first row.
- https://sqlite.org/datatype3.html — BINARY is memcmp; NOCASE folds only ASCII letters.
- https://sqlite.org/wasm/doc/trunk/index.md — SQLite's own Wasm build, OPFS persistence.
- https://duckdb.org/docs/current/guides/sql_features/graph_queries — duckpgq syntax; not in DuckDB 1.5.x, use 1.4.4.
- https://duckpgq.org/documentation/sql_pgq/ — quantifiers; ANY SHORTEST for path searches; no OPTIONAL MATCH.
- https://docs.oracle.com/en/database/oracle/property-graph/23.2/spgdg/sql-graph-queries.html — Oracle GRAPH_TABLE; bounded quantifiers, max 10.
- https://duckdb.org/docs/current/data/json/loading_json — read_json, read_ndjson, globs.
- https://duckdb.org/docs/current/clients/wasm/overview — DuckDB-Wasm, remote files, latest stable 1.5.6.
- https://duckdb.org/docs/current/clients/wasm/extensions — extensions in Wasm (json, fts; community subset).
- https://nodejs.org/api/sqlite.html — node:sqlite added v22.5.0; https://nodejs.org/docs/latest-v24.x/api/sqlite.html
  — a release candidate in Node 24 since v24.15.0.
- https://github.com/WiseLibs/better-sqlite3 and https://github.com/WiseLibs/better-sqlite3/blob/master/docs/compilation.md — MIT; FTS5 and JSON1 enabled; SQLite 3.53.4.
- https://github.com/sql-js/sql.js and https://raw.githubusercontent.com/sql-js/sql.js/master/Makefile — Wasm, in-memory, MIT; FTS3 not FTS5.
- https://docs.python.org/3/library/sqlite3.html — depends on the system SQLite; placeholders.
- https://registry.npmjs.org/ (packages @duckdb/duckdb-wasm, @duckdb/node-api, better-sqlite3, sql.js, prqlc, prql-js) and https://pypi.org/pypi/ (duckdb, prqlc, duckdb-kql) — versions, dates, licences.
- https://prql-lang.org/book/reference/stdlib/transforms/loop.html — loop, experimental, WITH RECURSIVE.
- https://prql-lang.org/book/reference/stdlib/transforms/join.html, .../group.html, .../sort.html — join, group, sort syntax.
- https://prql-lang.org/book/reference/syntax/parameters.html, .../s-strings.html, .../operators.html — `$id` parameters, s-strings, `??`.
- https://prql-lang.org/book/reference/stdlib/ — text functions.
- https://prql-lang.org/book/project/bindings/index.html — supported bindings.
- https://prql-lang.org/book/project/target.html — SQL dialect targets.
- https://learn.microsoft.com/en-us/kusto/query/graph-match-operator — graph-match syntax, bounded variable-length edges.
- https://learn.microsoft.com/en-us/kusto/query/make-graph-operator — make-graph syntax.
- https://learn.microsoft.com/en-us/kusto/query/mv-expand-operator — mv-expand.
- https://learn.microsoft.com/en-us/kusto/query/join-operator — join kinds, default innerunique.
- https://learn.microsoft.com/en-us/kusto/query/sort-operator — sort, default desc.
- https://learn.microsoft.com/en-us/kusto/query/has-operator — has, whole terms.
- https://learn.microsoft.com/en-us/kusto/query/query-parameters-statement — declare query_parameters.
- https://learn.microsoft.com/en-us/kusto/query/set-has-element-function — set_has_element.
- https://learn.microsoft.com/en-us/kusto/query/schema-entities/entity-names — identifier quoting, keywords, `$`.
- https://github.com/microsoft/Kusto-Query-Language — C# parser and semantic analyzer, Apache-2.0.
- https://learn.microsoft.com/en-us/azure/data-explorer/kusto-emulator-overview — Kusto emulator (from search summary, U).
- https://github.com/mmaitre314/duckdb-kql/blob/main/docs/kql-support.md and .../getting-started.md — KQL to DuckDB translator, its support matrix and parameters.
- https://bird-bench.github.io/ — BIRD human 92.96, top entry 82.95.

### GraphQL, MongoDB and Dataview

| URL | Supported |
|---|---|
| https://spec.graphql.org/ | editions; September 2025 is the latest release; working draft 2026-09-28 |
| https://spec.graphql.org/September2025/ | §2.1.8 Names, Reserved Names, §2.10 values with variables, §2.11 Variables, §3.11 List, §3.12 Non-Null, §5.5.2.2 fragment cycles |
| https://tina.io/docs/graphql/queries/advanced/filter-documents | Tina filter operators, AND only, reference filter example |
| https://tina.io/docs/graphql/queries/advanced/sorting | `sort:` ascending only; multi-field needs an index; descending via reverse pagination |
| https://tina.io/docs/graphql/queries/advanced/pagination | `first`/`after`, `last`/`before` |
| https://hasura.io/docs/2.0/queries/postgres/filters/index/ | `where`, nested relationship filter example |
| https://hasura.io/docs/2.0/queries/postgres/filters/comparison-operators/ and its .mdx source | `_neq`, `_in`, `_nin`, `_gte` |
| https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/filters/text-search-operators.mdx | `_ilike`, `_regex` |
| https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/filters/jsonb-operators.mdx | `_contains`, `_has_key` |
| https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/sorting.mdx | `order_by`, asc/desc, arrays |
| https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/pagination.mdx | `limit` |
| https://github.com/hasura/graphql-engine/blob/master/docs/docs/queries/postgres/aggregation-queries.mdx | `_aggregate`, `aggregate { count }`, `nodes`, no group-by on the page |
| https://registry.npmjs.org/graphql | graphql-js 17.0.2, MIT, 2026-07-03 |
| https://pypi.org/pypi/graphql-core/json | graphql-core 3.3.0, MIT, 2026-09-27 |
| https://www.mongodb.com/docs/manual/core/dot-dollar-considerations/ | `$`-prefixed and dotted field names: stored, not queryable directly, not indexable |
| https://www.mongodb.com/docs/manual/reference/operator/aggregation/getField/ | `$getField` with `$literal` |
| https://www.mongodb.com/docs/manual/reference/method/db.collection.find/ | find signature, projection, sort, limit |
| https://www.mongodb.com/docs/manual/tutorial/query-arrays/ (.md) | scalar matches an array element |
| https://www.mongodb.com/docs/manual/reference/operator/projection/elemMatch/ | `$elemMatch` projection returns the first match |
| https://www.mongodb.com/docs/manual/reference/operator/query/regex/ | `$regex`, `$options`, single-quoted `-q` in a shell |
| https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/ | `$lookup` forms, array localField |
| https://www.mongodb.com/docs/manual/reference/operator/aggregation/graphLookup/ | `$graphLookup` fields, unordered, memory limit |
| https://www.mongodb.com/docs/manual/reference/operator/aggregation/group/ | `$group`, `_id` key, unordered output |
| https://www.mongodb.com/docs/manual/reference/operator/aggregation/filter/ | `$filter` |
| https://github.com/kofrasa/mingo, https://github.com/kofrasa/mingo/tree/main/src/operators | mingo API, MIT, operator coverage |
| https://registry.npmjs.org/mingo | mingo 7.2.5, 2026-10-15 |
| https://pypi.org/pypi/mongomock/json, https://github.com/mongomock/mongomock/blob/develop/Missing_Features.rst | mongomock 4.3.0, ISC, testing mock, `$text` missing |
| https://pypi.org/pypi/mongita/json | mongita 1.2.0, BSD, 2023-04-03 |
| https://blacksmithgu.github.io/obsidian-dataview/reference/sources/ | FROM sources, `[[note]]`, `outgoing()`, and/or/! |
| https://blacksmithgu.github.io/obsidian-dataview/queries/query-types/ and query-types.md | query types, `key`, `length(rows)` |
| https://blacksmithgu.github.io/obsidian-dataview/queries/data-commands/ | WHERE, SORT, GROUP BY, FLATTEN, LIMIT, order of execution |
| https://blacksmithgu.github.io/obsidian-dataview/queries/structure/ | one FROM, right after the query type |
| https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-pages/ | implicit fields, no body text or sections |
| https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/annotation/metadata-tasks.md | list item `text` and `section` |
| https://blacksmithgu.github.io/obsidian-dataview/annotation/types-of-metadata/ | front matter links must be quoted `"[[Link]]"` |
| https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/reference/expressions.md | link indexing, `this.file.name`, string `+` |
| https://blacksmithgu.github.io/obsidian-dataview/reference/functions/ | functions |
| https://github.com/blacksmithgu/obsidian-dataview/blob/master/docs/docs/index.md | "cannot read everything in your vault" |
| https://github.com/blacksmithgu/obsidian-dataview, https://registry.npmjs.org/obsidian-dataview | MIT, npm typings only, 0.5.68 |
| https://hub.logseq.com/features/av5LyiLi5xS7EFQXy4h4K8/getting-started-with-advanced-queries/8xwSRJNVKFJhGSvJUxs5B2 | Logseq advanced queries in Datalog over Datascript (U: page failed to load, seen through a search summary) |

### Graph languages and Datalog

| URL | Supported |
|---|---|
| https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-patterns/ | quantified relationships, `+`, older syntax "not GQL conformant" |
| https://neo4j.com/docs/cypher-manual/current/patterns/reference/variable-length-paths/ | `+` = `{1,}`, `*` = `{0,}`, `-[*]->` = `-[]->+` |
| https://neo4j.com/docs/cypher-manual/current/clauses/optional-match/ | OPTIONAL MATCH semantics |
| https://neo4j.com/docs/cypher-manual/current/expressions/predicates/string-operators/ | CONTAINS case-sensitive, `=~`, `(?i)` |
| https://neo4j.com/docs/cypher-manual/current/expressions/predicates/list-operators/ | `IN` on a list |
| https://neo4j.com/docs/cypher-manual/current/clauses/unwind/ | UNWIND syntax |
| https://neo4j.com/docs/cypher-manual/current/functions/ | coalesce, toLower, substring, type, count, collect, size |
| https://neo4j.com/docs/cypher-manual/current/syntax/parameters/ | `$param`, not for labels, types, keys |
| https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/ | Cypher vs GQL: "minimal differences" |
| https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/supported-mandatory/ | ordered as in ISO/IEC 39075:2024 |
| https://neo4j.com/docs/cypher-manual/current/appendix/gql-conformance/analogous-cypher/ | GQL `FOR` vs Cypher `UNWIND` |
| https://docs.cloud.google.com/spanner/docs/reference/standard-sql/graph-query-statements | GQL FOR, FILTER, LET, NEXT, RETURN ... GROUP BY (secondary for GQL) |
| https://www.iso.org/standard/76120.html | ISO page for GQL; returned 403, not read |
| https://github.com/kuzudb/kuzu (GitHub API) | archived, v0.11.3 of 2025-10-10, MIT |
| https://github.com/LadybugDB/ladybug | embedded, Cypher, Wasm bindings, MIT, v0.21.2 |
| https://pypi.org/project/falkordblite/ and https://github.com/FalkorDB/FalkorDB/blob/master/LICENSE.txt | bundled Redis server; SSPL v1 |
| https://duckpgq.org/ | SQL/PGQ extension, research project |
| https://www.w3.org/TR/sparql11-query/ | property paths, VALUES, REGEX "i", CONTAINS, LCASE, SUBSTR, COUNT, GROUP_CONCAT; REC 2013-03-21 |
| https://comunica.dev/docs/query/advanced/context/ | `initialBindings` |
| https://github.com/comunica/comunica/blob/master/engines/query-sparql/README.md | `queryBindings`, SPARQL 1.2 Update mention |
| https://rdflib.readthedocs.io/en/stable/intro_to_sparql/ | `initBindings` |
| https://github.com/RDFLib/rdflib/issues/1772 | initBindings differs between stores |
| https://github.com/oxigraph/oxigraph/blob/main/js/README.md | `Store.query` options, no binding option |
| registry.npmjs.org, pypi.org (JSON APIs) | versions, dates, licences of kuzu, @ladybugdb/core, @comunica/query-sparql, oxigraph, datascript, rdflib, pyoxigraph, ladybug, pyDatalog, falkordblite |
| https://docs.datomic.com/query/query-data-reference.html | :find/:in/:where, rules, aggregates, not/or, predicates, get-else, missing?, find-scalar Peer only, no ordering |
| https://docs.datomic.com/schema/identity.html | lookup refs need a unique attribute |
| https://forum.datomic.com/t/recursive-query/1370 | recursive rules (secondary) |
| https://github.com/tonsky/datascript | JS API, rules, recursive rules, aggregates, no full-text, EPL |
| https://github.com/tonsky/datascript/blob/master/src/datascript/built_ins.cljc | built-in functions and aggregates |
| https://pydatalog.readthedocs.io/en/latest/ | pyDatalog: pure Python, LGPL, syntax |
| https://discuss.logseq.com/t/how-advanced-queries-work-step-by-step-explainer/30544 | Logseq advanced queries on DataScript (secondary) |
| https://docs.geldata.com/reference/edgeql/paths | EdgeQL backlinks `.<author[is BlogPost]` |
| https://www.geldata.com/p/sunset | Gel Data Inc. shutting down, open source stays |

### Path languages and jq

| URL | Supported |
|---|---|
| https://jqlang.org/manual/ | jq 1.8 builtins, SQL-style operators, options, regex flags, no stability or cycle statement |
| https://github.com/jqlang/jq | jq licence (MIT) |
| https://github.com/jqlang/jq/releases | latest releases 1.8.2, 1.8.1, 1.8.0 |
| https://github.com/01mf02/jaq | jaq: Rust, MIT, compatibility, playground |
| https://github.com/itchyny/gojq | gojq: Go, MIT, differences |
| https://registry.npmjs.org/jq-wasm, https://registry.npmjs.org/jq-web | versions, dates, licences of the Wasm builds |
| https://github.com/FGasper/jq-web | jq-web's async API (via search result, U) |
| https://pypi.org/project/jq/ | Python binding 1.13.0, BSD-2-Clause, jq 1.8.2, API |
| https://www.rfc-editor.org/rfc/rfc9535.html | JSONPath selectors, filters, functions, singular queries, Normalized Paths |
| https://github.com/jsonpath-standard/jsonpath-compliance-test-suite | the compliance suite |
| https://cburgmer.github.io/json-path-comparison/ | cross-implementation comparison |
| https://registry.npmjs.org/jsonpath-rfc9535, https://github.com/P0lip/jsonpath-rfc9535 | TS library, passes the suite |
| https://github.com/jg-rp/json-p3 | TS library, tests against the suite |
| https://registry.npmjs.org/@jsonpath-tools/jsonpath, /json-p3, /jsonpath, /jsonpath-plus | versions and dates |
| https://github.com/jg-rp/python-jsonpath-rfc9535, https://pypi.org/pypi/jsonpath-rfc9535/json, https://pypi.org/pypi/python-jsonpath/json | Python JSONPath libraries |
| https://jmespath.org/specification.html | JMESPath syntax, functions, quoting, absences |
| https://github.com/jmespath-community/jmespath.spec/blob/main/jep-011a-lexical-scope.md | `let`, JEP 11a, accepted |
| https://github.com/jmespath-community/typescript-jmespath, https://registry.npmjs.org/@jmespath-community/jmespath, https://registry.npmjs.org/jmespath, https://pypi.org/pypi/jmespath/json | JMESPath libraries |
| https://www.w3.org/TR/xquery-31/ | XQuery 3.1 status, axes, XPTY0020, lookup, map constructor, group by |
| https://www.w3.org/TR/xpath-functions-31/ | json-doc and parse-json exist (§17.5) |
| https://github.com/FontoXML/fontoxpath, https://registry.npmjs.org/fontoxpath | fontoxpath coverage, version |
| https://www.saxonica.com/saxonjs/index.xml | SaxonJS licence, XPath 3.1, versions |
| https://pypi.org/pypi/elementpath/json, https://pypi.org/project/saxonche/ | Python XPath and XQuery engines |
| https://www.w3.org/TR/selectors-4/ | CSS Selectors Level 4 |
| https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests | GitHub AND, OR, parentheses (five levels) |
| https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax | GitHub comparisons, ranges, NOT |
| https://lucene.apache.org/core/10_3_0/queryparser/org/apache/lucene/queryparser/classic/package-summary.html | Lucene classic syntax |
