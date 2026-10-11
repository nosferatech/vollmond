---
id: i2-validate-1
title: "Keyed lists are evaluated natively, with the standard compilation as a test oracle"
round: "i2-validate"
date: "2026-10-11"
status: accepted
sections: ["§9.3"]
decided_by: design
sources:
  design: ["docs/design/i2-validate.md §3.3", "docs/design/i2-validate.md §10"]
  prs: [86]
---

## Question

§9.3 defines a member-keyed list by its compilation to standard JSON Schema 2020-12 (per-key schemas through `allOf` and
`if`/`then`, `required` through `contains`, uniqueness through `maxContains: 1`). How does core's validator evaluate
`x-vmd-list`?

## Options

- **(a) Evaluate keyed lists natively.** Chosen. Core evaluates the list itself; per-key schemas are checked through a wrapper
  whose `$ref` points into `x-vmd-list`'s `items`, which hyperjump resolves although they sit inside a keyword it does not know.
  The compilation stays the definition: a property test runs the validator over the compiled form and over core's evaluation and
  requires the same verdicts.
- **(b) Compile the declaration to standard JSON Schema** and hand the compiled schema to the validator.

## Decision

(a): keyed lists are evaluated natively, and §9.3's standard compilation becomes the oracle of a property test.

## Why

The design's two reasons: a list keyed by `@key` has no standard form, since the key is not in the instance, so a native
evaluation exists anyway; and a duplicate must be `duplicate-key` at the second item, not a `schema-violation` from a
`maxContains` that a reader cannot connect to its cause. The design notes that 2020-12 leaves a reference into an unknown keyword
to each implementation, and that only hyperjump was probed for it; with another validator core would compile each per-key schema
as a document of its own.

## Applied in

The design of phase I2 (#86), approved with [I2-design](I2-design.md). [U16](U16.md) makes `unevaluatedItems` beside
`x-vmd-list` `schema-invalid` rather than bring the compilation back.
