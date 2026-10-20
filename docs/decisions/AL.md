---
id: AL
title: "A reference declared `cardinality: many` that matches nothing follows the anchor aliases"
round: "AL"
date: "2026-10-20"
status: accepted
sections: ["§8.5", "§13.6"]
decided_by: owner
sources:
  card: "AL"
  design: ["docs/design/i2-validate.md, section 5.5"]
---

## Question

The card: "A schema can mark a string field as a reference to other records (`x-vmd-ref`), and say it may name several nodes
(`cardinality: many`), like a selector. Matching none is fine for such a reference: it's `ok` with no targets (decision G5)."
[G5](G5.md) is that decision.

"The question is what happens when it matches none because a heading was renamed. The draft (§13.6) says "a reference that
resolves to no live node is resolved through the aliases", which would include it. The I2 design (§5.5) consults aliases only for
a `dangling` reference, which this isn't. They disagree."

The card's example: "`related: "notes.md#setup"` with `cardinality: many`; `## Setup` was renamed to `## Install` (alias `setup`
→ `install`), so `#setup` now matches nothing."

## Options

- **(b) Follow the aliases, as the draft says.** Chosen, as recommended. The card: "The reference is `aliased` and reaches the
  renamed section, as a single reference would. If no alias applies, it's `ok` with no targets as today. The design's §5.5 gets
  the sentence. Your AG rule still holds: a live first step never follows an alias."
- **(a) Don't: an empty many is ok as it is.** The card: "As the design says. A renamed heading silently makes such a reference
  empty instead of following the rename; the draft's §13.6 gets an exception."

## Decision

(b): a reference declared `cardinality: many` whose selector matches nothing is resolved through the aliases, as a reference to
one node is: in the example it is `aliased` and reaches the renamed section. Where no alias applies it is `ok`, with no targets,
as G5 decided. [AG](AG.md) still holds: a first step that reaches a name of the record is not resolved through an alias, so a
many-reference whose first step is live and whose later steps match nothing stays `ok`, with no targets.

This applies §13.6's existing rule to a case the I2 design read otherwise; it changes neither G5's rule, which was about a
many-reference with no match against `dangling`, nor AG's, so it supersedes neither.

## Why

The card's reason: "It's the draft's own rule, and a rename shouldn't silently empty a reference that a single-valued one would
follow."

Why (a) lost: the card's reason above; its consequences for (a) are that a renamed heading silently makes such a reference empty
instead of following the rename, and that §13.6 would need an exception.

## Owner's note

The project owner chose (b) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.16 (#148): §8.5 (a many-reference that matches nothing follows the aliases, else is `ok`), §13.6 (the example), and the
conformance README's `targets` of `refs`. The I2 design's section 5.5, which consults aliases only for a `dangling` reference,
gets the sentence with the implementation pull request for this card, which also brings the code and its suite cases.
