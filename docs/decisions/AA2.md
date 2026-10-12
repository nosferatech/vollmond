---
id: AA2
title: "An unknown member or value inside `x-vmd-list` or `x-vmd-ref` is `feature-unsupported`"
round: "AA"
date: "2026-10-12"
status: accepted
supersedes: [W1.md]
sections: ["§9.1", "§9.3", "Appendix D"]
decided_by: owner
sources:
  card: "AA2"
  design: ["docs/design/i2-validate.md, section 3.3"]
  prs: [97, 105]
---

## Question

From the schemas pull request (#97), its reading 3. The card: "An unknown keyword such as `x-vmd-foo` is `feature-unsupported`:
it may come from a newer minor version (decision U21). But what about an unknown member inside a known keyword, such as
`x-vmd-list: {sorted: true}`, or an unknown value, such as `type: set`? The schemas PR makes them `schema-invalid`." Either way
the schema is refused and its collection's records with it, so a newer version can still add such members and values ([U21](U21.md)
holds either way); only the code and the message differ. What each side rests on, from the card: for `schema-invalid`, the
literal words confirmed on [W1](W1.md), item 5, "An unknown `x-vmd-*` keyword stays `feature-unsupported`… Every other unusable
schema is `schema-invalid`."; for `feature-unsupported`, §9.1 as written, "a schema that uses a construct this version does not
define… is `feature-unsupported`", and the treatment of unknown configuration members (U21).

## Options

- **(a) `feature-unsupported`.** Chosen, as recommended. The card: "A schema written for a newer vmd says so. The schemas PR
  changes the code. Draft states members and values alongside keywords."
- **(b) `schema-invalid`, as the PR does.** The card: "Follows W1 item 5 literally. A newer schema read by an older vmd is
  reported as broken."

## Decision

(a): a member or a value inside `x-vmd-list` or `x-vmd-ref` that this version does not define makes the schema
`feature-unsupported`, as an unknown `x-vmd-*` keyword does, and its message says that the schema may need a newer version. §9.1,
§9.3 and Appendix D state members and values beside keywords.

**Agent's reading, for the owner to confirm.** Three details the card leaves open, which Draft v0.14 states as follows:

- This departs from the literal wording of W1's item 5, as the card says, by moving unknown members and values from its "every
  other unusable schema" to its first half, an unknown construct being `feature-unsupported`. It amends that reading in the
  same direction, more of what a newer version may add being reported as such, and so supersedes W1, as [W3](W3.md) superseded
  [X1](X1.md) for its FIFO part; W1's decision, and its other eight items and the rest of item 5, stand.
- An unknown value is a value outside the set a member defines: `type` other than `map` or `multimap`, `cardinality` other than
  `one` or `many`, `anchors` other than `any` or `explicit`. A value of the wrong form for a member this version defines, such as
  a `keys` that is not a list or a `targets` entry that is not a well-formed glob, is not something a newer version adds in a
  form an older reader can recognise, and stays `schema-invalid`; the suite's case `validation/schemas/list-keys-wrong-form`
  pins it.
- The card covers `x-vmd-list` and `x-vmd-ref`. A value of `x-vmd-summary` other than a boolean stays `schema-invalid`, as
  [U19](U19.md) decided, and so does an `x-vmd-ordered` other than `asc` or `desc`, which #97 refuses and Draft v0.14 does not
  change.

When an unknown member or value stands beside other problems, `feature-unsupported` wins, as [AA4](AA4.md) (item 1) confirms.

## Why

The card's reason: "The message matters to the person fixing it: a schema from a newer vmd isn't broken. And it matches how
configuration already works. I'm recommending a departure from W1 item 5's literal wording, which I don't think anticipated
members inside a keyword."

Why (b) lost: Not recorded. The card's consequence for it: a newer schema read by an older vmd is reported as broken.

## Applied in

Draft v0.14 (#105): §9.1 ("A collection whose schema cannot be used", and "Every addition is detectable"), §9.3, Appendix D
`feature-unsupported` and `schema-invalid`; the I2 design's section 3.3; suite cases `validation/schemas/list-unknown-member`,
`list-unknown-value`, `ref-unknown-member`, `ref-unknown-value`, their near miss `list-and-ref-known-members`, and
`list-keys-wrong-form`. The four cases of unknown members and values are skipped in the TypeScript runner's declaration until #97
changes the code, which makes them `schema-invalid` today.
