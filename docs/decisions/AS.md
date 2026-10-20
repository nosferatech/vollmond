---
id: AS
title: "Whether the strict read mode refuses a record for `ref-target-not-allowed` is the implementation's choice"
round: "AS"
date: "2026-10-20"
status: accepted
supersedes: [G7.md]
sections: ["§9.5", "Appendix D"]
decided_by: owner
sources:
  card: "AS"
  prs: [151]
---

## Question

The card: "In the strict read mode, a reader refuses a record that breaks its schema. Your G7 answer limited that to structural
errors and schema violations, so that "a broken link elsewhere or a style warning never hides a record". Since Draft v0.4, the
draft has also counted `ref-target-not-allowed` as a schema violation: a typed link (a schema field marked `x-vmd-ref`) that
points where its declaration forbids. No card decided that." [G7](G7.md) is that answer; Draft v0.4 (`1043a6c`) wrote §9.5's list
of the codes the mode refuses when it applied G7.

"The pull request that adds the refusal (#151, open) found the conflict. Whether such a link is allowed often depends on the other
record, not on the citing one:
- under `anchors: explicit`, retitling the target's heading or removing its explicit anchor makes the link go through a title;
- moving the target record (a record alias) can take it outside the allowed `targets`;
- a second collection claiming the target makes it match no `targets` entry.

So a change in the other record would hide the citing record from strict readers, which is what G7 ruled out. Other breaks are in
the citing record's own text: a positional step such as `#/$sections/2` under `anchors: explicit`, or a written path outside
`targets`."

The card's example: "`tasks/t.yaml` has `owner: "people/ana.md#lead"` with `anchors: explicit`. Someone deletes
`<a id="lead"></a>` in `ana.md`, so the link now reaches `## Lead` by its title. Should strict reads of `t.yaml` start failing?"

## Options

- **(c) Refuse only breaks in the record's own text.** Recommended. The card: "A positional step under `explicit`, or a written
  target path outside `targets`, refuses the record; a break that depends on the target (its headings, a move, a collection
  claim) is reported by `vmd check` but hides nothing. Both of G7's promises hold. #151 is narrowed, and the draft's §9.5 says
  which part refuses. Two kinds of the same code, which the docs must explain."
- **(b) Don't refuse it in strict mode at all.** The card: "Simplest: the code leaves §9.5's list, #151 is closed, and `vmd check`
  reports every such link. A strict reader can then get a record whose own data breaks its link rules, such as `#/$sections/2`
  under `explicit`."
- **(a) Refuse every case, as the draft says.** The card: "#151 merges as written. The one exception to G7's "a change elsewhere
  never hides a record": a retitle or a move in another record can hide a record from strict readers."
- **Other.** Chosen, with the note below.

## Decision

Other, as the owner's note says: a `ref-target-not-allowed` is treated as data corruption, for which vmd promises neither to
detect every case and fail nor to handle it gracefully and succeed. What a strict reader does with a record whose typed reference
breaks its declaration is the implementation's choice, and vmd chooses "the simplest most consistent implementation behavior".
Which behaviour that is, the note does not say; the engineering manager's reading below is what Draft v0.17 states. #151, which
added the refusal, was closed unmerged.

**Agent's reading, the engineering manager's, confirmed by the owner on [W10](W10.md) (2026-10-20), its item 3.** In the
engineering manager's comment closing #151: "The simplest and most consistent behaviour for this implementation is not to refuse
`ref-target-not-allowed` in the strict read mode: it keeps decision G7's "a change elsewhere never hides a record", needs no code,
and `vmd check` still reports every such link." Draft v0.17 states it in §9.5: a strict reader need not refuse such a record, nor
return it, since that is the implementation's choice, and vmd returns it while `vmd check` reports the reference.

This amends [G7](G7.md) in the same direction, as [AA4](AA4.md) amended [U2](U2.md) and [AO](AO.md) amended [AD](AD.md): G7's
option, "A strict reader gets only records whose data conforms to the schema", no longer holds for `x-vmd-ref`, since §9.5's list
of the validation codes that count as schema violations for the mode, which Draft v0.4 wrote when it applied G7, loses
`ref-target-not-allowed`. So this record supersedes G7. G7's rule, that the strict mode refuses structural errors and schema
violations only, and its reason, "a broken link elsewhere or a style warning never hides a record", stand for every other code.

## Why

The owner's note: "This is a data corruption issue, so I’d suggest we go with simplest solution", and "Corruption like this I
think can have implementation chosen behavior and we choose the simplest most consistent implementation behavior".

Why (a), (b) and (c) lost: Not recorded. The card's consequences: under (a), a retitle or a move in another record can hide a
record from strict readers; under (b), a strict reader can get a record whose own data breaks its link rules; (c) needs two kinds
of the same code, which the docs must explain.

## Owner's note

On the card, choosing Other:

> I’m not sure. This is a data corruption issue, so I’d suggest we go with simplest solution. For data corruption I think we don’t have to promise that we detect all corruption cases and fail, and we also don’t need to promise that we will gracefully handle it or succeed. Corruption like this I think can have implementation chosen behavior and we choose the simplest most consistent implementation behavior

## Applied in

Draft v0.17 (#155): §9.5, item 4 (`ref-target-not-allowed` leaves the codes the mode refuses, and a strict reader need not refuse
such a record), Appendix D `ref-target-not-allowed`; [G7](G7.md)'s record, now superseded. The strict read mode's code (#146)
already leaves the code out; its comment `TODO(#24)` in `js/packages/core/src/store/store.ts`, which says the mode refuses it too,
stays until a code change removes it.

Draft v0.19: card [W10](W10.md) confirmed the engineering manager's reading (item 3); the draft's text keeps it as
written.
