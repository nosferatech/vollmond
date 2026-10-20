---
id: AJ
title: "A reference's status does not depend on the read mode"
round: "AJ"
date: "2026-10-20"
status: accepted
sections: ["§8.5", "§9.5", "Appendix D"]
decided_by: owner
sources:
  card: "AJ"
  prs: [146]
---

## Question

The card: "vmd can open a store in a strict read mode: a reader then refuses any record with a validation error (a structural
error, a value the schema rejects, a repeated key where keys must be unique, a filename that doesn't match its key), instead of
returning it with warnings. The default, best-effort mode returns it. This was decided earlier (G7, U11); the code is next."
[G7](G7.md) decided what the strict read mode refuses, and [U11](U11.md) that it comes in phase I2.

"Open: what happens to a link that points into such a record. The draft's list of what makes a link `unreadable` names only
structural errors and unusable schemas, not the read mode. But the code resolves link targets through the same read path a strict
reader would use, so putting the refusal there would quietly turn those links `unreadable`, and `vmd check` on a strict store
would report differently."

The card's example: "`a.md` links to `b.md#notes`, and `b.md` has a field the schema rejects. Best-effort: the link is `ok`.
Strict: is it still `ok`?"

## Options

- **(a) No: link statuses don't depend on the read mode.** Chosen, as recommended. The card: "The link stays `ok`; strict mode
  only changes what a reader (get, outline, a query) returns. `vmd check` reports the same in both modes, as the draft already
  says it reports every issue whatever the mode. The refusal sits on the reader side, not in the shared read path."
- **(b) Yes: the link becomes `unreadable` in strict mode.** The card: "A strict store treats refused records as unreadable
  everywhere, links included. The draft's list of what makes a link unreadable grows a case, and `vmd check` must be pinned to
  best-effort so its report doesn't change with the mode."

## Decision

(a): a reference's status does not depend on the read mode. The strict read mode changes what readers return, not which records
a reference can be resolved into, so a reference into a record that only the strict mode refuses, for a schema violation, say,
is resolved as in the default mode; `unreadable` stays the status of a reference into a record that readers refuse in every
mode, one with a structural error or one of a collection whose schema cannot be used (§8.5). `vmd check` reports the same in
either mode.

## Why

The card's reason: "It matches the draft's list and its rule that check reports every issue in either mode, and keeps the read
mode a reader's choice rather than something that changes the store's links."

Why (b) lost: the card's reason above. Its consequences for (b): the draft's list of what makes a link unreadable grows a case,
and `vmd check` must be pinned to best-effort so that its report does not change with the mode.

## Owner's note

The project owner chose (a) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.16: §8.5 (a reference's status and the read mode), §9.5 (item 2, `vmd check` reports the same in either read mode, and
item 4, the mode changes what readers return), Appendix D `ref-target-unreadable`. The code is #146, the strict read mode, which
also states the rule in the I2 design's section 4.6.
