---
id: AG
title: "A live first step keeps a link from following an alias, even when the rest of the link is missing"
round: "AG"
date: "2026-10-12"
status: accepted
sections: ["§13.6"]
decided_by: owner
sources:
  card: "AG"
  design: ["docs/design/i2-validate.md, section 5.5"]
  prs: [106, 121, 122, 124]
  commits: ["d99730a"]
---

## Question

A link whose first name is live but whose later steps match nothing. The card's example: `data/k.json` is
`{"a": {"n": 1}, "b": {"x": 2}}`, with the alias `a` → `b`, and the link `#a/x`. The live key `a` has no member `x`, so the link
resolves to no live node, and §13.6 then resolved it through the aliases: the code of #106 follows `a` to `b` and reaches `b/x`.
But [AC](AC.md) decided that a live name wins, and `alias-shadowed` (#121) warns at `a` that references to it reach the live
node. Which holds when only the rest of the link is missing?

## Options

- **(a) A live first step stops the chain: the link is dangling.** Chosen, as recommended. The card: "'A live name always wins'
  holds for the first step of every link, so where a link goes never depends on its later steps, and the warning stays true. The
  link `#a/x` is `dangling`, and `vmd check` shows it beside the alias-shadowed warning. A small code change and a test; §13.6
  gets the sentence."
- **(b) Fall through to the alias when the rest is missing (as today).** The card: "More links keep working after a rename
  followed by a reuse of the old name. But which node a link's first step means depends on what its later steps find, and the
  warning's message must be softened ('references to it alone reach this node'). §13.6 gets the sentence; no code change."

## Decision

(a): a link whose record path exists, or whose first step reaches a name of the record, is not resolved through an alias, even
where a later step matches nothing. `#a/x` in the example is `dangling`, beside the `alias-shadowed` warning at `a`. Record
aliases already work this way, since a record path follows them only when no record is at it.

It decides a case that neither [Z2](Z2.md) nor AC decided: Z2 and AC say where a chain of aliases stops, and this says when a
first step starts one. So it supersedes neither; it applies AC's rule, a live name wins, to every link.

## Why

The card's reason: "It is the same rule as your AC answer, applied to every link: a live name wins. Resolution stays step by
step, and the warning tells the truth. The case only arises in a state vmd already warns about."

Why (b) lost: the card's reason above; its consequences for (b) are that which node a link's first step means depends on what its
later steps find, and that the warning's message must be softened.

## Owner's note

The owner chose (a), with no note.

## Applied in

Draft v0.15 (#122): §13.6 (when the record path and the first step follow aliases, and the example). Suite case
`references/alias-chains/refs-live-first-step-dangling`, `#a/x` in `docs/live-first.json` as `dangling`, with the near miss
`refs-old-first-step-aliased`, where the first step `old` is not live and follows the alias `old` → `b` to `b/x`. The code is
#124 (`d99730a`), which also updates the I2 design's section 5.5, and passes both.
