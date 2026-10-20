---
id: AK
title: "In the strict read mode, a listing of references behaves as a query does"
round: "AK"
date: "2026-10-20"
status: accepted
sections: ["§9.5"]
decided_by: owner
sources:
  card: "AK"
  design: ["docs/design/i2-validate.md, section 4.6"]
  prs: [146]
---

## Question

The card: "Same strict read mode as card AJ. The draft says that under it, refused records "are then errors, not results", and
that a query fails as a whole over a collection whose schema can't be used. The design settles `ls` (refused records counted with
the unreadable ones) but not `refs`, which lists links across many records; the conformance suite's notes say `refs` behaves "as
queries do"." [AJ](AJ.md) decided that a reference's status does not depend on the read mode; the design's section 4.6 settles
`ls`.

The card's example: "`vmd refs --to people/ana.md` on a strict store, where one of the citing records has a schema violation."

## Options

- **(a) Like a query: refused records are reported as errors.** Chosen, as recommended. The card: "The listing still returns the
  links from readable records, and reports each refused record as an error; over a collection whose schema can't be used, the
  whole listing fails, as a query does. Consistent with the suite's "as queries do"."
- **(b) Like ls: refused records are left out silently.** The card: "Nothing fails and nothing is reported beyond what
  best-effort shows; strict mode changes nothing for refs. Simplest, but a strict caller can't tell a missing link from one in a
  refused record."
- **(c) Decide when queries are built (phase I3).** The card: "refs stays as today in strict mode, recorded as a known gap, and
  the question returns with the query language."

## Decision

(a): in the strict read mode, `vmd refs` returns the references of the records it can read, reports each record it refuses as an
error, and fails as a whole when it would leave out the records of a collection whose schema cannot be used, as a query does
(§9.5).

**Agent's reading, confirmed by the owner on [W7](W7.md) (2026-10-20), its item 6.** Two cases of one record that the card leaves
open, which Draft v0.16 states in §9.5: `vmd refs --from` a record that the strict mode refuses fails, as a strict `get` of it
does, since the listing reads only that record; and `vmd refs --to` such a record lists the references into it, whose statuses
stay as in the default mode, as [AJ](AJ.md) decided, since the listing reads the citing records, not the target.

## Why

The card's reason: "Strict mode exists so a caller never silently gets less than the store holds; (a) keeps that promise and
matches the suite's own description of refs."

Why (b) lost: the card's reason above; its consequence for (b) is that a strict caller cannot tell a missing link from one in a
refused record. Why (c) lost: Not recorded, beyond the card's reason for (a).

## Owner's note

The project owner chose (a) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.16 (#148): §9.5, item 4 (`vmd refs` in the strict read mode, and the reading above). The code is #146, the strict read
mode in core, which also states the rule in the I2 design's section 4.6; `--strict` on the command line comes with the commands of
task I2.6.

Draft v0.17: card [W7](W7.md) confirmed the reading above and #146's readings of the strict `refs`, which §9.5 now
states: every record it cannot return is reported by every issue it was refused for, and the failure over an unusable schema
names each such schema once.
