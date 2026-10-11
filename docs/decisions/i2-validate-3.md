---
id: i2-validate-3
title: "References are collected during the Markdown parse that already runs"
round: "i2-validate"
date: "2026-10-11"
status: accepted
sections: ["§8.1"]
decided_by: design
sources:
  design: ["docs/design/i2-validate.md §5.1", "docs/design/i2-validate.md §9"]
  prs: [86]
---

## Question

Validation needs every Markdown link and link reference definition of a record (§8.1), with each destination's source range
kept for I5's rewrites. Where do they come from?

## Options

- **(a) From the parse of I1 that already runs.** Chosen. I2.4 adds two exit handlers to the mdast compiler, for
  `resourceDestinationString` and `definitionDestinationString`, that set `url` as the library's own handlers do and also keep
  the token's range; the walk that already visits every node collects `link` and `definition` nodes. On 23 inputs the tree with
  the handlers equals the tree without.
- **(b) A second, separate Markdown parse for links.** It costs as much as the record's own parse: 849 to 878 ms over vampiredb's
  docs, against 932 to 948 ms for the parse in the same runs.

## Decision

(a): references come from the parse that already runs, with each destination's range kept; a Markdown record's links need no
extra parse. Prose in JSON and YAML is parsed for references only when references are asked for.

## Why

The design's reason: a second parse (b) would cost as much as the first, and one parse per file version is what keeps the warm
check within the plan's budget (design §9).

## Applied in

The design of phase I2 (#86), approved with [I2-design](I2-design.md); task I2.4.
