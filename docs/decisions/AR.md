---
id: AR
title: "Unequal typed-reference declarations on a `$ref` object and its `$ref` member are refused"
round: "AR"
date: "2026-10-20"
status: accepted
sections: ["§9.3"]
decided_by: owner
sources:
  card: "AR"
  design: ["docs/design/i2-validate.md, section 11, reading R21", "docs/design/i2-validate.md, section 12, question 22"]
  prs: [149]
  issues: [24]
---

## Question

A follow-up to [AN](AN.md), under which an `x-vmd-ref` on the `$ref` member of a `$ref` object applies to the object. The card:
"In JSON and YAML records, `{"$ref": "other.md#x"}` is a reference, and a schema may declare `x-vmd-ref` (what the link may point
at) on its `$ref` member, which then applies to the object. A schema could also declare it on the object itself, with different
settings, for instance `targets: [people]` on the object and `targets: [projects]` on the member."

"The typed-references pull request refuses such a schema for now (`schema-invalid`), so nothing is decided silently." That pull
request is #149; the case is the I2 design's question 22, recorded on #24.

## Options

- **(a) Refuse the schema while they differ.** Chosen, as recommended. The card: "As the pull request does now. Equal
  declarations, or one alone, are fine. Consistent with how vmd treats two parts of a schema that give one place unequal
  declarations."
- **(b) The member's declaration wins.** The card: "The object's is ignored, silently."
- **(c) The object's declaration wins.** The card: "The member's is ignored, silently."

## Decision

(a): a declaration on a `$ref` object and one on its `$ref` member must be equal; one alone is fine. Unequal ones are refused as
unequal declarations that meet are (§9.3): `schema-invalid` where the schema alone brings the two together, and, where only a
member name in the data does, a `schema-violation` at the object, which then gets neither declaration (the reading below). The two
are compared as written, so `{}` and `{cardinality: one}` differ, as the I2 design's reading R21 has it, which card [W9](W9.md)
confirmed (its item 8). This settles a case AN left open, under AN's own decision, so it does not supersede AN.

**Agent's reading, confirmed by the owner on [W10](W10.md) (2026-10-20), its item 2.** The card speaks of refusing the schema.
Where only a member name in the data brings the two declarations together, as with a pattern that matches `$ref`, the schema
cannot be refused at load, so Draft v0.17 applies §9.3's rule for declarations that meet only in the data: that object gets a
`schema-violation` and neither declaration, and the rest of the collection is unaffected. #149 does it so, and its description
gives the case as part of this option.

## Why

The card's reason: "Either winner silently drops something the schema's author wrote; a refusal names the conflict, and it can be
relaxed later without breaking anyone."

Why (b) and (c) lost: the card's reason above, and its consequence for each, that the other declaration is ignored, silently.

## Owner's note

The project owner chose (a) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.17 (#155): §9.3 ("A declaration on a `$ref` member"). The code is #149, which refuses the case both at load and in the
data.

#157 removed the code's comments that marked the case as an open question (`TODO(#24)` in `js/packages/core/src/schema/spine.ts`
and `js/packages/core/src/binding/binding.ts`); its refusal now says that declarations that meet must be equal.

Draft v0.19: card [W10](W10.md) confirmed the reading above (item 2); the draft's text keeps it as written.
