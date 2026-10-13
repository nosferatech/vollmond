---
id: AB
title: "Every `$body` of a JSON or YAML record sees the link reference definitions of all its bodies"
round: "AB"
date: "2026-10-12"
status: accepted
sections: ["§5.4", "§5.5", "§8.1"]
decided_by: owner
sources:
  card: "AB"
  design: ["docs/design/i2-validate.md, section 5.1"]
  prs: [99, 103, 105]
---

## Question

From the pull request that holds a data `$body` to the Markdown limits (#103, decision [Z1](Z1.md)), whose author found the gap.
In a JSON or YAML record, does one section's `$body` see the link reference definitions of the record's other `$body` values? The
draft is silent; §5.5 already gives a data `$title` the definitions of every `$body` in the record. It matters for the limits,
since the `*` in the label of a defined reference link are no runs and a defined reference link is one inline level, and for
which links exist for references (§8.1). #103 and the references code of #99 read each body alone, with its own definitions.

## Options

- **(b) Every body sees all the record's definitions.** Chosen, as recommended. The card: "Same as one Markdown file and as titles
  already are; converting between formats keeps every link. Needs the record's definitions passed into the body parse in both the
  limit check and the reference extraction (a small change to #103, and one to the #99 code), plus one sentence in the draft."
- **(a) Each body sees only its own definitions, as the code does now.** The card: "#103 lands as it is. The draft says so, and
  §5.8 has to say that converting a Markdown file can drop links whose definition sits in another section; a converter would move
  or copy definitions to keep them."

## Decision

(b): each `$body` of a JSON or YAML record is read with the link reference definitions of every `$body` of the record in scope,
as one Markdown file is. Where two bodies define one label, the first definition in document order wins, as in CommonMark for one
file: the owner decided this in chat after an example where the root's `$body` and a section's `$body` both define `[log]` with
different targets.

**Agent's reading, confirmed by the owner on [W5](W5.md) (2026-10-12).** Two details, which Draft v0.14 states as follows:

- "Document order" for the definitions is the order of the record's Markdown form: each section's `$body` before the bodies of its
  `$sections`, in their order, whatever the order of the members in a JSON or YAML file. Appendix D defines document order as the
  pre-order of the value view with siblings in their order in the file, under which a file that writes `$sections` before `$body`
  would put a section's subsections first; the Markdown form's order keeps the winner the same in every format, which is the
  reason the owner gave for (b).
- The rule is stated once, in §5.4 beside the limits on a data `$body`, and §5.5's title sentence and §8.1 point at it. A data
  `$title` already had the same scope, so the precedence holds for titles too.

## Why

The card's reason: "The draft's stated aim is that a record means the same in every format (§5.5, §5.8), and titles already
follow (b). Under (a) a conversion silently changes which links exist, which is exactly what §5.8's lossless conversion promises
not to do." The owner's reasons are in the notes below: the isomorphism between the formats and round trips, and for the
precedence, that labels are ordinary names, not unique anchors.

Why (a) lost: the card's consequence for it, that a conversion silently changes which links exist.

## Owner's note

On the card:

> I think your recommendation is appropriate. It goes inline with the MD / json / yaml isomorphism and roundtriping.

On two definitions of one label:

> those are just regular names, not unique anchors, right? so I think yes, the first one wins.

## Applied in

Draft v0.14 (#105): §5.4 (the scope of definitions for a data `$body`, and which definition wins), §5.5 and §8.1, which point at
it; the I2 design's section 5.1 ("Prose in JSON and YAML"). Suite cases `markdown/limits/data-section-body-reference-label-runs-json`
and `-yaml` (the labels' `*` are no runs), `data-section-body-reference-link-nesting-256-json` and `-yaml` (the link is an inline
level) with the near miss `data-section-body-reference-link-nesting-255-json`, and
`references/statuses/refs-body-definition-in-other-section-json` and `-yaml`, which read `[a][b](twin.md)` in a section as the
Markdown form `refs-body-definition-in-other-section-md` does: a reference link through the root's definition, with no reference
to `twin.md`. The JSON and YAML cases that main failed were skipped in the TypeScript runner's declaration until #103 took the
rule; the suite has no case for two definitions of one label, which no reference shows.

The TypeScript reader follows in #103, which removes those four skips: the limit check and the references read each `$body`
with the definitions of every `$body` of its record in scope, collected once per record in the order of its Markdown form, as
[Z1](Z1.md)'s record notes.
