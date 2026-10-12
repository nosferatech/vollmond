---
id: AI
title: "A retitle may renumber another heading onto a locked name; the live name wins, with the warning"
round: "AI"
date: "2026-10-12"
status: accepted
sections: ["§13.4", "§13.6"]
decided_by: owner
sources:
  card: "AI"
  prs: [122]
---

## Question

From the independent review of Draft v0.15 (#122), which found that [AC](AC.md)'s lock, as Draft v0.15 first wrote it,
contradicts §13.4's own example. Retitling the first of two `## Notes` sections records an alias from its old anchor `notes`, and
the repeat numbering (§6.3) turns the second one's `#notes-1` into `#notes`, a name the new alias holds. The lock as written
refused any derived anchor that a retitle renumbers onto a held name, so the example would be refused. AC's record left this case
to this card.

## Options

- **(a) Allow it; the live name wins, with the warning.** Chosen, as recommended. The card: "The retitle goes through. A link
  from outside to `#notes` reaches the second heading (a live name wins), and `vmd check` warns `alias-shadowed`. The lock covers
  only names a writer chooses (a new title, anchor, key or path), not numbers a retitle shifts. Headings meant to be linked from
  outside should have an explicit anchor, which never renumbers."
- **(b) Refuse the retitle.** The card: "The lock applies to renumbered anchors too. No link is ever misdirected, but retitling
  the first of two same-titled headings is refused until the alias is pruned; §13.4's example changes."

## Decision

(a): the lock covers the names a writer chooses, a new title, anchor, key or path, and not a derived anchor that a retitle's
repeat numbering shifts. Such a retitle goes through; a link from outside the store to the shifted name reaches the live node,
and `vmd check` warns `alias-shadowed`. References inside the store are rewritten by `rename` as before (§13.4). This settles a
case AC's record left open, and narrows the reading of "vmd's own writes" that AC's record gives, not AC's decision, so it does
not supersede AC.

## Why

The card's reason: "Refusing blocks an ordinary edit for a case only links from outside can feel, and those already have a stable
fix (explicit anchors). The warning makes the shadowing visible."

Why (b) lost: the card's reason above; its consequence for (b) is that retitling the first of two same-titled headings is refused
until the alias is pruned.

## Owner's note

The owner chose (a), with no note.

## Applied in

Draft v0.15 (#122): §13.6 (the lock covers the names a writer chooses), §13.4 (the example of two `## Notes` sections, which the
lock allows), and AC's record, whose reading 3 now points here. The code comes with the rename operation in phase I5; the suite
has no write operations before I4, so there is no case yet.
