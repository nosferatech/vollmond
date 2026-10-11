---
id: i1-read-3
title: "vmd reads front matter itself, without the front-matter extension"
round: "i1-read"
date: "2026-10-10"
status: accepted
sections: ["§5.3"]
decided_by: design
sources:
  design: ["docs/design/i1-read.md §3.4"]
  prs: [59, 79]
  commits: ["fbf0cc0"]
---

## Question

The plan's §1.2 first named a front-matter extension for the Markdown parser. Does vmd use `micromark-extension-frontmatter` to
find front matter?

## Options

- **(a) No: vmd finds the front matter itself, before the Markdown parser runs.** Chosen. After a BOM at byte 0, a delimiter line
  is `---`, then spaces or tabs, at the very start, and the block ends at the next delimiter line; unclosed is `syntax-error`.
- **(b) `micromark-extension-frontmatter`.** Whether it can be made to follow vmd's rule was not checked.

## Decision

(a): `micromark-extension-frontmatter` is not used. vmd's own rule (§5.3, [H3.4](H3.4.md), [I1.4](I1.4.md)) finds the block, which
is a YAML unit, and the body unit is the text after the BOM and the front matter.

## Why

The design's reason: vmd's rule is its own, since an unclosed block is an error and a BOM is skipped (§5.3), and the rule is a few
lines to write. Whether the extension could be made to follow it was not checked.

## Applied in

The phase I1 design (#59, `fbf0cc0`), its section 3.4, and the plan's §1.2; the Markdown parser (#79, `138f788`).
