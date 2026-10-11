---
id: review-1
title: "Reading performance, structure parsing above all, is a consideration in design decisions, after correctness"
round: "review"
date: "2026-10-11"
status: accepted
decided_by: owner
sources:
  card: "PR #79"
  prs: [79]
  issues: [88]
---

## Question

In the desk review of #79, the Markdown parser, the owner observed that Markdown documents become a top-level structure holding the
data, so the performance of parsing them matters and needs research. What weight does reading performance carry in vmd's design
decisions?

## Options

- **(a) Reading performance, especially structure parsing, is a consideration for design decisions, and correctness still comes
  first.** Chosen. The owner stated it as a principle, with a research hypothesis in two items: a stream reader for Markdown,
  YAML and JSON that does not build the whole object model; and a stream reader for very fast structural reading, which
  identifies nodes and their keys and decodes contents lazily, for fast navigation and for building a navigable in-memory index
  of a document, of offset pointers that may also serve the store's index.

Other options: Not recorded.

## Decision

(a). Reading performance, and the speed of structural parsing above all, is an explicit consideration in design decisions, after
correctness. Any fast path must agree with the full parse. The research the owner's hypothesis calls for is issue #88.

## Why

The owner's reason: since Markdown documents become a top-level structure holding the data, vmd will care about the performance
of parsing them. Issue #88 lists what was measured by then: `vmd outline` on a 673 KB document takes 339 ms cold (#85), a full
parse of vampiredb's 37 documents about 0.93 to 1.25 s, micromark has a quadratic regression, and every reader builds the whole
tree.

Why the other options lost: Not recorded.

## Owner's note

> This reminds me of one thing. Since Markdown documents become a top level structure holding the data, we will care about
> performance of parsing, this is something that will require research to assess the performance of chosen parsers.
> My hypothesis is that we will need:
> 1) a stream reader for markdown (and yaml and json), to avoid building entire object model in memory
> 2) a stream reader capable of very fast structural reading that is identifying nodes and their keys, but capable of ignoring
> contents (unless explicitly asked to read something, so basically string/text decoding, number decoding is done lazily). This
> is needed for fast navigation / building a memory navigatable index of a document (which may also be of interest to the index
> that we will build, where storing K levels of offset pointers may be very helpful)
>
> This probably can go into separate ticket(s). But this also means that reading (especially structure parsing) performance
> should be a consideration for the design decisions we make (the correctness still comes first).

## Applied in

Issue #88, the research on streaming readers, lazy structural reading and a per-document index. Not applied to the draft.
