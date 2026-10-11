---
id: plan-3
title: "vollmond's own work is tracked in GitHub issues"
round: "planning"
date: "2026-10-09"
status: superseded
superseded_by: [plan-3a.md]
decided_by: owner
sources:
  log: "Decisions from planning the implementation"
  chat: ["2026-10-09T23:02:07Z"]
  session: ["2026-10-09T22:53:23Z"]
  commits: ["5b0819b"]
---

## Question

Where is vollmond's own work tracked while it is built?

## Options

- **(a) `tickets/` as vmd records.** The session's recommendation: dogfood, with tickets in this repository in the format the
  spec defines, validated by vmd from phase I2 on and queried from I3; the plan's tasks become the first tickets.
- **(b) GitHub issues.** Chosen. Zero setup and visible to outside contributors of a public repository, but not the format being
  built, so no dogfooding.
- **(c) The plan document only**: phases and tasks as checklists, with no record per task.

## Decision

(b). vollmond's own work is tracked in GitHub issues, not as vmd records: outside contributors and bug reporters already have
access there, and a ticket store of its own would need access control. vampiredb and Belfry dogfood vmd for their tickets.

## Why

The owner's reasons against the recommended (a): it would need machinery for access control for tickets, and GitHub suits
potential public contributors and people reporting bugs; vampiredb and Belfry dogfood vmd for tickets instead. Why (c) lost: Not
recorded.

## Owner's note

> That's a very interesting question. I think it's better to stick to github issues though. As otherwise we will need machinery
> for access control for tickets, and that seems like a pain. With potential public contributors or just people reporting bugs,
> GitHub is probably better. vampiredb and belfry will be "dogfooding" vmd for tickets.

## Applied in

`5b0819b`: the plan's tasks became milestones I0 to I3 and issues #2 to #36, and `AGENTS.md` points to GitHub issues.
[plan-3a](plan-3a.md) added a place for internal tickets.
