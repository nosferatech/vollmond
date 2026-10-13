---
id: AA4
title: "Seven readings of schema checking from the schemas pull request are confirmed"
round: "AA"
date: "2026-10-12"
status: accepted
supersedes: [U2.md]
sections: ["§9.1", "§9.2", "§9.3", "Appendix D"]
decided_by: owner
sources:
  card: "AA4"
  design: ["docs/design/i2-validate.md, section 3.3"]
  prs: [97, 105]
---

## Question

The schemas pull request (#97) decided seven details where the spec and the owner's decisions left one open, and listed them as
readings for the owner to confirm (its readings 1, 2, 4, 5, 6, 7 and 9; readings 3 and 10 are cards [AA2](AA2.md) and
[AA3](AA3.md), and reading 8 was dropped). The card: "These seven follow from existing rules, but some of them narrow what JSON
Schema 2020-12 allows, so you should see them."

1. **Mixed problems.** "When a schema has several problems, `storage-failed` wins, then `feature-unsupported`, then
   `schema-invalid`. An unknown keyword may explain the rest."
2. **A bare `x-vmd-ref` needs a type.** "`x-vmd-ref` without `format: uri-reference` is refused wherever the schema allows a
   string, including when it has no `type` at all. A schema for a `$ref` object writes `type: object`."
3. **A schema file must hold an object.** "A file holding just `true` is refused, although 2020-12 allows one." The card marks it
   as narrowing the spec.
4. **Some overlaps wait for the record.** "Overlaps that depend on the data, like two patterns matching one name, are reported
   when a record is checked, not when the schema loads. Two cases moved there in the review: `items` against
   `x-vmd-list.additional`, and two unequal `additionalProperties` in an `allOf`. One case is refused at load although only some
   records would hit it, the conservative "listed name" case."
5. **Identifiers inside data are refused.** "`$id`, `$anchor`, `$dynamicAnchor` or `$schema` with a string value inside a
   `const`, `enum`, `default`, `examples` or an unknown keyword make the schema `schema-invalid`. It was the only sound fix for the
   URL fetch." The card marks it as narrowing the spec.
6. **On and off the spine.** "A vmd declaration reached both along the spine and off it is refused, not only one reached only off
   it, so it never silently applies in one place and not another. It reads U2 strictly." The card marks it as narrowing §9.3's
   wording.
7. **`$sections` reached through a pattern or `additionalProperties`** "is checked as `$sections`. So a common YAML-record
   schema with a keyed list under `additionalProperties` is refused, and the message names the way out:
   `properties: {$sections: false}`."

## Options

- **(a) Confirm all seven.** Chosen, as recommended. The card: "The next draft states them. Nothing in the code changes."
- **(b) Confirm, except what the note says.** The card: "Each exception becomes its own card; the code keeps today's behaviour
  until then."
- **(c) Discuss first.** The card: "They stay readings in the PR."

## Decision

(a): all seven are confirmed, and Draft v0.14 states each where it belongs: item 1 in §9.1; items 3 and 5 in §9.2, each saying
that it narrows 2020-12; items 2, 4, 6 and 7 in §9.3, item 6 saying that a declaration the spine also reaches is refused; and
Appendix D's `feature-unsupported` and `schema-invalid` rows.

**Agent's reading, confirmed by the owner on [W5](W5.md) (2026-10-12).** Three details the card leaves to the draft:

- Items 4 and 6 amend [U2](U2.md)'s applied rule in the same direction: U2 refused a declaration "reached only off" the spine and
  named one overlap that waits for the record, two patterns at one member; item 6 refuses a declaration the spine reaches as well,
  and item 4 adds the overlaps that wait and the conservative case refused at load. So this record supersedes U2, as
  [W3](W3.md) superseded [X1](X1.md); U2's decision and its reason, that a reference's meaning never depends on a branch, stand.
- What "applies together" means, which §9.3's new paragraph "Declarations that meet" states, is the spec agent's wording of #97's
  rule: the four ways of the I2 design's section 3.3, and #97's pair walk, which steps over every member name that some
  `properties` of the schema lists. At a keyed item, each object applies its `prefixItems` entry or else its `items`, together
  with its keyed list's schema for the key; #97 takes a keyed item only past the longest `prefixItems`, which misses such a
  conflict at load (#109), so the suite's case `keyed-item-meets-prefix-items` is skipped until the code follows.
- Item 2's rule is stated as #97 implements it: the format, or a `type` that allows no string, must apply beside the declaration
  on every path that reaches it. #97 says this narrows nothing beyond the card's wording.

## Why

The card's reason: "Each is either the safe side of a gap or what made the security fix possible. Number 7 is the one with
user-visible friction, and its message names the fix."

Why (b) and (c) lost: Not recorded.

## Applied in

Draft v0.14 (#105): §9.1 (item 1), §9.2 (items 3 and 5), §9.3 ("The spine", "Declarations that meet", "What else is refused"),
Appendix D `feature-unsupported` and `schema-invalid`; the I2 design's section 3.3 (items 4 and 6). Suite cases in
`validation/schemas`, each refusal with its near miss: `unknown-keyword-beside-id` (item 1), `ref-without-type` and
`ref-on-object-type` (item 2), `boolean-schema-file` (item 3), `patterns-meet-at-listed-name`, `patterns-meet-only-in-data`,
`unequal-additional-properties` and `items-against-list-additional` (item 4), `identifier-in-data` and
`identifier-not-string-in-data` (item 5), `declaration-on-and-off-spine` and `declaration-on-spine-twice` (item 6), and
`sections-through-additional-properties` and `sections-kept-out` (item 7). The suite has no case for `storage-failed` beside
another problem. #97 (`f74bc12`) passes every one of them. Four more cases of item 4 are skipped in the TypeScript runner's
declaration: `patterns-meet-in-record`, `additional-properties-meet-in-record` and `items-and-list-additional-meet-in-record`, a
record that brings the waiting declarations together and gets its `schema-violation`, until the binding of keyed lists and typed
references (#23, #24) reports what #97 records as a conflict of the shape; and `keyed-item-meets-prefix-items`, until the code
follows #109.

Draft v0.15: card [AF](AF.md) asked item 4's case of a keyed list's `additional` against the array's `items` again, after #118
refused it at load, and the owner kept item 4: the meeting waits for the record. §9.3 now names a `prefixItems` entry beside
`items` there, as the I2 design's section 3.3 did; the rule does not change. #115 (`31fe634`) made the code follow #109, so the
case `keyed-item-meets-prefix-items` is no longer skipped.
