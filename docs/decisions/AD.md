---
id: AD
title: "A `$` step from a section names the section's own member, so `#summary/$body` is singular wherever the section is"
round: "AD"
date: "2026-10-12"
status: accepted
sections: ["§7.4", "§7.5"]
decided_by: owner
sources:
  card: "AD"
  design: ["docs/design/i2-validate.md, section 4.4"]
  prs: [108, 117]
  commits: ["4207389"]
---

## Question

From the keyed-lists pull request (#108), which implements the proof that an address names one node (§7.4). The card: "A schema
can declare that a level of sections may repeat keys (`multimap`), as in a journal where several entries share a heading. An
address that steps through such a level is refused, and that's intended: `#log/entry` could mean any of several entries. The I2
design's rule is that every place a step could reach counts. PR #108 (keyed lists) implements it, and it refuses more than
intended. In a journal whose root sections all allow repeated children, `#summary/$body` and `#entry-1/$body` are refused too.
The schema can't rule out that `summary` has repeated child sections, and the proof treats `$body` like any step that could reach
one of them. But a section key can never begin with `$`: headings' slugs drop it, and an anchor must start with a letter. So
`$body` can only ever be the section's text, never a child section." Left as it is, "such a section's text gets only the
positional address `#/$sections/1/$body` as its canonical address, and once typed references land, a link like `#done/$body`
there becomes `ref-ambiguous`."

## Options

- **(b) A `$` step from a section means the section's own member.** Chosen, as recommended. The card: "`#summary/$body` and
  `$title` steps are singular wherever the section itself is. A small change in #108's proof (the check for repeatable levels has
  to look at the step, not only at the position); the I2 design's rule gets that sentence. Still a proof from the schema alone."
- **(a) Keep the design's rule.** The card: "#108 as is. Text and titles under repeatable levels have only positional canonical
  addresses, and links to them by name are ambiguous."
- **(c) As (b), and also look up the first step's matches in the record.** The card: "`#summary/x` continues only from the
  Summary section that actually exists. Fewer refusals, but the proof reads the data for more than anchors, which widens the
  design's reading R4 (the proof looks only the first step's anchors up in the record)."

## Decision

(b): a step from a section that begins with `$` names the section's own member and crosses no level, so `#summary/$body` and a
`$title` step are singular wherever the section itself is. §7.4 states it with #117's design sentence: `$sections` is the
section's own member too, but the step after it is a key of the child sections and crosses their level, and a `$` step into a
keyed list of data is a key like any other, since a key member may hold any string. The proof still works from the schema alone.

The review of #108 found the one way a section key can begin with `$`: an invalid explicit anchor, `"$anchor": "$body"` or
`<a id="$body"></a>`, which still becomes its section's key with `anchor-invalid`. §7.4's list of the cases the proof cannot cover
names it, beside the other data that breaks a rule the proof relies on: `#a/$body` is then ambiguous when it is evaluated.

## Why

The card's reason: "It removes the false refusal for every `$body` and `$title` using a fact that holds for all valid data, and
keeps the proof schema-only. The independent review of #108 checked it: a section key starting with `$` arises only from an
invalid explicit anchor, which is already an error. (c) changes what the proof is; nothing needs it yet."

Why (a) lost: Not recorded. The card's consequence for it: text and titles under repeatable levels have only positional canonical
addresses, and links to them by name are ambiguous. Why (c) lost: the card's reason above, that it changes what the proof is and
nothing needs it yet.

## Applied in

Draft v0.15: §7.4 (the `$` step, and the invalid anchor that begins with `$` among the cases the proof cannot cover) and §7.5's
form 3, which lists the same cases. The code and the I2 design's sentence in section 4.4 are #117 (`4207389`). Suite cases in
`addresses/cardinality`: `multimap-section-body-singular` and `multimap-section-title-singular`, with their near misses
`multimap-name-step-after-section-not-singular` and `multimap-repeated-section-body-not-singular`; and
`dollar-anchor-ambiguous-json`, `dollar-anchor-ambiguous-md` and `dollar-anchor-check`, with the near miss
`valid-anchor-body-singular`. #117's code passes every one of them.
