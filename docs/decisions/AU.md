---
id: AU
title: "A many-valued reference that a record alias leads to no match is `ok` with no targets, as for an old section name"
round: "AU"
date: "2026-10-20"
status: accepted
supersedes: [W9.md]
sections: ["§8.2", "§8.5", "§13.6", "Appendix D"]
decided_by: owner
sources:
  card: "AU"
  design: ["docs/design/i2-validate.md, section 11, reading R19"]
  prs: [149, 155, 157]
---

## Question

A follow-up to [W9](W9.md). The card: "Its item 6 settled the case of an old section name: a many-valued link `#setup/nothing`,
where `setup` was renamed and nothing called `nothing` exists below it, is `ok` with no targets, because a single link there is
`dangling`."

"The same reading in the I2 design also covers a moved record (a record alias, `a.md` → `b.md`), and there the code does the
opposite: a many-valued link `a.md#nothing` into the moved record, where `b.md` has no `nothing`, is `aliased` with no targets. A
single link there is `dangling`. The independent review of Draft v0.17 found that this half wasn't on the W9 card." That reading
is R19 of the I2 design; Draft v0.17 (#155) stated the code's behaviour and labelled it in W9's record.

The card's example: "a schema field `related` with `cardinality: many`; `related: "a.md#nothing"`; `a.md` was moved to `b.md`,
which has no `nothing`."

## Options

- **(b) `ok` with no targets, as for an old section name.** Chosen, as recommended. The card: "One rule for both kinds of alias: a
  many-valued link mirrors what a single one would be (`dangling` becomes empty). The link no longer says the record moved, so
  `vmd check` gives no hint to update it. A small code change and its tests."
- **(a) `aliased` with no targets, as now.** The card: "No code change. The link says the record moved, a useful hint to update
  it, but the two kinds of alias then differ for the same empty result."

## Decision

(b): a reference declared `cardinality: many` that a record alias leads to a record where its fragment matches nothing is `ok`,
with no targets, as one that an anchor alias leads to no match is; where its fragment matches there, it is `aliased`. It gets no
`ref-aliased`, and `vmd check --fix` has nothing to rewrite.

This decides W9's labelled reading of R19's record-alias half, which Draft v0.17 stated as `aliased` with no targets, the other
way. W9 confirmed the rest of R19, and its other readings; AU changes what W9's record states, so it supersedes W9 as far as that
reading went, and W9's confirmations stand.

**Context from the engineering manager.** The engineering manager's notes for this draft name a consequence for the owner: once
`vmd alias prune` removes the record alias, such a reference goes from a silent `ok` to `ref-dangling`, with no warning before.
Draft v0.18 states it in §8.5.

## Why

The card's reason: "It keeps one rule (a many-valued link is what a single one would be, with `dangling` read as empty) instead of
two that differ only by the kind of alias; the record's move is still visible on the other links into it."

Why (a) lost: the card's reason above; its consequence for (a) is that the two kinds of alias then differ for the same empty
result.

## Owner's note

The project owner chose (b) on the review desk on 2026-10-20, with no note.

## Applied in

#157 (`0f54783`): the code, the I2 design's section 5.5 and reading R19, and the suite cases in `references/aliases`, among them
`refs-many-record-alias-no-match`. Draft v0.18 (#159): §8.5 (a record alias and an empty many-valued reference, and the
consequence of a prune), §8.2 and Appendix D `ref-dangling` (a record alias leads on), §13.6 and Appendix D `ref-aliased` (only a
reference that reaches a node through an alias is `aliased`); the I2 design's table of reference outcomes in section 5.3; W9's
record.
