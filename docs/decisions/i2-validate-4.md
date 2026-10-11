---
id: i2-validate-4
title: "An incremental check re-resolves every reference"
round: "i2-validate"
date: "2026-10-11"
status: accepted
sections: ["§14.3"]
decided_by: design
sources:
  design: ["docs/design/i2-validate.md §6.4", "docs/design/i2-validate.md §9"]
  prs: [86]
---

## Question

The plan's task I2.5 gives the local index "re-parsing only changed files and re-resolving only the references into them". What
does a check that uses the cache re-resolve?

## Options

- **(a) Every reference, over the cached structures.** Chosen. Resolution over parsed structures costs 14 to 19 ms for
  vampiredb's 1,965 references, less than reading a cached result would, and needs no record of what each result depended on.
- **(b) Only the references into changed records, as the plan said**, with results cached together with their dependencies.

## Decision

(a): a check that uses the cache re-parses nothing unchanged and re-resolves every reference of the records in scope against the
structures of their targets, restored from entries. A property test checks that a check with the cache reports exactly the issues
of a check without it.

## Why

The design's reason: re-resolving everything costs less than reading cached results would, and it needs no record of what each
result depended on, which (b) would.

## Applied in

The design of phase I2 (#86), approved with [I2-design](I2-design.md); task I2.5 of the plan is simplified accordingly.
