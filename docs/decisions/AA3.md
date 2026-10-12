---
id: AA3
title: "`$dynamicRef` is allowed in collection schemas, and its targets count as off the spine"
round: "AA"
date: "2026-10-12"
status: accepted
sections: ["§9.2", "§9.3", "Appendix D"]
decided_by: owner
sources:
  card: "AA3"
  design: ["docs/design/i2-validate.md, section 3.3"]
  prs: [97, 105]
---

## Question

From the schemas pull request (#97), its reading 10. The card: "`$dynamicRef` is JSON Schema 2020-12's way of writing extensible
recursive schemas: a generic tree whose node type a user can extend. Where it points depends on how validation reached it, so vmd
can't follow it statically along the spine. The PR allows it, safely. After the review's fix, its possible targets are only the
anchors vmd itself found and registered, so it can't fetch anything or reach hidden schemas. For the spine, every possible target
counts as off the spine, so an `x-vmd-list` or `x-vmd-ref` reached only through it is `schema-invalid`. The reviewer tested the
cross-file case and it behaves correctly." Should collection schemas allow `$dynamicRef`?

## Options

- **(a) Allow it, as the PR does.** Chosen, as recommended. The card: "Extensible recursive schemas work. vmd's keywords can't be
  reached through it."
- **(b) Refuse it.** The card: "`schema-invalid`. Simpler to explain, but a valid 2020-12 feature is lost. A later minor version
  could allow it (U21)."

## Decision

(a), with the owner's note that it can be disabled before 1.0 if it causes trouble: `$dynamicRef` is allowed, as #97 allows it.
Its possible targets are only the anchors vmd found and registered, and every possible target counts as off the spine, so an
`x-vmd-list` or `x-vmd-ref` reached only through it is `schema-invalid`.

**Agent's reading, for the owner to confirm.** Three details, which Draft v0.14 states as follows:

- With [AA4](AA4.md)'s item 6, a declaration at such a `$dynamicAnchor` is refused also when the spine reaches it another way,
  not only when the `$dynamicRef` is the only way, which the card's "reached only through it" leaves open. #97 does so, since its
  off-spine walk refuses every declaration reached off the spine.
- A consequence the card does not show: in the standard shape of an extensible recursive schema, a `$dynamicAnchor` on the
  schema's root and a `$dynamicRef` to it for the children, the root is a possible target, so every `x-vmd-list` or `x-vmd-ref`
  the root's spine reaches is reached through the `$dynamicRef` too, and the schema is `schema-invalid`. The review of Draft
  v0.14 found it: a tree whose root has `$dynamicAnchor: node`, a `kids` array of `$dynamicRef: "#node"` and one typed
  reference `owner` is refused, on #97's code. With the tree in `$defs` and the root referencing it, the root's own declarations
  can be used, but the tree's node still cannot carry one. So, today, a schema that uses `$dynamicRef` for its recursion
  cannot declare a keyed list or a typed reference in the recursive part.
- Why `$dynamicRef` lands on nothing else is stated in §9.2 beside the rule that keeps identifiers out of data (AA4's item 5),
  since that rule is what keeps its targets to the anchors vmd found.

## Why

The card's reason: "It's safe now, and refusing it would lose a real feature for no safety gain. The reviewer agrees."

Why (b) lost: Not recorded. The card's consequences for it: simpler to explain, but a valid 2020-12 feature is lost.

## Owner's note

> If it causes trouble, we can disable it before 1.0

## Applied in

Draft v0.14 (#105): §9.2 (`$dynamicRef` allowed, and what it can land on), §9.3 ("The spine"), Appendix D `schema-invalid`; the
I2 design's section 3.3; suite cases `validation/schemas/dynamic-ref-tree`, a recursive schema through `$dynamicRef` that
validates a record, and `dynamic-ref-declaration`, an `x-vmd-list` reached only through it. #97 (`f74bc12`) passes
both.
