# vampiredb demonstrations

Three runs over the `docs/` of a vampiredb checkout, which none modifies: the I1 demonstration of reading, the I2 trial of
checking, and the I2 demonstration, which compares that check with vampiredb's own checker. The three scripts share
[`shared.mjs`](shared.mjs): running the built `vmd`, the digest of a directory tree, the guard on the temporary directory, and
the timing statistics.

## The I1 demonstration (I1.11)

The demonstration of phase I1 ([implementation plan](../../docs/plan/implementation-plan.md), task I1.11, issue
[#20](https://github.com/nosferatech/vollmond/issues/20)): `vmd outline` and `vmd get` over the store whose root is the `docs/`
directory of a vampiredb checkout. The store is read with this directory's [`config.yaml`](config.yaml) through `--config`, so
vampiredb is not modified (decision K3). Since I2.7 the configuration declares one collection, `documents`, with its schema in `schema/` beside it
(decision U13, a `--config` file's schemas are in the `schema/` directory beside it); see [the trial](#the-vampiredb-trial-i27)
below. A schema violation does not make a record unreadable, so this demonstration reads the store as before.

```sh
cd js && npm ci && npm run build && cd ..
node examples/vampiredb/demo.mjs ~/vampiredb            # every get through the CLI's runCli, 2 to 4 minutes
node examples/vampiredb/demo.mjs ~/vampiredb --fast     # every get through openStore, a few seconds
```

[`demo.mjs`](demo.mjs) lists the store with `vmd ls` and outlines every record with `vmd outline`, each in a fresh process. It
then runs `vmd get` on every section's canonical address, every block anchor's canonical address, and `#NAME` for every
explicit, derived and block anchor, and checks that each one resolves, as a singular address, to the node or block it came
from. Those expectations come from vmd's own parse, so that check compares vmd with itself.

A second check compares vmd with the files, through a line scan that does not use vmd:

- The headings and the `<a id=` elements must be as many as vmd finds.
- `#ID` of each heading's element must give the section at that heading's line, with the heading's text as its title.
- `#SLUG` must do the same, where SLUG is the demo's own reading of §6.3. It skips headings with markup it does not read.
- `#ID` of every other element must give a block that starts with the element (after any list marker), at the element's line,
  whose text is in the file. The one exception is an element vmd reports as anchoring nothing: there `get` must find nothing.

It also times `vmd outline design/Minimal_Log.md` and checks that the store is unchanged. It exits with 1 when a check fails. Its
header comment lists the steps. Since I2.8 the digest is `shared.mjs`'s, which covers every entry under the store root: a
directory or a symbolic link created, removed or changed fails the check, where the digest of the runs below covered files
only.

### Result

Run on 2026-10-11 against the vampiredb checkout at `~/vampiredb`, with Node 24.21.0 on macOS:

| | |
|---|---|
| documents | 37 Markdown records, all readable |
| sections | 680, every one with a heading; a line scan counts 680 ATX headings |
| anchors | 157 explicit, 680 derived, 282 block; a line scan counts 439 `<a id=` elements, which are the 157 and the 282: every element anchors a heading or a block |
| `get`, against vmd's parse | 2,081 checks over 1,398 distinct addresses: all 1,398 resolve, each to the node or block it came from |
| `get`, against the files | all 157 heading anchors and all 282 block anchors; 639 derived anchors by the demo's slug, with 41 headings skipped for markup |
| failures | none |
| full run | 3 minutes under load from other work; about 2 minutes on an idle machine, measured before the checks against the files were added |
| store | unchanged (a digest of its files before and after), and no `.vmd/` created |

These numbers are from the run after Draft v0.11's follow-ups (decisions P to R and T). The first run, at the end of I1.11, read
an earlier state of the docs: 677 sections, 438 elements, 264 block anchors.

**Anchor elements in a list item's later paragraphs.** `design/Minimal_Log.md` has `<a id>` elements at the start of a list
item's second or later paragraph, such as `#named-segment-past-prefix-dropped`: 17 at the first run, 18 now. §6.2 of the
proposal then made an anchor element a block anchor only at the start of a list item or of a top-level paragraph of a `$body`,
so vmd raised `anchor-element-ignored` for each one (a warning), and `vmd get` found none of them, though twelve were the target
of links, 40 links in all, which GitHub follows; in today's docs, 13 are the target of 44 links. Decision T (Draft v0.11) widened
§6.2 to any paragraph outside block quotes, so they are block anchors now and every one resolves, the 13 linked ones included: the
build before that change, run on today's docs, gives 264 block anchors and 18 ignored elements, and the build after it 282 and
none.

**The checks fail when they should.** Each check against the files was made to fail once:

- on a copy of the docs, a setext heading fails the heading count, and an ignored element named like a heading fails the
  ignored-element check;
- with a bug planted in vmd and rebuilt:
  - slugs left in upper case fail 622 derived anchors;
  - explicit anchors moved to the parent section fail all 157 heading anchors;
  - block ranges shifted by a byte fail all 264 blocks;
  - block anchors dropped silently fail 28 blocks, and the count.

The check against vmd's parse misses the slug, range and dropped-block bugs.

**Failures by class.** vmd bugs: none. Problems in vampiredb's documents, such as duplicate anchors: none. Questions for the
specification, at the first run, both since decided: the elements above (decision T), and a block anchor's canonical address
when its name is not singular. §7.5 defined the canonical address of nodes only. For a block whose name is not singular, `core` gives the address of the `$body` that holds it.
vampiredb has no such block, but a copy of its docs with a planted duplicate, run through `demo.mjs`, shows the case. Decision R2
(Draft v0.11) makes that address the `$body`'s plus the block's range, and §7.5 now says so.

### Timing

`vmd outline design/Minimal_Log.md` (672,719 bytes, 49 sections, 240 block anchors), ten runs each:

| | min | median | max |
|---|---|---|---|
| cold: the built `vmd` in a fresh process, wall clock, with the operating system's file cache warm | 333 ms | 339 ms | 412 ms |
| warm: `runCli` again in the same process, which opens the store and parses the record again | 196 ms | 201 ms | 242 ms |

That is well under the plan's second. Where a cold run's time goes, measured stage by stage in fresh processes on an idle machine:

- Node starting: about 20 ms.
- Importing the CLI: about 40 ms.
- The Markdown library's parse with the four GFM 0.29 extensions: about 238 ms.
- vmd's own walk over the library's tree: about 12 ms (`parseRecord` takes 250 ms in all).
- The canonical addresses of the 49 sections: under 1 ms.
- The rest of the command (store, configuration, output): about 15 ms.

On the same machine under a load average of 10 to 15, the cold run took 0.70 to 0.79 s.

After Draft v0.11's follow-ups, whose resource limits of §5.4 are counted as the library parses, the file is 691,644 bytes, and
the fast run measured a cold median of 352 ms and a warm median of 223 ms. `parseRecord` on the file takes the same before and
after the follow-ups, a median of about 210 ms over 15 runs in one process.

`vmd ls` reads every record on the page it prints to count the unreadable ones (decision K10): 1.1 s for these 37 records, cold.
The index of I2.5 (#25) is what makes it cheaper.

## The vampiredb trial (I2.7)

The trial of phase I2 ([implementation plan](../../docs/plan/implementation-plan.md), task I2.7, issue
[#27](https://github.com/nosferatech/vollmond/issues/27)): `vmd check` over the same store, with a collection and a schema that
say what vampiredb's own checker, `scripts/docs.sh`, checks of a document's form. The comparison with `docs.sh` itself is
I2.8's ([#28](https://github.com/nosferatech/vollmond/issues/28)).

```sh
cd js && npm ci && npm run build && cd ..
node examples/vampiredb/check.mjs ~/vampiredb
```

[`check.mjs`](check.mjs) runs `vmd --json check --all` twice in fresh processes, cold and then warm, with the local index in a
temporary cache directory of its own, so that the user's cache is not used; it refuses to start when the system's temporary
directory is inside the checkout. It prints every issue and the counts per code. It then checks that the store is unchanged, by
a digest before and after of every entry under its root (files, directories and symbolic links), and that no `.vmd/` was
created. It exits with 1 when vmd fails (printing vmd's stderr), when the configuration or the schema cannot be used, when the
warm run disagrees with the cold one or does not read every record from the index, or when the store changed. Otherwise it
exits with 0, whatever the documents' issues are, since those are the trial's result.
[`vampiredb-trial.test.ts`](../../js/packages/cli/src/command/vampiredb-trial.test.ts) runs this configuration in CI over a
small made-up store in the same shape: each rule fires once, and its near miss passes.

### The configuration

[`config.yaml`](config.yaml) declares one collection, `documents`: every Markdown file under `design/`, `draft/` and
`guidelines/` at any depth, except a `README.md`. That is `docs.sh`'s `find docs/design docs/draft docs/guidelines -name '*.md'
! -name README.md`, 39 documents today. The other 7 records (`ARCHITECTURE.md`, `TODO.md` and the like) are in no collection,
and only their references are checked.

Its schema, [`schema/anchored-document.schema.yaml`](schema/anchored-document.schema.yaml), checks what `docs.sh` checks of a
document's form, as far as a schema of the value view can say it:

- **The header table**, which opens each document, is prose in the root's `$body`, so its rows are read as text. A row is
  `| **Name** | ` at the start of a line, then the keyword, optionally in backticks, then ` — ` and prose or the end of the row,
  as `docs.sh` reads it:
  - Type is one of Design, Investigation, Analysis, Report, Convention, Guideline and Record;
  - Status is one of Draft, Accepted, Implemented and Deprecated;
  - Implemented is only for a Design;
  - a Design, Investigation, Analysis or Report names a Component;
  - no document names more than ten Components;
  - a Convention, Guideline or Record has a Scope.
- **A numbered heading carries an anchor** (`## 4. Writing <a id="writing"></a>`), at every level: a heading numbered `4.`,
  `4.6 ` or `A.3 `, or an `Appendix` heading. As in `docs.sh`, the rule applies only to a document that has an anchor somewhere,
  either an explicit anchor on a heading or an anchor element in a section's text. Only 8 of the 39 documents have one; in the
  31 others, `docs.sh` reads links as plain Markdown, and 17 of them have numbered headings without anchors. `docs.sh` applies
  the rule to every tracked Markdown file with an anchor, not only to these 39 documents (below).
- **Each level of sections is a keyed list** (`x-vmd-list`, `type: map`, keyed by `@key`), so that two sibling sections with
  the same key are an error. Uniqueness is strict by default anyway (§5.7); the declaration makes it a schema violation, which
  the strict read mode refuses (§9.5).

**Where it differs from `docs.sh`.** The review of the trial planted each of these cases in a copy of the docs and ran
both tools on it. None of the cases occurs in today's docs.

- *Which files the heading rule covers.* `docs.sh` applies it to every tracked `.md` file of the repository that has an anchor,
  `TODO.md` and the READMEs included. The schema applies it only to the collection's documents, so a numbered heading without
  an anchor in an anchored `TODO.md` is reported by `docs.sh` alone.
- *The header's place.* `docs.sh` reads the header only in a file's first 12 lines, and the schema reads the root's whole
  `$body`, the text before the first `##`. A Type row further down passes here and fails there.
- *The first row only.* `docs.sh` reads only the first row of each name. With two Type rows, the first unknown and the second
  valid, `docs.sh` fails and the schema passes.
- *A keyword with a bare em dash.* `| **Status** | Accepted — |` fails in `docs.sh`, which splits the keyword at ` — ` with a
  space after it. The schema passes it.
- *An empty Scope cell.* `| **Scope** | |` passes in `docs.sh`, which reads the cell as `|`. The schema refuses it.
- *Component slugs.* `docs.sh` checks each slug against `docs/components.md`; the schema only asks for a lowercase letter or
  digit first, so an unknown slug passes it. Its limit of ten Components is in the schema too, counted as `docs.sh` counts
  them: slugs before the ` — `, empty ones not counted.
- *Line endings.* A document with CRLF line endings fails `docs.sh`'s header check, whose rows then end in a carriage return.
  The schema passes the same document.
- *Headings `docs.sh`'s pattern skips.* `docs.sh` reads `## ` followed by a number at the very start of a line. vmd reads
  every ATX heading, so `##  99. Fake` (two spaces) and ` ## 99. Fake` (indented) need an anchor here and not there.
- *`~~~` fences.* `docs.sh` knows only fences of backticks, so a numbered heading inside a `~~~` fence needs an anchor for it.
  vmd reads the fence as code.
- *Code.* An `<a id="` inside code in a section's text, a code span or a fenced block, counts as an anchor for the heading
  rule here, while `docs.sh` masks code.
- *The heading pattern's edges.* A heading that is a number alone (`## 3`) is numbered for `docs.sh` and not here, and
  `## Appendix A: Notes` is numbered here and not for `docs.sh`.
- *Anchor elements, by vmd's own rules (§6.2).* An `<a id="x">X</a>` with content is a structural error in vmd
  (`anchor-element-invalid`), which `docs.sh` does not look at. An `<a id>` in the middle of a paragraph anchors nothing in vmd
  (the warning `anchor-element-ignored`), while `docs.sh` counts it, so a duplicate id there is an error in `docs.sh` alone.
- *Everything else `docs.sh` checks*: links, shown numbers and labels, ticket citations, file names and the Decision Log's rows.
  I2.8 compares those.

**A departure from the I2 design as first written.** The design ([`i2-validate.md`](../../docs/design/i2-validate.md), section
8.2) applied the heading rule to every document, and said it would narrow `match` should a document have numbered headings and
no anchor. 17 do, and narrowing `match` would also have dropped the header check from the 31 documents without anchors, so the
rule became conditional in the schema instead. Its header patterns were looser than `docs.sh`'s reading, and the three rules
between rows were left out. #27 records the change, and section 8.2 now describes what is here.

### Result

Run on 2026-10-20 against the vampiredb checkout at `~/vampiredb` (`0588e29f`), with Node 24.21.0 on macOS:

| | |
|---|---|
| records | 46 Markdown records, all readable; 39 in the collection |
| references | 2,073, none dangling |
| issues | 1 error, 2 warnings, below; vmd exits with 4 |
| time | cold 1.7 s (no index yet), warm 0.2 s (all 46 records from the index) |
| store | unchanged (a digest of its files before and after), and no `.vmd/` created |
| `docs.sh` on the same checkout | "39 documents, all conforming; 451 anchors and 2290 references to them checked" |

The issues:

- **`draft/Measured_Mutex_And_Span_Histograms.md:1:1`, error `schema-violation`**, with the warning `multiple-h1` at line 70. The
  document has four level-1 headings: its title, and `# Part 1`, `# Part 2` and `# Decisions for the owner`. vmd then reads no
  title (§5.2), so the record has no `$title` and no root `$body`, and the schema cannot see its header. `docs.sh` does not look
  at level-1 headings. The schema keeps `$title` and `$body` required, so `vmd check` exits with 4 until vampiredb changes the
  document, for example by moving its parts one level down. Not requiring them would leave the document unchecked.
- **`ARCHITECTURE.md:202:16`, warning `ref-derived-anchor`**: a link to `guidelines/Working_Practices.md#what-the-merge-queue-runs`
  reaches its heading through the title-derived name, so the link breaks when the heading is retitled. `docs.sh` skips it,
  since `Working_Practices.md` has no anchors.

**Findings for vampiredb's project owner**, none of them a `docs.sh` failure: the two documents above, and `docs/README.md`'s
"Citing a document", which names 5 documents whose numbered headings carry anchors, while 8 do (`Lock_Ranks.md`,
`Replication.md` and `Performance_Profiling.md` are not in its list). **vmd bugs: none found.** A line scan with `docs.sh`'s own
heading pattern, applied to all 39 documents as if each had anchors, finds the same 348 headings without an anchor that the
first draft of the schema reported, line for line. Editing a schema file in place changed the cached results, as it should.

**The checks fail when they should.** Each rule of the schema and each part of the configuration was broken once, 23
mutations in all, and the test failed each time:

- the heading rule made unconditional;
- each of the three ways the schema finds an anchor;
- the rule's recursion into lower levels;
- the `Appendix` and the `A.n` patterns;
- the Type pattern as first drafted, with `\b`, and without its start-of-line anchor;
- a Type keyword and a Status keyword removed;
- the Status row's end loosened to accept a further cell;
- the Implemented, Component and Scope rules;
- Report dropped from the Component rule, and Record from the Scope rule;
- the ten-Component limit removed, set one lower, and counting the commas of the prose after ` — `;
- `required: [$title, $body]`;
- the recursive globs;
- the README exclusion.

Each guard of `check.mjs` fired once, on copies of the docs:

| fault | result |
|---|---|
| an unknown `x-vmd-` keyword planted in the schema | `feature-unsupported` and exit 1 |
| a directory created in the store during the run | exit 1 |
| a symbolic link created in the store during the run | exit 1 |
| a warm run given an empty cache | exit 1 |
| vmd's entry point missing | its stderr printed, and exit 1 |
| a checkout without `docs/` | exit 2 |
| a temporary directory inside the checkout | exit 2 |

The near miss passes: a temporary directory beside the checkout whose name starts with the checkout's. An issue without a
position prints as its path alone.

## The I2 demonstration (I2.8)

The demonstration of phase I2 ([implementation plan](../../docs/plan/implementation-plan.md), task I2.8, issue
[#28](https://github.com/nosferatech/vollmond/issues/28)): `vmd check` with the trial's configuration, compared with
vampiredb's own checker, `scripts/docs.sh`, so that "every broken link `docs.sh` reports inside `docs/`, `vmd` reports too" is
a check rather than a claim, and each difference has a stated reason.

```sh
cd js && npm ci && npm run build && cd ..
node examples/vampiredb/check-demo.mjs ~/vampiredb    # 3 to 4 minutes; --runs N sets the timing runs (10)
```

[`check-demo.mjs`](check-demo.mjs) runs `docs.sh` in its check mode, the one that writes nothing but its temporary files, and
`vmd check --all`, both on the checkout. Since `docs.sh` reports nothing there, it then makes a copy in a temporary directory:
the files `docs.sh` reads, which are the files git lists as tracked or untracked and not ignored, plus all of `docs/`. The copy
is a git repository of its own whose index holds exactly those files. Both tools must report on the copy what they report on the
checkout. The script then plants each fault below in the copy on its own, runs both tools, and compares what each reports beyond
the unmodified copy with what the fault declares. It puts the files back after each fault.

For every fault it also matches the two tools' link problems, in both directions:

- each link problem `docs.sh` reports in a file under `docs/` must be a vmd `ref-dangling` or `ref-ambiguous` in the same file,
  whose target resolves to the same path (and the same fragment), for a link that starts on the line `docs.sh` gives. vmd
  reports the position of a link's destination, so the script finds where that link starts by walking back from its `](` to
  the `[` that balances it, in the file's bytes. Otherwise the problem must fall in a class that says why vmd does not report
  it;
- each broken reference vmd reports must be a `docs.sh` problem in the same way, or fall in a class that says why `docs.sh`
  does not report it.

A problem in no class fails the run, unless the fault that plants it declares it: faults 15 and 16 plant links that only one
tool reads as links, which no class explains. The script then times the check over the unmodified store, cold and warm, and
fails when the warm median is not under the phase's budget of two seconds. Last, it checks that nothing changed:

- by digests before and after of the store; of every file `docs.sh` reads in the checkout, with HEAD, `git status` and the stat
  of the git index (git runs without optional locks, so that it does not rewrite the index); and of the ticket directory
  `docs.sh` reads (`~/eternal-circle/tickets`);
- and by `find -newer` over the whole checkout, `.git/`, ignored and untracked files included, and over the ticket directory,
  against a marker file made before the first digest: no entry may have been modified during the run.

It removes its temporary directories, and refuses to start when they would be inside the checkout. Its header comment lists the
steps.

### Result

Run on 2026-10-20 against the vampiredb checkout at `~/vampiredb` (`0588e29f`), with Node 24.21.0 on macOS:

| | |
|---|---|
| `docs.sh` on the checkout | exit 0: "39 documents, all conforming; 451 anchors and 2290 references to them checked" |
| `vmd check` on the store | exit 4: 46 records, 2,073 references; the 1 error and 2 warnings of the trial (above) |
| anchors | `docs.sh`'s 451 are vmd's 167 explicit anchors and 284 block anchors (`demo.mjs --fast`) |
| the copy | faithful: both tools report there what they report on the checkout |
| faults | 20, each as declared |
| links matched | all 2,298 link problems `docs.sh` reported inside `docs/` are in the classes below, but for the 2 that faults 15 and 16 declare |
| time, 10 runs each in fresh processes | load average about 3: cold, with no index: min 1,676 ms, median 1,687 ms, max 1,712 ms; warm, from the index: min 192 ms, median 194 ms, max 198 ms, which is 1,806 ms under the budget |
| an earlier run, under a load average of 7 rising to 40 | cold: median 3,018 ms (2,305 to 4,403); warm: median 497 ms (430 to 561), 1,503 ms under the budget |
| unchanged | the store, the 1,560 files `docs.sh` reads in the checkout, HEAD, `git status` and the git index, and the ticket directory; `find -newer` finds no entry of the checkout or the ticket directory modified during the run |

**The faults.** Each was planted on its own. "Nothing" means that the tool reported nothing beyond the unmodified copy.

| fault | `docs.sh` | `vmd check` |
|---|---|---|
| 1. `<a id="component-tables">` of `design/Lock_Ranks.md` renamed | 11 "finds no anchor": 9 links in `docs/`, 2 code comments in `.rs` files | 9 `ref-dangling`, the same 9 links |
| 2. the heading `### 1.1 … <a id="what-check-cannot-see">` deleted | 5 "finds no anchor" | 5 `ref-dangling`, the same links |
| 3a. a link to a missing file, with `#` | "which is not a file" | `ref-dangling` |
| 3b. a link to a missing file, without `#` | nothing | `ref-dangling` |
| 4. `<a id="api"></a>` repeated on a new paragraph | "duplicate anchor id"; the first element wins, so the links to `#api` pass | `duplicate-anchor`, and `ref-ambiguous` on each of the 6 links to `#api` |
| 5. `## 12. A planted heading` without an anchor | "has no anchor" | `schema-violation` |
| 6. a reference link whose definition names a missing anchor | nothing | `ref-dangling` at the definition |
| 7. `[§5.4](#no-cycle)` shown as `[§5.3]` | "shows §5.3 but anchor … is now §5.4" | nothing |
| 8. a link to a missing id in `guidelines/Working_Practices.md`, which has no anchors | nothing | `ref-dangling` |
| 9a. `[…](../NO_SUCH_FILE.md#overview)` from `docs/` | "which is not a file" | nothing: the link leaves the store |
| 9b. `[…](../README.md#no-such-section)` from `docs/` | nothing: the root `README.md` has no anchors | nothing: the link leaves the store |
| 10. a Type `Guidline` | "unrecognised type" | `schema-violation` |
| 11. a Component `planted-slug` | "is not defined in docs/components.md" | nothing |
| 12. "ticket 0158" | "a ticket is cited by its id alone" | nothing |
| 13a. a document `design/Planted Name.md` | "a file name under docs/ uses only …" | `path-invalid` |
| 13b. a document `design/_Planted.md` | nothing | `path-invalid` |
| 14. every `<a id="…"></a>` in every Markdown file renamed | 2,290 "finds no anchor": every reference it checks | 2,001 `ref-dangling`, 7 `ref-derived-anchor` |
| 15. `[hidden](#planted-missing)` inside a `<details>` block, then `[a [nested] link](#planted-missing)` three lines later | the first: "finds no anchor"; its pattern cannot read the second | the second: `ref-dangling`; the first is HTML |
| 16. `[…](#planted-in-tilde)` inside a fence of tildes | "finds no anchor": it knows only fences of backticks | nothing: the block is code |
| 17. on one line, `[…](../Gone.md#overview)` and `[…](design/Gone.md)` | the first: "which is not a file" | the second: `ref-dangling` |

Faults 15 to 17 come from the review of the first version of the script, which paired fault 15's two links as one link whose
text spans lines, and would have paired fault 17's by their file name. Each is now two disagreements: fault 15's are in no class,
as it declares, and fault 17's are "the target leaves the store" and "no `#`".

**The match, over all faults.** The 2,298 link problems `docs.sh` reported inside `docs/`:

| class | problems |
|---|---|
| vmd reports the same link, on the same line | 2,001 |
| vmd reports the same link at its destination, on a later line: the link's text spans lines, and `docs.sh` gives the line of its `[` | 15 |
| vmd resolves it through the heading's derived name, with the warning `ref-derived-anchor`: in fault 14, 7 links whose id was also the heading's slug | 7 |
| the target leaves the store (faults 9a and 17) | 2 |
| a code reference in a fenced block, `` `docs/design/X.md#id` (§N) ``, which `docs.sh` reads as it reads `.rs` comments, and vmd reads as code (fault 14) | 271 |
| in no class: a link only `docs.sh` reads as one, inside an HTML block (15) or a fence of tildes (16), as the faults declare | 2 |

`docs.sh` also reported 13 problems in files outside `docs/`, which are outside the store: fault 1's two `.rs` comments, and
fault 14's 11 code-comment references, 10 in `.rs` files and 1 in a `Cargo.toml`. The broken references vmd reported that
`docs.sh` does not are links without `#` (3b, 17), a link definition (6), a link into a document without anchors (8), the 6
links to the duplicated id (4), and, in no class as fault 15 declares, a link with brackets in its text, which `docs.sh`'s
pattern cannot read.

**vmd bugs: none found.** Every difference is one of the documented differences of the I2 design (section 8.3), whose table
this demonstration changed in five places: `docs.sh` does check links from `docs/` that leave it, it reads code references in
fenced blocks, the two tools give different lines for a link whose text spans lines, vmd reports every link to a duplicated id,
and some links only one of the tools reads as links.

**The checks fail when they should.** Each guard of `check-demo.mjs` fired once, on a scratch checkout built from vampiredb's
files, or with the script mutated in a scratch copy; vampiredb was never the target:

| fault | result |
|---|---|
| no CHECKOUT; a checkout without `docs/`; one without `scripts/docs.sh`; the temporary directory inside the checkout; vmd not built; `python3` not on the path | exit 2 |
| `docs.sh` exits with 2 (a `TICKETS_DIR` that does not exist) | exit 1 |
| vmd fails to run the check | exit 1 |
| the copy made unfaithful (a broken link added to it) | exit 1 |
| a fault's text to replace not found | exit 1 |
| a fault's declared count one off | exit 1 |
| the class "leaves the store" removed (fault 9a), the class of fenced code references removed (fault 14), the class "no `#`" removed (fault 3b) | exit 1, each |
| the check that the link starts on `docs.sh`'s line removed (fault 15); targets compared by file name only (fault 17) | exit 1, each |
| a fault that removes one of the unmodified copy's issues | exit 1 |
| a fault not taken out of the copy | exit 1 |
| a cold run given a filled cache; a warm run given an empty one | exit 1, each |
| a budget of 100 ms | exit 1 |
| the store, a file of the checkout outside `docs/`, or the ticket directory changed during the run; a `.vmd/` created in the store | exit 1, each |
| an ignored file written in the checkout during the run, which no digest covers | exit 1, from `find -newer` alone |
| the checkout's git index touched during the run | exit 1 |

The near misses pass: the run on the scratch checkout, and a temporary directory beside the checkout whose name starts with
the checkout's. `check.mjs` and `demo.mjs --fast` give the same results as before they moved to `shared.mjs`.

**`demo.mjs` and the cache.** Since I2.8 `demo.mjs` keeps the local index in a temporary cache directory of its own, as
`check.mjs` does, for its fresh processes and for the commands it runs in its own process, and refuses to start when the
temporary directory is inside the checkout. Before, its commands used the user's cache: the review of I2.8 saw one `--fast`
run write 87 files there. Its timings of `outline` run with `--no-cache`, so that each run parses the record, as the I1
timings above did; before, the cold runs came after the index was filled. A `--fast` run with `XDG_CACHE_HOME` pointing at an
empty directory leaves that directory empty, with 0 failures.
