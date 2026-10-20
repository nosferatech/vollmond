---
id: AP
title: "A first step that names no node of the record is proved, so the link is dangling and anchor aliases apply"
round: "AP"
date: "2026-10-20"
status: accepted
supersedes: [AO.md]
sections: ["§7.4", "§8.5", "§13.6", "Appendix D"]
decided_by: owner
sources:
  card: "AP"
  design: ["docs/design/i2-validate.md, section 4.4"]
  prs: [147, 154]
---

## Question

A follow-up to [AO](AO.md), under which the proof that a link names one node looks the link's first step up in the record. The
card: "A link's first step is now looked up in the record when the schema alone can't prove it names one node, and the step is
accepted when it names exactly one. Open: what if it names none?"

"As written now (taking the card's "exactly one" literally), naming none counts as not provably single, so the link is
`ambiguous`. That has two effects in such journals:
- a typo `j.md#tpyo` is reported as `ambiguous` with a hint to use an explicit anchor, not as `dangling` (a link to nothing);
- old names never apply, since vmd follows aliases only for a `dangling` link. After `## Done <a id="done"></a>` is renamed to
  `finished` (alias `done` → `finished`), `#done` is `ambiguous` instead of reaching `finished`. Explicit anchors were the stable
  way to link that AO meant to make work there."

"The draft's §13.6 says a first step that "reaches no name of the record" follows the record's anchor aliases, and your AL answer
let a many-valued reference follow them in the same journal. Both independent reviewers (of the AO code and of Draft v0.16) read
the rules as pointing to `dangling`." [AL](AL.md) is that answer; "As written now" is AO's reading 1, which #147 implemented and
Draft v0.16 stated in §7.4 and §13.6, labelled for the owner.

The card's example: "journal `j.md` with repeatable top-level sections, alias `done` → `finished`. Link `j.md#done`."

## Options

- **(b) Names none: not ambiguous, so `dangling`, and aliases apply.** Chosen, as recommended. The card: "`#tpyo` is `dangling`;
  `#done` after the rename is `aliased` and reaches `finished`. One line in the proof, plus its tests; the draft states it in
  §7.4 and §8.5. A link that names nothing can't name two things, so the proof's promise still holds."
- **(a) Keep it: names none is `ambiguous`.** The card: "As the AO pull request and Draft v0.16 now have it, labelled for you to
  confirm. A renamed explicit anchor in such a journal breaks its links, and a typo reads as an ambiguity. The draft says the
  proof's result wins over §13.6 there."

## Decision

(b): a first step that names no node of the record counts as proved. Evaluation then finds no node, so the address is
`address-not-found`, a reference written with it is `dangling`, and the anchor aliases of §13.6 apply to it. In the card's
journal, `#tpyo` is `dangling`, and `#done` after the rename is `aliased` and reaches `finished`; `#monday`, over two Mondays,
stays `ambiguous`.

This decides against AO's reading 1, which kept such a step not singular and which Draft v0.16 stated with the words "The proof's
result comes first". That reading was labelled for the owner, not decided, but AO's record and Draft v0.16 applied it; AP changes
what AO's lookup accepts in the same direction, fewer false refusals, so it supersedes AO. AO's rule for a first step that names
exactly one node stands.

**Context from the engineering manager.** The owner's note asks a question (below). The engineering manager answered it in the
conversation: "Yes. … one nuance: past the first step, a step through a level that may repeat is ambiguous even if the record has
one match today, since the schema says it could have more." That answer is the engineering manager's, not the owner's. Draft v0.17
states the nuance in §7.4, where it was already the rule for later steps.

**Agent's reading, confirmed by the owner on [W10](W10.md) (2026-10-20), its item 1.** A first step that names no node makes the
whole address proved, whatever steps follow: nothing in the record is there to prove them from, and evaluation finds nothing at
the first step, so `#tpyo/later` is `dangling` like `#tpyo`. An alias on `tpyo` applies to it, and the address it leads to is
proved again from its first step. This is #154's reading 1, and Draft v0.17 states it in §7.4.

## Why

The card's reason: "It keeps the proof's purpose (never follow a link that could name two places) and §13.6's alias rule both
true, and makes renamed explicit anchors work in the journals AO was for."

Why (a) lost: the card's reason above. Its consequences for (a): a renamed explicit anchor in such a journal breaks its links,
and a typo reads as an ambiguity.

## Owner's note

On the card, choosing (b):

> A link that expects exactly one match: when finds 0 matches is dangling, when finds more than 1, is ambiguous, right?

## Applied in

Draft v0.17 (#155): §7.4 (a first step that names no node is proved, the journal example, and the nuance for later steps), §8.5
(the exceptions at the first step), §13.6 (the example of `#done` after a rename), Appendix D `ref-ambiguous`; [AO](AO.md)'s
record. The code, with the I2 design's section 4.4 and suite cases in `addresses/cardinality` and `references/aliases`, is #154.

Draft v0.19: card [W10](W10.md) confirmed the reading above (item 1); the draft's text keeps it as written.
