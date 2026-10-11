---
id: i2-validate-2
title: "The logical types are vmd's own checks"
round: "i2-validate"
date: "2026-10-11"
status: accepted
sections: ["§4.3", "Appendix C"]
decided_by: design
sources:
  design: ["docs/design/i2-validate.md §3.4"]
  prs: [86]
---

## Question

§4.3 gives each standard logical type its lexical space (dates and times, duration, int64, bigint, decimal), and the decision log
had already found that common validators depart from it ([I1.13](I1.13.md), [J1](J1.md)). What checks the formats when a schema
declares them?

## Options

- **(a) vmd's own checks**, in `schema/logical-types.ts`. Chosen. Each check is a small grammar over the string that returns the
  value's parts, so that I3 compares by instant without parsing again. `uri`, `uri-reference`, `email` and `uuid` use
  `@hyperjump/json-schema-formats`' functions, which agree with every identifier case of the suite. Every other format name stays
  an annotation.
- **(b) `ajv-formats`.** It departs from §4.3: it accepts a space separator and the offsets `+02` and `+0200`.
- **(c) `@hyperjump/json-schema-formats` for dates and times.** It refuses `23:59:60Z` and `01:59:60+02:00`, which J1 accepts.
- **(d) `Date.parse`.** Never used: its reading of other formats is implementation-defined (ECMAScript 2025, section 21.4.3.2).

## Decision

(a): core implements §4.3's lexical spaces itself, never through `Date.parse`, and registers format handlers for exactly the
names of §4.3's table, without loading the library's own format module.

## Why

The design's reasons: neither `ajv-formats` (b) nor `@hyperjump/json-schema-formats` (c) can be used for dates and times, since
each departs from §4.3 as stated in the options, and `Date.parse` (d) reads other formats in an implementation-defined way. The
checks return the value's parts for I3's comparisons.

## Applied in

The design of phase I2 (#86), approved with [I2-design](I2-design.md); task I2.2. That vmd needs its own date and time checks was
already stated in §4.3 and Appendix C when I1.13's reason was corrected.
