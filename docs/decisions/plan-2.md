---
id: plan-2
title: "int64: a number within the safe range, a decimal string beyond it"
round: "planning"
date: "2026-10-09"
status: accepted
sections: ["§4.3"]
decided_by: owner
sources:
  log: "Decisions from planning the implementation"
  chat: ["2026-10-09T23:02:07Z"]
  commits: ["5b0819b"]
---

## Question

Which canonical form does int64 take? Open question 4 of Draft v0.3.

## Options

- **(a) A number if safe, else a string.** Chosen, as recommended. Numbers within ±(2^53−1) stay numbers, readable in YAML front
  matter; larger ones are decimal strings. Readers accept both forms.
- **(b) Always a string**, as Protocol Buffers' JSON mapping: one form and no threshold, but `size: "12345"` in front matter.

## Decision

(a). int64 is a number within ±(2^53−1), a decimal string beyond it; readers accept both (open question 4 of v0.3, now closed).

## Why

Not recorded. The owner chose the recommended option without a note. The question gave each option's consequences, above.

## Applied in

`5b0819b`, §4.3.
