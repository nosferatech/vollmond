---
id: AQ
title: "The title-derived warnings apply to every many-valued reference, as to single ones"
round: "AQ"
date: "2026-10-20"
status: accepted
sections: ["§6.3", "Appendix D"]
decided_by: owner
sources:
  card: "AQ"
---

## Question

The card: "vmd warns when a link reaches its target through a name derived from a heading's title (`ref-derived-anchor`, or
`ref-derived-repeat` when that title repeats), because retitling the heading breaks the link. A single-valued link gets the
warning whatever its schema says."

"Your AM answer included the card's sentence that the rule "also makes the title-derived warnings apply to many-references, which
they never do today". The card was about references with `anchors: explicit`, so the sentence reads two ways. Draft v0.16
currently says every many-valued reference gets them; its decision record says only those under `anchors: explicit` do."
[AM](AM.md) is that answer; its record's reading 4 had already been aligned with the draft and marked open for this card.

The card's example: "a schema field `related` with `cardinality: many` and the default `anchors: any`; the record says
`related: "notes.md#setup"`, and `setup` is the slug of `## Setup`. Warn, or not?"

## Options

- **(a) Every many-valued reference, as single ones.** Chosen, as recommended. The card: "`related` above gets
  `ref-derived-anchor`. Consistent with single references; a store that doesn't want it turns the warning off in its
  configuration, as it can today."
- **(b) Only under `anchors: explicit`.** The card: "`related` above gets no warning; under `explicit` the link is already an
  error (`ref-target-not-allowed`), so the warning there adds little. Many-valued references are then quieter than single ones."

## Decision

(a): `ref-derived-anchor` and `ref-derived-repeat` apply to every reference declared `cardinality: many`, whatever its `anchors`
setting, when one of its targets is reached only by a title-derived name, as they apply to a reference to one node. This is what
Draft v0.16 states in §6.3 and Appendix D, so the draft's text stays. It settles AM's reading 4, which is not a decision of AM, so
AQ supersedes nothing.

## Why

The card's reason: "The warning is about the link being fragile, and a many-valued link through a title is as fragile as a single
one; the configuration already lets a store silence it."

Why (b) lost: the card's reason above. Its consequence for (b): many-valued references are then quieter than single ones.

## Owner's note

The project owner chose (a) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.17 (#155): §6.3 and Appendix D's `ref-derived-anchor` and `ref-derived-repeat` rows, unchanged from Draft v0.16; AM's
record, whose reading 4 now points here. The code of typed references (#149) already gives the warnings for any target of a
reference reached only through its title, whatever the reference's `anchors` setting.
