---
id: AO
title: "The proof that an address names one node looks its first step up in the record"
round: "AO"
date: "2026-10-20"
status: accepted
supersedes: [AD.md]
sections: ["§7.4", "§8.5", "Appendix D"]
decided_by: owner
sources:
  card: "AO"
  design: ["docs/design/i2-validate.md, section 4.4", "docs/design/i2-validate.md, section 11, reading R4"]
  prs: [133, 147]
---

## Question

The card: "Before vmd follows a link, it proves from the schema that the link can only name one thing; otherwise the link is
`ambiguous`. A link's first step may match a top-level member or an anchor anywhere in the record (§7.3). In a journal whose
top-level sections are declared to allow repeated keys (`multimap`), the schema can't rule out two top-level sections both called
`done`, so even `journal/j.md#done`, written to reach the one node with the explicit anchor `done`, is `ambiguous`. So is
`#done/$body`. Only positional paths (`#/$sections/3`) get through."

"This was always the rule (§7.4), but with #133 (links now go through the schema) `vmd check` reports every such link as an
error. Your AD answer let `$body` and `$title` steps through, one level down; it kept the proof from reading the record beyond its
anchors, because "nothing needs it yet". This needs it. The independent review of #133 found it." [AD](AD.md) is that answer.

The card's example: "`j.md` has `## Done <a id="done"></a>` and later `## Monday`, `## Monday` (repeats allowed). A link
`j.md#done`."

## Options

- **(b) Check the first step against the record itself.** Chosen, as recommended. The card: "The proof looks the first step up in
  the record: if it names exactly one node there (an explicit anchor that no top-level key repeats, or a unique top-level key),
  it's singular; the rest of the address is still proved from the schema. `#done` and `#done/$body` work; `#monday` stays
  ambiguous. It widens the proof's reading of the record (decision R4) from anchors to the first step's matches." The "decision
  R4" of the card is reading R4 of the I2 design (`docs/design/i2-validate.md`, section 11: the proof of §7.4 looks the first
  step's anchors up in the record, then works from the schema alone), not the decision record [R4](R4.md), which is about
  percent-escapes.
- **(c) An explicit anchor always wins at the first step.** The card: "If the first step is an explicit anchor of the record, it
  names that node, whatever top-level keys exist. Simple to explain, but it changes §7.3's rule that a first step matching both
  an anchor and a top-level member is ambiguous."
- **(a) Keep it: use positional paths there.** The card: "As today. Links into such journals must use exact paths, which break
  when sections are reordered; the error's hint is fixed to say so instead of suggesting an explicit anchor."

## Decision

(b): the proof of §7.4 looks an address's first step up in the record. A first step that names exactly one node there, such as an
explicit anchor that no top-level key repeats, or a top-level key that is unique in the record, is singular whatever the root's
level declares; the rest of the address is proved from the schema, from that node. `j.md#done` and `#done/$body` are singular in
the card's journal, and `#monday` is not. It widens the I2 design's reading R4, under which the proof read only the record's
anchors, to every name a first step reaches.

It takes up the lookup that AD's option (c) proposed and AD left aside because "nothing needs it yet", and so amends AD's "The
proof still works from the schema alone" in the same direction, fewer false refusals; this record supersedes AD on that point.
AD's rule for a `$` step from a section stands, and is still proved from the schema alone. The decision record R4 is not touched.

**Agent's reading, for the owner to confirm.**

1. A first step that names no node of the record, or several, is proved from the schema as before, so `#monday` is not singular
   in the card's journal, and in a store whose root level is a `type: map`, a first step that matches a root member and another
   node's anchor still passes the proof and is ambiguous when evaluated (§7.4's second case the proof cannot cover). #147 reads
   it the same way (its reading 1) and names a cost: in such a journal a first step that names no node, `#typo`, is `ambiguous`
   rather than `dangling`, so an anchor alias never applies to it; after `done` is renamed to `finished`, `#done` stays
   `ambiguous` instead of following the alias, as before this decision.
2. "Names exactly one node" counts every name a first step reaches (§7.3): root members, the root's child sections by key,
   section members, and anchors, explicit and derived. The card's parenthesis gives two examples; a derived anchor that names
   one node, such as `#monday-1`, is singular by the same rule.
3. AO supersedes AD rather than leaving it standing as [AH](AH.md) left [AC](AC.md): AD's decision says the proof works from the
   schema alone, which AO changes, as [AC](AC.md) superseded [W4](W4.md) for one of its items. It does not supersede [U3](U3.md),
   whose rule, that a reference the proof cannot make singular through a `multimap` level is `ambiguous`, stands; AO changes what
   the proof can make singular.

## Why

The card's reason: "It keeps every rule as written (§7.3's ambiguity still applies when the data really is ambiguous) and makes
explicit anchors, the stable way to link, work in exactly the journals that need them."

Why (c) and (a) lost: the card's reason above. Its consequences: (c) changes §7.3's rule that a first step matching both an
anchor and a top-level member is ambiguous; under (a), links into such journals must use exact paths, which break when sections
are reordered.

## Owner's note

The project owner chose (b) on the review desk on 2026-10-20, with no note.

## Applied in

Draft v0.16 (#148): §7.4 (the first step looked up in the record, the journal example, and the `$` step's part of the proof
needing only the schema), §8.5 (a first step that names one node), Appendix D `ref-ambiguous`; [AD](AD.md)'s record. The code,
with the I2 design's section 4.4 and its suite cases, is #147, which reads the record only where the schema cannot prove the first
step; the result is the same, since a first step the schema proves singular needs no lookup (its reading 4).
