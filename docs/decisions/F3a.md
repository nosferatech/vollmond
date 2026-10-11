---
id: F3a
title: "Severities by issue code"
round: "I0"
date: "2026-10-10"
status: accepted
sections: ["§9.1", "Appendix D"]
decided_by: owner
sources:
  card: "F3"
  log: "Decisions of phase I0 / YAML"
  prs: [50]
  issues: [9]
  commits: ["1043a6c"]
---

## Question

Answering [F3](F3.md) on compatibility quoting, the owner added that a user should be able to configure and disable warnings by
their type. How far does that reach?

## Options

- **(a) The owner's note, generalized.** Chosen. A user can disable or change warnings by type, and the configuration can set
  the severity of an issue code (off, warning, error) within limits that the issue-code appendix defines.

Other options: Not recorded.

## Decision

(a). A user can disable or change warnings by type. This generalizes, so the configuration can set the severity of an issue code
(`off`, `warning`, `error`) within limits that the issue-code appendix defines (the `issues` member of §9.1). The log records it
as "the owner's note on C7"; the note is on F3, the card that asked C7 again.

## Why

Not recorded.

## Owner's note

> Issuing warning by default sounds good. A user should be able to  configure and disable warnings by their type (and explicitly
> disabling of quoting such strings should also disable that warning).

## Applied in

Draft v0.4 (#50, `1043a6c`), §9.1 and Appendix D. G6, from the review of #50, kept the draft's limits: validation errors cannot
be lowered.
