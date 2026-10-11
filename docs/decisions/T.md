---
id: T
title: "Block anchors in a list item's later paragraphs"
round: "T"
date: "2026-10-11"
status: accepted
supersedes: [I1.7.md]
sections: ["§6.2", "Appendix D"]
decided_by: owner
sources:
  card: "T"
  log: "Decisions from cards P to V (Draft v0.11), at 169c597: T. Block anchors in a list item's later paragraphs"
  prs: [85, 87]
  commits: ["169c597"]
---

## Question

vmd read all 37 of vampiredb's docs for the vampiredb demonstration (#85), and every one of 1,377 addresses resolved to the node it
came from. One real-data finding goes against [I1.7](I1.7.md): vampiredb's `design/Minimal_Log.md` has 17 `<a id>` elements at the
start of a list item's second or later paragraph. Under I1.7 an anchor may start a list item or a top-level paragraph, but not a
later paragraph inside a list item, so these 17 get a warning and resolve to nothing. 12 of them are the targets of 40 links in
vampiredb's docs, which `vmd check` (I2.8) would report as broken. The pattern is a plausible way to write documents, not a
mistake in vampiredb. Where may a block anchor stand?

## Options

- **(a) Widen §6.2: any paragraph outside block quotes.** Chosen, as recommended. An anchor may start any paragraph, at the top
  level or inside a list item at any depth, but not inside a block quote ([J2](J2.md)). The 17 become block anchors and the 40
  links resolve. Draft v0.11 changes §6.2, with cases.
- **(b) Keep I1.7; vampiredb moves its anchors.** The rule stays narrow. vampiredb's 17 elements move to the start of their list
  item, or get a heading, before I2.8. That is a change to vampiredb, in its own process.

## Decision

(a): a block anchor may start any paragraph, at the top level or inside a list item at any depth, but not inside a block quote.
This widens I1.7, which allowed one at the start of a paragraph only at the top level, and keeps J2's boundary.

## Why

The card's reason: the data says the narrow rule breaks a real, readable style of writing; the wider rule has the same clear
boundary, no block quotes, and loses nothing. That is also the card's case against (b), keeping the narrow rule; its
consequence for (b) was a change to vampiredb, in its own process.

## Applied in

Draft v0.11 (#87, `169c597`): §6.2, Appendix D `anchor-element-ignored`, the plan (I1.7's description), the suite case
`anchors/blocks-and-tags/list-placement`.
