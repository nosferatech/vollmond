---
id: i1-read-2
title: "Markdown uses GFM 0.29's four extensions, not the GFM bundle with footnotes"
round: "i1-read"
date: "2026-10-10"
status: accepted
sections: ["§5.3", "§8.1"]
decided_by: design
sources:
  design: ["docs/design/i1-read.md §3.4"]
  prs: [59, 79]
  commits: ["fbf0cc0"]
---

## Question

§5.3 pins GitHub Flavored Markdown 0.29, and the plan's §1.2 first named "the GFM and front-matter extensions" for the Markdown
parser, `mdast-util-from-markdown` 2.1.0 over `micromark` 4.0.3. Which GFM extensions does vmd load?

## Options

- **(a) Exactly GFM 0.29's extensions, tables, strikethrough, task list items and autolink literals, as the separate
  `micromark-extension-gfm-*` and `mdast-util-gfm-*` packages.** Chosen.
- **(b) The `micromark-extension-gfm` bundle**, which adds GitHub's footnotes, which GFM 0.29 does not have.

## Decision

(a). Under the pin, `[^1]: target.md` is a link reference definition, and so a reference (§8.1).

## Why

The design's reason: footnotes change block structure. Under GFM 0.29 `[^1]: target.md` is a link reference definition, and so a
reference (§8.1); with the bundle it is a footnote definition (measured). The pin costs nothing today: vampiredb's Markdown has no
footnote definitions (measured, by a search for `[^…]:` lines).

## Applied in

The phase I1 design (#59, `fbf0cc0`), its section 3.4, and the plan's §1.2; the Markdown parser (#79, `138f788`).
