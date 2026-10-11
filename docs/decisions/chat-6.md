---
id: chat-6
title: "Decisions are stored as one record per decision, in a vmd store"
round: "chat"
date: "2026-10-11"
status: accepted
supersedes: [chat-2.md]
decided_by: owner
sources:
  chat: ["2026-10-11T15:12:16Z", "2026-10-11T15:22:20Z"]
---

## Question

Decisions had been collected from the start of the design and implementation, but the repository kept only what was decided:
the rejected options, why they lost, and the owner's notes lived on the review desk and in conversation. The owner asked where the
decisions are saved, wanting them in the repository with the rejected alternatives and the reasons the winning answer was chosen.
How are they stored, and which ones are backfilled?

## Options

How they are stored:

- **(a) One record per decision.** Chosen, as recommended. `docs/decisions/<id>.md` as a vmd store, with front matter (status,
  supersedes, sections, sources) and Question, Options, Decision, Why and Owner's note. The log becomes an index. Backfilled from
  the desk, the log, the transcript and the design docs.
- **(b) Enrich the single log.** Keep `vollmond-proposal-review.md` as one file and add the options, reasons and notes to each
  entry: simpler, but one file of about 3,000 lines, with no links between decisions to check and nothing to query.
- **(c) Discuss first**: talk through the format before anything is written.

Which decisions the backfill covers:

- **(d) The owner's decisions and design decisions.** Chosen, as recommended. Everything the owner decided (rounds C to U, chat
  answers), plus decisions recorded in approved design docs (K1 to K13, and the I2 design's rejected alternatives such as the MAC
  and Ajv). Small implementation choices stay in the design docs and PRs.
- **(e) The owner's decisions only**, from cards and chat.
- **(f) Everything**, also the reviewers' findings that changed a design, and agents' implementation choices: largest, noisiest.

## Decision

(a) and (d). Every decision is a record in `docs/decisions/`, which is a valid vmd store, "exactly as proposed". A decision gets its
record in the same change that applies it to the draft, and the decision log becomes an index of the records.

## Why

The owner's reason for keeping decisions with their rejected alternatives: they will be of great value when bugs or feature
requests come, to compare with the decisions and see the correct way of addressing them. The owner's reason for a vmd store: it
acts as natural dogfood. The question's consequences for (b): one long file, with no links between decisions to check and nothing
to query. Why (e) and (f) lost: Not recorded.

## Owner's note

> done with the review, that was a lot. Where do we save those decisions? We have collected quite as part of the design and
> implementation from the start, it would be great if they got stored in the repo, ideally with rejected alternatived, as reason
> for selecting the winning answer. Those are going to be of incredible value when in the future we have bugs or feature asks, so
> we can compare that with decisions to see what is the correct way of addressing those.

> One record per decision, and forming a valid vmd store, exactly as proposed. This can act as very natural dogfood.

## Applied in

Pending: the pull request "Decisions as a vmd store (docs/decisions)", which adds this store, turns the log into an index and
changes `AGENTS.md`'s rule, replacing [chat-2](chat-2.md).
