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
  prs: [118]
---

## Question

Where a keyed list's `additional` schema and the array's `items`, or a `prefixItems` entry, carry unequal vmd declarations, is the
schema refused when it loads, or is the meeting flagged on the record whose item brings them together? The card's first form
said, wrongly, that the draft and the design were silent on it; the owner answered (a), "Refuse the schema at load". The review
of the code that applied the answer, #118, found that it reverses item 4 of [AA4](AA4.md), which the owner had confirmed: Draft
v0.14's §9.3 lists "an array's `items` and its `x-vmd-list`'s `additional` at an item whose key the list's `items` does not
name" among the meetings that wait for the record, since only the item's key in the data brings them together. The card was then
asked again, with two options.

## Options

- **Keep AA4 item 4.** Chosen, as recommended. The meeting stays a record-level problem: that item of that record gets a
  `schema-violation`, as §9.3 says.
- **Refuse at load after all.** The schema is `schema-invalid`, as the card's first answer would have had it, and AA4's item 4
  changes. Its consequences on the card: Not recorded.

## Decision

Keep AA4 item 4: `additional` meets the array's `items` or a `prefixItems` entry only at an item whose key the list's `items`
does not name, which the data decides, so the meeting is reported on the record and the schema loads. A per-key schema, which the
schema names, still meets them at load (#115). Nothing in the draft's rule changes, and #118 is closed unmerged. AF does not
supersede AA4; it asked AA4's item 4 again, and the owner kept it.

## Why

The engineering manager's reason on the card: "AA4's rule is one line a schema author can apply (named in the schema: at load;
brought by the data: per record), and it refuses fewer schemas, which your AA1 note weighs heavily."

Why refusing at load lost: Not recorded, beyond the reason above for the other option. Why the first answer, (a),
was not applied: the review of #118 showed that it reverses AA4's item 4, which the first card had not said.

## Owner's note

The first answer was (a), with no note. Then, in chat:

> AF is showing for me as answered. So I'll write here. Let's go with your recommendation here.

## Applied in

Draft v0.15: §9.3 ("Declarations that meet") names a `prefixItems` entry beside the array's `items`, as the I2 design's section
3.3 already did, with no change to the rule; the design's sentence cites this card. AA4's record notes that AF kept its item 4.
The suite's case `validation/schemas/items-and-list-additional-meet-in-record` already pins the record-level report, and stays
skipped in the TypeScript runner's declaration until the binding of keyed lists reports the conflict (#23, #24), as AA4 says.
