---
id: chat-5
title: "Pull requests of phases I0 to I2 land after a clean independent review"
round: "chat"
date: "2026-10-11"
status: accepted
decided_by: owner
sources:
  chat: ["2026-10-11T05:51:29Z", "2026-10-11T05:55:52Z"]
  prs: [78, 79]
---

## Question

Pull requests waited for the owner's approval before landing. Can they land without it?

## Options

- **(a) Wait for the owner's approval**, as before.
- **(b) Land after the session's check and a clean independent review, and stay on the desk for the owner to review afterwards.**
  Chosen, as the owner proposed, first for phase I0.

The session kept two limits, unless the owner said otherwise: decisions still wait for the owner, as cards, before they go into a
draft; and an independent review is still required before anything lands. It asked whether I1 implementation PRs land the same
way.

## Decision

(b), for phases I0, I1 and I2. A PR lands after the session's check and a clean independent review, and stays on the desk for the
owner to review afterwards; any finding then becomes a separate follow-up PR. Decisions still wait for the owner, and an independent
review is still required. Phase I3 (query) waits for design work with the owner first.

## Why

Not recorded. The owner accepted the session's two limits ("the limits sounds good").

## Owner's note

> For I0 phase please go ahead and land PR without waiting for my review, once you are satisfied with the PR and the indepdent
> review. Please still post them on the board, I'll review them asynchronously, and if I find anything then I'll give my feedback
> after the fact and we can discuss it and make changes as separate PRs if needed.

> the limits sounds good. I guess I assumed that we were still deep in I0 phase based on the board. In this case you can go ahead
> and land PRs from I0,I1,I2. For query I think we will need some more discussions and designing work.

## Applied in

Not in the repository: the session's process and the review desk. #78 (Draft v0.10) was the first PR landed this way, and #79
(the Markdown parser) the first of phase I1.
