---
id: AN
title: "An `x-vmd-ref` on the `$ref` member of a `$ref` object declares the object, one reference"
round: "AN"
date: "2026-10-20"
status: accepted
sections: ["§8.1", "§9.3"]
decided_by: owner
sources:
  card: "AN"
---

## Question

The card: "In JSON and YAML records a reference can be written as an object `{"$ref": "other.md#x"}`, which vmd already reads as
a reference. A schema could also mark that `$ref` member itself as a typed reference (`x-vmd-ref`). Then the same link would be
found twice, once as the object and once as the typed string."

## Options

- **(a) One reference: the object, with the member's declaration.** Chosen, as recommended. The card: "The `$ref` object is the
  reference, and the declaration (targets, cardinality, anchors) on its `$ref` member applies to it. Counted once."
- **(b) Ignore the member's declaration.** The card: "The object is a plain reference with no typed rules; the declaration on its
  member has no effect, silently."
- **(c) Refuse it in the schema.** The card: "`x-vmd-ref` on a `$ref` member makes the schema `schema-invalid`."

## Decision

(a): an `x-vmd-ref` on the `$ref` member of a `$ref` object applies to the object. The object is the one reference, with the
targets, cardinality and anchors that the member's declaration gives, and the member is not a second, typed reference to the same
target.

**Agent's reading, confirmed by the owner on [W8](W8.md) (2026-10-20), its item 5.** The card does not touch where a declaration
may stand, so Draft v0.16 changes none of those rules: a declaration on a `$ref` member, which is a string, still needs `format:
uri-reference`, or a `type` that allows no string, beside it on every path (§9.3, [AA4](AA4.md) item 2), and is still read only
along the spine. Draft v0.16 did not restate this beside the new paragraph; Draft v0.17 does.

## Why

The card's reason: "It counts the link once and honours what the schema author wrote, without a new refusal."

Why (b) and (c) lost: the card's reason above. Its consequences: under (b) the declaration on the member has no effect, silently;
(c) is a new refusal.

## Owner's note

The project owner chose (a) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.16 (#148): §9.3 (the keyword table's "Where", and the paragraph "A declaration on a `$ref` member") and §8.1. The code
and its suite cases come with the implementation pull request for this card, which also updates the I2 design.

Draft v0.17: card [W8](W8.md) confirmed the reading above, and §9.3 states it. [AR](AR.md) decided the case of unequal
declarations on the object and its member, which this decision left open: they are refused.
