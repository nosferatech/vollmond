---
id: G3c
title: "A client refuses an older major version it does not support"
round: "G"
date: "2026-10-10"
status: reversed
supersedes: [G3.md]
superseded_by: [G3d.md]
sections: ["§9.1", "§9.5"]
decided_by: owner
sources:
  card: "G3"
  log: "Decisions of phase I0 / The owner's answers to the review (G1 to G9)"
  chat: ["2026-10-10T18:40:09Z"]
  session: ["2026-10-10T18:32:21Z", "2026-10-10T18:38:30Z"]
  prs: [50]
  issues: [9]
---

## Question

When the three-version rule of [G3a](G3a.md) was applied to #50, the session's instruction made the draft refuse every major
version the client does not support, older ones included, where [G3](G3.md) had said to warn on an older store. Should a client
refuse a store on an older major version it does not support, or read it with a warning?

## Options

- **(a) Refuse it.** Chosen, as the session recommended. A client that supports the older major version as a compatibility level
  and is configured for it reads and writes at that level.
- **(b) Read it with a warning**, as G3 recorded.

## Decision

(a): a client refuses an older major version as well as a newer one, unless it can be configured to work at that version's
compatibility level.

## Why

The session's reason, from the owner's own point about misreads: a different major version is by definition one that may be read
differently, so a client that does not support it cannot read it correctly, and "warn and read" is a misread with a warning
attached. The user can still run the older vmd that handles that version, so reading the store anyway gains nothing.

## Owner's note

> I'd say refuse, unless it can be configured with that version compatibility.

## Applied in

Draft v0.4 (#50, `1043a6c`), §9.1 and §9.5; issue #9 closed. Five minutes later, on second thought, [G3d](G3d.md) let a newer
client read an older store with a warning where no change in between alters meaning.

[G3d](G3d.md) reverses it in part: a newer client reads an older store with a warning where no change in between alters meaning,
instead of refusing it.
