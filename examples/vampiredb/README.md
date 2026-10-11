# vampiredb demonstration (I1.11)

The demonstration of phase I1 ([implementation plan](../../docs/plan/implementation-plan.md), task I1.11, issue
[#20](https://github.com/nosferatech/vollmond/issues/20)): `vmd outline` and `vmd get` over the store whose root is the `docs/`
directory of a vampiredb checkout. The store is read with this directory's [`config.yaml`](config.yaml) through `--config`, so
vampiredb is not modified (decision K3). The configuration holds only `vmd: 1`, so the store has no collections and nothing
ignored beyond dotfiles; its schemas, when I2.7 adds them, go in `schema/` beside it (decision U13).

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

It also times `vmd outline design/Minimal_Log.md` and checks that the store's files are unchanged. It exits with 1 when a check
fails. Its header comment lists the steps.

## Result

Run on 2026-10-11 against the vampiredb checkout at `~/vampiredb`, with Node 24.21.0 on macOS:

| | |
|---|---|
| documents | 37 Markdown records, all readable |
| sections | 677, every one with a heading; a line scan counts 677 ATX headings |
| anchors | 157 explicit, 677 derived, 264 block; a line scan counts 438 `<a id=` elements, which are the 157 and the 264 plus 17 that anchor nothing (below) |
| `get`, against vmd's parse | 2,039 checks over 1,377 distinct addresses: all 1,377 resolve, each to the node or block it came from |
| `get`, against the files | all 157 heading anchors and all 264 block anchors; 636 derived anchors by the demo's slug, with 41 headings skipped for markup; the 17 ignored elements are not found |
| failures | none |
| full run | 3.5 minutes under a load average of 15; about 2 minutes on an idle machine, measured before the checks against the files were added |
| store | unchanged (a digest of its files before and after), and no `.vmd/` created |

**Anchor elements that anchor nothing.** `design/Minimal_Log.md` has 17 `<a id>` elements at the start of a list item's second
or later paragraph, such as `#named-segment-past-prefix-dropped` at line 1319. §6.2 of the proposal makes an anchor element a
block anchor only at the start of a list item or of a top-level paragraph of a `$body`, so vmd raises `anchor-element-ignored`
for each one (a warning), and `vmd get` finds none of them. Twelve of them are the target of links, 40 links in all, which GitHub
follows. Whether the documents should move these anchors or §6.2 should accept them was for the project owner to decide; this
demonstration did not. Decision T (Draft v0.11) widened §6.2 to accept them, and the numbers here stand until the anchor code
follows it.

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
specification: the 17 elements above, and a block anchor's canonical address when its name is not singular. §7.5 defines the
canonical address of nodes only. For a block whose name is not singular, `core` gives the address of the `$body` that holds it.
vampiredb has no such block, but a copy of its docs with a planted duplicate, run through `demo.mjs`, shows the case. Decision R2
(Draft v0.11) makes that address the `$body`'s plus the block's range, and §7.5 now says so.

## Timing

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

`vmd ls` reads every record on the page it prints to count the unreadable ones (decision K10): 1.1 s for these 37 records, cold.
The index of I2.5 (#25) is what makes it cheaper.
