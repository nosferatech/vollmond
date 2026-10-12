---
id: AH
title: "Renaming back to an alias's old name is allowed, and turns the alias around"
round: "AH"
date: "2026-10-12"
status: accepted
sections: ["§13.6"]
decided_by: owner
sources:
  card: "AH"
  prs: [122]
  issues: [48]
---

## Question

From the independent review of Draft v0.15 (#122). [AC](AC.md) locks an old name while an alias holds it: vmd's own writes refuse
to create a name that an alias in the file has as its `from`, until `vmd alias prune` removes it. Read literally, the lock also
refuses renaming a section back to its old name, `install` back to `setup` while the alias `setup` → `install` lasts, although
the node that takes the name is the one the alias leads to. AC's record left this case to this card. Should a rename back be
allowed?

## Options

- **(a) Allow it, and turn the alias around.** Chosen, as recommended. The card: "The rename back drops `setup` → `install` and
  records `install` → `setup`, so links written with either name reach the section. Only a different node is kept from taking a
  locked name. Draft v0.15 states it; the code comes with the rename operation (I5)."
- **(b) Refuse it until the alias is pruned.** The card: "As Draft v0.15 reads the lock now. Simple to state, but an undo of a
  rename waits, possibly for weeks if a long-lived branch exists."

## Decision

(a): a rename or a move back to an alias's old name is allowed. It drops the alias whose `from` is that name and records an alias
from the name it leaves, so links written with either name reach the node; the lock keeps only a different node from taking a
locked name. This settles a case AC's record left open, under AC's own decision ("vmd's own writes refuse to create a new `a`",
in the proposal the owner accepted), which a rename back does not do, so it does not supersede AC.

**Agent's reading, for the owner to confirm.**

1. "Back" is read as the node that the alias's chain leads to taking the alias's old name again, so after `a` → `b` → `c`,
   renaming `c` to `a` is a rename back: it drops `a` → `b` and records `c` → `a`, and `b` → `c` still leads on to `a`.
2. A move of a record back to an old path, `b.md` to `a.md` while the record alias `a.md` → `b.md` lasts, is treated the same
   way, as §13.6 states ("a rename or a move back").

## Why

The card's reason: "It keeps what your lock protects (no new node takes an old name) without blocking an undo, and every link
still means what its author meant."

Why (b) lost: the card's reason above, and its consequence for (b), that an undo of a rename waits, possibly for weeks if a
long-lived branch exists.

## Owner's note

The owner chose (a), with no note.

## Applied in

Draft v0.15 (#122): §13.6 (the lock) and AC's record, whose reading 3 now points here. The code comes with the rename operation
in phase I5; the suite has no write operations before I4, so there is no case yet.
