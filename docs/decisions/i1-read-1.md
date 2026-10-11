---
id: i1-read-1
title: "JSON is parsed with `jsonc-parser`, not a parser of vmd's own"
round: "i1-read"
date: "2026-10-10"
status: accepted
sections: ["§5.4"]
decided_by: design
sources:
  design: ["docs/design/i1-read.md §3.2"]
  prs: [59, 69]
  commits: ["fbf0cc0"]
---

## Question

Which parser reads JSON files and `json data` blocks, so that vmd gets offsets, several errors and the checks its rules need?

## Options

- **(a) `jsonc-parser` 3.3.1, through `parseTree` with `disallowComments: true`, `allowTrailingComma: false` and
  `allowEmptyContent: false`.** Chosen. It recovers and reports several errors, with cascades; it rejects `NaN`, `+1`, `.5`,
  `01`, a raw control character, a trailing comma, the empty file and a BOM; it does not check duplicate members or lone
  surrogates, which vmd's walk then raises.
- **(b) A parser of vmd's own over UTF-8 bytes**, which would give byte offsets directly.

## Decision

(a): `jsonc-parser` 3.3.1, the current release and the one the parser survey measured, with those options. Its errors become
positions in the unit's one `syntax-error`, the walk raises `duplicate-member` and `unpaired-surrogate`, and the unit starts after
a BOM, which the library rejects.

## Why

The design's reason against (b): `jsonc-parser` is small and has no dependencies, and the offset conversion that a parser of vmd's
own would save is needed for the other formats anyway.

## Applied in

The phase I1 design (#59, `fbf0cc0`), its section 3.2; the JSON parser (#69, `d6db616`).
