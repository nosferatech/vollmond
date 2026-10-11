---
id: plan-4
title: "The implementation plan details phases I0 to I3"
round: "planning"
date: "2026-10-09"
status: accepted
sections: ["§21"]
decided_by: owner
sources:
  log: "Decisions from planning the implementation"
  chat: ["2026-10-09T23:02:07Z"]
  commits: ["5b0819b"]
---

## Question

How detailed should the implementation plan be?

## Options

- **(a) I0 to I3 in detail.** Chosen, as recommended. Repository layout, packages, tooling and a task-level breakdown for the spec
  and suite, Read, Validate and Query; I4 to I8 stay at the level of §21 and get detailed when I3 is nearly done.
- **(b) All phases in detail.** A task-level breakdown for I0 through I7 now, with more to revise later as the early phases teach
  things.

## Decision

(a). The implementation plan (`docs/plan/implementation-plan.md`) details phases I0 to I3; I4 to I8 are planned when I3 is nearly
done.

## Why

Not recorded. The owner chose the recommended option without a note. The question gave each option's consequences, above.

## Applied in

`5b0819b`: `docs/plan/implementation-plan.md`, with 33 tasks across I0 to I3, each meant to become a GitHub issue.
