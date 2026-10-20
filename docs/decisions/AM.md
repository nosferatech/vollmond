---
id: AM
title: "A many-reference under `anchors: explicit` is breached when any target is reached by a title or a position"
round: "AM"
date: "2026-10-20"
status: accepted
sections: ["§6.3", "§9.3", "Appendix D"]
decided_by: owner
sources:
  card: "AM"
---

## Question

The card: "A schema can require a typed reference to name nodes only by explicit anchors (`anchors: explicit`), never by a
title's slug or a position, so the link doesn't break when a heading is retitled or moved. For a reference to one node that's
clear. For one that may name several (`cardinality: many`), one step can match several nodes, some by an explicit anchor and some
only by their title. Nothing in the draft says which counts."

The card's example: "`#notes` with `anchors: explicit` and `cardinality: many` matches two sections: one has the explicit anchor
`notes`, the other is a heading `## Notes` with no anchor."

## Options

- **(a) Breached if any target is reached only by a title or position.** Chosen, as recommended. The card: "The reference gets
  `ref-target-not-allowed` as soon as one of its targets was reached the fragile way. Strict, and it also makes the title-derived
  warnings (`ref-derived-anchor`) apply to many-references, which they never do today. Needs the resolver to record how each match
  was made, not only a single one."
- **(b) Breached only if every target was reached that way.** The card: "Lenient: one explicit-anchor match is enough. The fragile
  matches are still there and could change on a retitle."
- **(c) Refuse the combination in the schema.** The card: "`anchors: explicit` with `cardinality: many` makes the schema
  `schema-invalid`. Simplest, but removes a combination someone might want."

## Decision

(a): a reference declared `cardinality: many` under `anchors: explicit` is `ref-target-not-allowed` as soon as one of its targets
is reached only through a title-derived name or a positional step, whatever its other targets are. The card adds that this
"also makes the title-derived warnings (`ref-derived-anchor`) apply to many-references"; how far that reaches is reading 4 below.

**Agent's reading.** Readings 2 and 3 were confirmed by the owner on [W8](W8.md) (2026-10-20), items 3 and 4, and reading 4
was decided by [AQ](AQ.md). Reading 1, how Draft v0.16 chose its example, was on no card and is still for the owner to confirm.

1. The card's example has a duplicate anchor in vmd's terms: an explicit anchor `notes` and the derived anchor `notes` of another
   heading collide (§6.3, step 7, "a collision with one is a duplicate anchor"). The clash comes from the explicit anchor sitting
   on a heading whose title differs; in Markdown, two `### Notes` headings, one with `<a id="notes"></a>`, give the second the
   derived anchor `notes-1` and bind with no issue. §9.3's example is a YAML record, whose sections have no derived anchors at
   all: a section with `$anchor: log` holds two sections, one with `$anchor: notes` and one with `$title: Notes` and no anchor, at
   a level the schema declares `multimap`. `#log/notes` reaches `log` and the first `notes` by explicit anchors, and the second
   only by the key its title gives, so the reference is breached by that target alone.
2. "Only" is read as the I2 design's section 5.4 reads it for a reference to one node: a target that its step matched both by an
   explicit anchor and by a title-derived name, such as a heading `## Notes <a id="notes"></a>`, is reached through the explicit
   anchor and is allowed.
3. The card names `ref-derived-anchor`; Draft v0.16 applies both title-derived warnings, since `ref-derived-repeat` takes
   `ref-derived-anchor`'s place when the slug is repeated (§6.3, Appendix D).
4. **Asked as card AQ, and decided as stated here:** [AQ](AQ.md) chose that every many-valued reference gets the warnings.
   The card's sentence does not say whether the title-derived warnings reach every reference declared
   `cardinality: many`, or only one under `anchors: explicit`, which is already `ref-target-not-allowed` when a target is reached
   that way. Draft v0.16 states the wider reading, in §6.3 and Appendix D's `ref-derived-anchor` and `ref-derived-repeat` rows:
   every reference declared `cardinality: many` gets the warning when one of its targets is reached only by a title-derived name,
   whatever its `anchors` setting, as a reference to one node does.

## Why

The card's reason: "The point of `explicit` is that no target depends on a title or position; (a) is the only reading that keeps
that true for every target."

Why (b) and (c) lost: the card's reason above. Its consequences: under (b), the fragile matches are still there and could change
on a retitle; (c) removes a combination someone might want.

## Owner's note

The project owner chose (a) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.16 (#148): §9.3 (`anchors: explicit` with `cardinality: many`, and the example), §6.3 (the title-derived warnings for a
many-reference, reading 4), Appendix D `ref-target-not-allowed`, `ref-derived-anchor` and `ref-derived-repeat`. The code, which
has to record how each match was made, and its suite cases come with the implementation pull request for this card, which also
updates the I2 design.

Draft v0.17: card [W8](W8.md) confirmed readings 2 and 3, and [AQ](AQ.md) decided reading 4 as Draft v0.16 states it, so
the text of §6.3 and Appendix D stays. §9.3 now says that a target matched both by an explicit anchor and by its title is reached
through the explicit anchor (reading 2), and that a step through a title-derived name under `anchors: explicit` raises both the
refusal and the warning.
