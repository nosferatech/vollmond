---
id: I2-design
title: "Approving the design of phase I2"
round: "U"
date: "2026-10-11"
status: accepted
decided_by: owner
sources:
  card: "I2 design"
  design: ["docs/design/i2-validate.md"]
  prs: [86]
  commits: ["bd76d96"]
---

## Question

The design of phase I2, validate and references (`docs/design/i2-validate.md`, #86), went through three rounds of independent
review. Under the owner's design-before-code rule, no I2 code starts until it is approved. The review's main corrections: the case
against Ajv was restated on corrected evidence ([U1](U1.md)); the cache moved out of the checkout, since a committed forged cache
could have made CI pass a broken store ([U4](U4.md)); relaxing a validation error no longer counts as a minor addition
([U21](U21.md)); and [U12](U12.md) reverses C2/F1, as its card says. The 21 open questions are cards U1 to U21. Approve the design?

## Options

- **(approve) Approve; answer the U cards.** Chosen, as recommended. #86 is merged as the approved design, the U answers (and P to
  T) go into Draft v0.11, and PR A starts once its six questions are answered.
- **(changes) Approve with changes.** The changes named in the note are made and reviewed, then the design is merged.
- **(rework) Not yet.** What is wrong goes in the note; no I2 code starts.

## Decision

Approve. The owner's note raised where the index lives, which is recorded with U4.

## Why

The card's reason: three review rounds, and the remaining choices are the owner's, as cards.

Why the other options lost: Not recorded.

## Owner's note

> This review brought a question on where the index lives? And I think answer is "depends". In case of lightweight setup, where
> the backend is pure simple git repo, the index should live locally, as otherwise it would cause merge conflicts.
> However, for more advanced git setup (a custom merger, lambda, actions etc) the index should live somewhere in the backend,
> either git repo, or some other configured storage.

## Applied in

#86, merged as the approved design (`bd76d96`). The answers to the U cards: pending, Draft v0.11.
