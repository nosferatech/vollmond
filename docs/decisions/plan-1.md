---
id: plan-1
title: "TypeScript for the core library, the CLI, Lambda and the browser"
round: "planning"
date: "2026-10-09"
status: accepted
supersedes: [v0.1-16.md]
sections: ["§21"]
decided_by: owner
sources:
  log: "Decisions from planning the implementation"
  chat: ["2026-10-09T23:02:07Z"]
  session: ["2026-10-09T22:53:23Z"]
  commits: ["5b0819b"]
---

## Question

Which language is the core library written in? Open question 2 of Draft v0.3; it decides the CLI, the Lambda functions and the
browser.

## Options

- **(a) TypeScript.** Chosen, as recommended. One codebase for the CLI (Node), Lambda and the browser (website VQL, previews,
  client-side validation). Python consumers use `vmd --json` or the HTTP binding first; a native Python Read and Query port can
  follow, checked by the conformance suite.
- **(b) Python.** It matches Belfry and many CI scripts. The browser still needs VQL (and probably parsing), so a second
  TypeScript implementation of at least those parts follows early.
- **(c) Both from the start.** Two implementations kept in step by the conformance suite from day one: it proves portability
  early, and roughly doubles the cost of every phase.

## Decision

(a). TypeScript for the core library, the CLI, the Lambda functions and the browser (open question 2 of v0.3, now closed).

## Why

Not recorded. The owner chose the recommended option without a note. The question gave each option's consequences, above.

## Applied in

`5b0819b` ("Implementation plan for phases I0 to I3"): §21 of the draft and the implementation plan. It narrowed the "Python
and/or JavaScript" of [v0.1-16](v0.1-16.md).
