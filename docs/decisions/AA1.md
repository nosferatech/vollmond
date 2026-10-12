---
id: AA1
title: "Checking where a schema's vmd keywords meet is bounded by a count of its work"
round: "AA"
date: "2026-10-12"
status: accepted
sections: ["§9.3", "Appendix D"]
decided_by: owner
sources:
  card: "AA1"
  prs: [97, 105]
---

## Question

From the schemas pull request (#97). When vmd loads a collection's schema, it checks where `x-vmd-list` and `x-vmd-ref` stand,
and whether two of them can apply to the same value with different meanings (§9.3). The card: "The first version of that check
was exponential: a 1.4 KB schema took 8.9 s and 1.26 GB. After two review rounds it costs nothing on ordinary schemas. The 20
schema files in the repo need at most 2 steps. Two crafted shapes remain quadratic. At 400 branches, one needs 320,000 steps; at
the 1 MiB schema limit (decision U20), either takes minutes. The reviewer showed the first is as hard as a known problem,
intersecting two automata, so a cleverer algorithm isn't expected. U20's reason was to protect a validating service from exactly
this." #97's table measures the two shapes: two groups of unequal declarations at different members, 641,601 pairs and 4,170 ms
at 1,600 branches (196 KB), and bare `x-vmd-ref`s beside branches giving the format, 5,123,200 fixed-point steps and 5,498 ms at
1,600 (163 KB).

The card's caveat: "A count tied to this algorithm makes the verdict implementation-specific. So the spec would define it
semantically ("pairs of schema locations that carry declarations and apply together"), or state it as an implementation limit
with a required minimum."

## Options

- **(a) Bound the check's work.** Recommended. The card: "Past about a million steps, the schema is `schema-invalid` "too complex
  to check". Deterministic, in the style of the Markdown limits, with five orders of magnitude of room for real schemas. Draft
  and a suite case." #97 gives the example "a million pairs plus fixed-point steps".
- **(b) Bound how many schema parts apply at one place.** The card: "Simpler to state, but it doesn't measure the work directly,
  so some cheap schemas are refused and some costly ones aren't." #97: "for example 64. It is simpler to state, but it needs its
  own walk to measure, and `$ref` chains can widen it without `allOf`."
- **(c) A smaller schema size limit.** The card: "Shrinks the worst case, but a few hundred KB still takes seconds, and large
  legitimate schemas get refused."
- **(d) Accept the cost.** The card: "No new limit; a crafted schema can tie up a validating service for minutes, against U20's
  reason."

## Decision

The owner chose none of the options, and answered with the note below: "just use a safe but permissive schema size and
complexity check", because refusing a valid, efficient schema is a costly mistake, while admitting a terrible one only gives
terrible performance to a schema nobody should have.

**Agent's reading, for the owner to confirm.** Draft v0.14 applies the note as follows (§9.3, "A bound on the check"):

- **Option (a), set generously.** The note asks for a check with few false refusals and accepts that some expensive crafted
  schemas pass. Of the options, (a) refuses the fewest schemas that are cheap to check, since it counts the check's work, while
  (b) and (c), by the card, refuse cheap schemas. The bound, 1,000,000, is the card's "about a million steps", five orders of
  magnitude above what the repository's schemas need. This is the engineering manager's reading of the note, which the spec
  agent shares.
- **A count the specification defines, the same for every implementation**, rather than an implementation limit with a required
  minimum, the other framing the card names. The spec agent's reasons: the note asks for a check beside the size check, which
  every implementation applies alike, and a schema that one implementation accepts and another refuses is a refusal of a schema
  the user had working, the mistake the note weighs heaviest, which a count fixed in the spec rules out and an implementation
  limit allows above its minimum; the suite can then test both sides of the bound, as it tests the Markdown limits (§5.4), where
  a time budget was rejected because the suite could not test it; and the note's tolerance of false negatives lets the count
  stay simple, tracking the two costs the check is known to have rather than bounding every implementation's work. The cost is
  that an implementation whose algorithm is cheaper than the count still refuses past it, which only crafted schemas reach.
- **What is counted.** The count is the number of pairs of schema objects of two kinds: two that apply together and whose
  declarations below could disagree (unequal values of one keyword, or a keyed list and `unevaluatedItems`), an object also
  pairing with itself; and two that apply together, one of them a typed reference whose own schema object gives neither the
  format nor a type without strings. The first kind is the card's "pairs of schema locations that carry declarations
  and apply together", narrowed to pairs whose declarations could disagree, as #97's pair walk does, so that a repetitive schema
  whose declarations are all equal counts nothing. On the suite's two fixtures it equals the pairs #97's walk visits. The second
  kind states the fixed point's cost semantically; on #97's measured shape, K bare references beside K branches giving the
  format, it counts about 1.5 K² pairs where #97 takes about 2 K² fixed-point steps. What
  "apply together" means is §9.3's paragraph "Declarations that meet", the agent's statement of #97's rule ([AA4](AA4.md), item
  4).
- **The code** is `schema-invalid`, with a message saying that the schema is too complex to check, as the card's option (a)
  gives; Appendix D's other limit on a schema, its 1 MiB, is `schema-invalid` too.
- **The suite's cases** `validation/schemas/spine-work-over-bound`, two groups of 1,010 branches counting 1,024,144 (42.6 KB),
  and its near miss `spine-work-under-bound`, two groups of 990 counting 984,064 (41.8 KB), stand about 2 percent either side of
  the bound, so that an implementation that counts a linear term differently still gets both verdicts right.

## Why

The owner's reasons are in the note: a false refusal "has high impact", while a false acceptance only affects "terrible schemas,
that nobody should have in the first place", which may then be slow, as "users can get terrible performance for many reasons".
The card's reason for (a): "It's the only option that bounds the actual work, and real schemas are nowhere near it. Both the
author and the reviewer recommend it."

Why (b) and (c) were not chosen: not recorded as such, since the owner chose no option; the card's consequences for them are that
some cheap schemas are refused, which the note's first point weighs against. Why (d) was not chosen: the note's second point, "We
don't want to admit crazy, expensive, dangerous schema."

## Owner's note

> I'm inclined to say, to just use a safe but permissive schema size and complexity check. Here is a rationale:
> 1) We don't want to reject a valid, efficient schema, that user may legitimately have. The mistake here (false positive) has
> high impact.
> 2) We don't want to admit crazy, expensive, dangerous schema. Mistakes (false negative) are not as bad as in (1), they only
> affect terrible schemas, that nobody should have in the first place. At worst case they will get terrible performance, and
> users can get terrible performance for many reasons. If someone complains that terrible schema is slow, our answer can be
> "don't use terrible schema".  This is similar rationale to functional programming languages allowing programs that have
> exponentially large types...

## Applied in

Draft v0.14 (#105): §9.3 ("A bound on the check", and "Declarations that meet" for what applies together), Appendix D
`schema-invalid`; the I2 design's section 3.3; suite cases `validation/schemas/spine-work-over-bound` and its near miss
`spine-work-under-bound`. The case over the bound is skipped in the TypeScript runner's declaration until a follow-up to #97
(`f74bc12`) adds the bound.
