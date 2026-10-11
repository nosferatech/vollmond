---
id: plan-3a
title: "GitHub issues by default, eternal-circle for internal tickets"
round: "planning"
date: "2026-10-10"
status: accepted
supersedes: [plan-3.md]
decided_by: owner
sources:
  chat: ["2026-10-10T21:50:11Z"]
---

## Question

Once the tickets moved to eternal-circle, which has a component list for VOLLMOND, the session asked: should vollmond's own work
be tracked as tickets there too, or stay in GitHub issues as decided in [plan-3](plan-3.md)?

## Options

- **(a) Move vollmond's tickets to eternal-circle.**
- **(b) Stay in GitHub issues**, as decided.
- **(c) GitHub issues by default, eternal-circle for internal tickets that should not be public.** Chosen, from the owner's
  answer.

## Decision

(c). GitHub issues stay the default for vollmond, as appropriate for a public repository. Internal tickets that should not be
published on GitHub can go to eternal-circle, under the VOLLMOND prefix.

## Why

The owner's reason: normal tickets of a public repository belong in GitHub; only internal ones need a private place.

## Owner's note

> for vollmond ticket tracking, that depends. If there are internal tickets that we don't want to publish on github, they can go
> there. But for normal tickets, I think we should track them through github, as appropriate for public repo. I think the github
> remains default. But there might be some tickets that could show up in eternal-circle at some point.

## Applied in

Not applied to the draft or the plan. The session kept `AGENTS.md`, which says that work is tracked in GitHub issues, unchanged,
and did not name the private store there, since `AGENTS.md` is public.
