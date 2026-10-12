---
id: AF
title: "A keyed list's `additional` against the array's `items` still waits for the record"
round: "AF"
date: "2026-10-12"
status: accepted
sections: ["§9.3"]
decided_by: owner
sources:
  card: "AF"
  design: ["docs/design/i2-validate.md, section 3.3"]
  prs: [115, 118]
---

## Question

The card, first asked: "A keyed list (x-vmd-list) gives each item a schema by its key: one per listed key, and `additional` for
any other key. The array's own `items` and `prefixItems` also apply to every item, by its position. If two of these declare vmd's
keywords differently (for example two different typed references), an item gets both and they conflict." For a listed key the
check refuses such a schema at load, and #115 extends that to every position; for `additional` it does not. "The design and the
draft don't say which treatment `additional` should get."

That premise was wrong. The card, asked again: "You confirmed it in AA4 item 4, and Draft v0.14 (#105, which you just approved)
states it in §9.3: this meeting waits for the record, it is not refused at load. Its author and I both read main's older draft.
The independent review of the code for your answer (#118) caught it." And: "So the rule you already have: whatever the schema
names (a listed property name, a listed key) is checked at load; whatever only the data's names bring (unlisted names and keys) is
checked per record. #115 fits it: it is about listed keys. #118 would break it." See [AA4](AA4.md), item 4.

## Options

As the card was asked again:

- **Keep AA4 item 4.** Chosen, as recommended. The card: "The meeting stays a record-level problem, as v0.14 says. #118 is
  closed unmerged. Nothing else changes."
- **Refuse at load after all (your first AF answer).** The card: "AF supersedes AA4 item 4 in part: a new record, §9.3's sentence
  and two conformance cases change, and #118 lands after #105. For consistency, the other case AA4 moved to the record, two
  unequal additionalProperties in an allOf, would then likely need the same change; that would be its own card."

As the card was first asked:

- **(a) Refuse the schema at load.** Recommended then, and the owner's first answer. The card: "Treated like the listed keys: the
  conflict doesn't depend on which unlisted key the data uses, only that there is one. A schema is refused even if its data never
  has an unlisted key. A small change in #115, failing test first."
- **(b) Keep it a record-level problem, as today.** The card: "The schema loads; only a record with an unlisted key at that
  position gets a schema-violation on that item, the same way two patterns that both match a member name are handled. Nothing is
  refused at load. The design and §9.3 get a sentence saying so; no code change."
- **(c) Refuse only when a key listed elsewhere would land in it.** The card: "Mirrors how the check treats member names that
  only patterns or additionalProperties take: it refuses only when the schema itself names a key that would fall to `additional`.
  Otherwise as (b). More code, and harder to explain."

## Decision

Keep AA4 item 4: `additional` meets the array's `items` or a `prefixItems` entry only at an item whose key the list's `items`
does not name, which the data decides, so the meeting is reported on the record and the schema loads. A per-key schema, which the
schema names, still meets them at load (#115). Nothing in the draft's rule changes, and #118 is closed unmerged. AF does not
supersede AA4; it asked AA4's item 4 again, and the owner kept it.

## Why

The card's reason, asked again: "AA4's rule is one line a schema author can apply (named in the schema: at load; brought by the
data: per record), and it refuses fewer schemas, which your AA1 note weighs heavily. My earlier recommendation of (a) rested on the
wrong premise that nothing had been decided."

Why refusing at load lost: Not recorded, beyond the reason above. The first card's reason for (a), which rested on that premise:
"The two schemas meet for every unlisted key at that position, whichever key it is, so the schema itself already shows the
conflict. That is the design's own test for refusing at load. A schema like this can never hold such an item correctly, so
refusing it risks little of the false refusal your AA1 note warns against. (b) is the cautious alternative: it never refuses a
schema." Why (c) lost: Not recorded.

## Owner's note

The first answer was (a), with no note. Then, in chat, on the card asked again:

> AF is showing for me as answered. So I'll write here. Let's go with your recommendation here.

## Applied in

Draft v0.15: §9.3 ("Declarations that meet") names a `prefixItems` entry beside the array's `items`, as the I2 design's section
3.3 already did, with no change to the rule; the design's sentence cites this card. AA4's record notes that AF kept its item 4.
The suite's case `validation/schemas/items-and-list-additional-meet-in-record` already pins the record-level report, and stays
skipped in the TypeScript runner's declaration until the binding of keyed lists reports the conflict (#23, #24), as AA4 says.
