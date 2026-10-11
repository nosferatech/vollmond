---
id: i1-read-4
title: "The conformance runner reads case files independently of the code under test"
round: "i1-read"
date: "2026-10-11"
status: accepted
decided_by: design
sources:
  design: ["docs/design/i1-read.md §6"]
  prs: [69, 71]
  issues: [70]
  commits: ["01cfc41"]
---

## Question

How does the conformance runner read its JSON case files, so that a bug in `core`'s JSON parser or digest cannot hide itself, and
so that a case file with escaped member names is not misread?

## Options

- **(a) Build the case files' values from `jsonc-parser`'s `parseTree` in strict mode, in one walk that applies §4.2 to each
  number's text and finds duplicate names; `JSON.parse` only checks the syntax, and `core`'s code is not used.** Chosen.
- **(b) `JSON.parse` with a reviver reading `context.source`**, the design's first version (parser survey, section 3.3), with
  `jsonc-parser` only to detect duplicates.

## Decision

(a). Case files are read by building their values from `jsonc-parser`'s `parseTree` in strict mode; `JSON.parse`'s value is not
used. `core`'s code is not used, though `jsonc-parser` is shared. Versions manifests are checked with `node:crypto`, and the
comparison is the runner's own, checked by the `selftest` cases.

## Why

The design's reason: Node 24.21.0's `JSON.parse` can misread an escaped member name (#70), so a case file with one could be
misread silently by (b). #70 records the reproduction: after a first parse, `JSON.parse` returns `"\\"` for the member name
`"\n"` in an object of the same shape, apparently from state the first parse left behind. Independence from `core` means a bug
in `core`'s JSON parser or digest cannot hide itself.

## Applied in

The runner and the design's section 6, in #71 (`01cfc41`).
