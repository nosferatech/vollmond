---
id: AE
title: "For now, a schema is refused only by the existing rules; a service that validates untrusted data sets its own time budget"
round: "AE"
date: "2026-10-12"
status: accepted
sections: ["§9.1", "§9.2"]
decided_by: owner
sources:
  card: "AE"
  design: ["docs/design/i2-validate.md, section 9"]
  prs: [105, 113, 114, 115]
  issues: [109, 110, 111, 119]
---

## Question

The bound on the work of the schema check, asked again. Card AA1 had asked it first, and was taken out of Draft v0.14 (#105),
since the bound that draft proposed, a count of pairs of schema parts refused past a million, failed review. The card: "Your AA1
note asked for "a safe but permissive schema size and complexity check": never refuse a legitimate schema, and accept that
crafted, terrible schemas may be slow." What the measurements said, from the card:

- "Our code has fixable problems." One part of the check was quadratic for no reason (#109), and another crashed at about 400 KB
  (#110). "These get fixed whatever you choose here." After the fixes (#113 to #115, in review), "the crash is gone and the
  fixable parts are fast. Shapes that are slow by nature remain: a crafted chain at 976 KB takes 151 s."
- "One part is hard by nature. Deciding whether two vmd keywords can ever apply to the same value is as hard as a known problem,
  intersecting two automata. Even a tuned check takes one to two minutes on a crafted 1 MiB schema."
- "Validating records is the bigger risk, and no schema limit fixes it. A 109-byte schema with no vmd keywords makes a 146-byte
  record take 6.9 s to validate, doubling with each level of nesting (#111). Regular-expression patterns can blow up the same
  way. A service that validates untrusted data needs a time budget per operation anyway".
- "Real schemas are tiny. The repo's 20 schemas have at most 6 parts that hold or lead to a vmd keyword, and 2 pairs to compare."

## Options

- **(a) A guaranteed floor, then each implementation's own budget.** Recommended. The card: "The spec says every implementation
  must fully check any schema with up to 1,000 parts that hold or lead to a vmd keyword (real ones have 6). Above that, an
  implementation may refuse a schema as "too complex to check" when its own documented work budget runs out. Nothing at or below
  the floor is ever refused, anywhere. Above it, implementations may differ, and the shared test suite can only test the floor
  side."
- **(b) No limit beyond 1 MiB; fix the code and document the risk.** The card: "Never refused for complexity. A crafted schema
  may take minutes to load, as a crafted record may take minutes to validate. The spec and the design say plainly that a service
  validating untrusted data needs its own time budget. Same verdict everywhere."
- **(c) A hard cap on those parts.** The card: "Refuse a schema with more than, say, 1,000 parts that hold or lead to a vmd
  keyword. Deterministic and testable both ways, same verdict everywhere, but it refuses legitimate generated schemas past the cap
  (for example, more than about 333 mixins each adding a keyword), and a higher cap isn't safe."
- **(d) A count the spec defines, covering all the work.** The card: "What Draft v0.14 tried, corrected. Deterministic, but it
  writes our algorithm into the spec for every implementation, and it still refuses schemas that a different algorithm checks
  cheaply (a 58 KB schema of 270 mixins already reaches a million)."

The owner answered with none of them, in two notes (below): the first asked whether a classification of schemas by cost is
feasible, and the second, after the engineering manager's answer in chat, which issue #119 summarises, chose a simple solution
for now and a ticket for the classification.

## Decision

For now, a schema is refused only by the existing rules: the size bound of 1 MiB ([U20](U20.md)), the rules for a valid schema
(§9.2), and those of the spine and of declarations that meet (§9.3). No complexity limit is added for now; whether "schemas where
it's obvious they should be refused" meant a further cap is asked of the owner (the agent's reading below). A crafted schema can
make loading or validation slow; a service that validates untrusted data needs its own time budget for each operation (#111).
Classifying schemas by cost, provably cheap, plainly too expensive, and a warned grey area between them, is future work: #119.

The size bound limits what reading a schema file costs, not what using it costs: #111's schema of 109 bytes makes validation
exponential in a record's depth. U20's reason, "A larger schema is a mistake or an attack on a validating service", stands as
the card's words, and its record now says that the bound does not protect a service's time.

**Agent's reading, for the owner to confirm.** What "schema rejection for schemas where it's obvious they should be refused" means:

- Draft v0.15 reads it as the refusals vmd already has, and adds none. A schema over 1 MiB, one that is not a valid 2020-12
  schema under vmd's narrowings, and one whose vmd keywords break the spine's rules are each refused at load, with
  `schema-invalid` or `feature-unsupported`, and no other schema is. "Otherwise we can pretend that problem doesn't exist, and
  shift responsibility on the user" is §9.2's sentence that a service validating untrusted data needs a time budget of its own,
  which the draft does not define, as §5.4 does not for records.
- Alternatives considered and not taken, since each adds a refusal that no answer agreed to: the card's (c), a cap on the parts
  that hold or lead to a vmd keyword, which refuses legitimate generated schemas; the card's (a), whose refusals above the floor
  depend on each implementation's budget; the card's (d), a count the spec defines; and a size bound smaller than 1 MiB, which
  #111 shows would not bound the time either. Which schemas are "obviously" too expensive is the "just bad" class of the owner's
  first note, which #119 is to define.

## Why

The owner's reason, in the second note: "for now we can go with some simple solution [...] and otherwise we can pretend that
problem doesn't exist, and shift responsibility on the user for now." The card's note on (b), the option closest to the answer:
"(b) is close and simpler; it trades load-time refusals for slow loads, and leans fully on the service budget that #111 shows we
need anyway."

Why (a), (c) and (d) lost: Not recorded. The card's consequences for them: under (a) implementations may differ above the floor;
(c) refuses legitimate generated schemas past the cap; (d) writes one algorithm into the spec and still refuses schemas another
algorithm checks cheaply.

## Owner's note

On the card:

> re: "Deciding whether two vmd keywords can ever apply to the same value is as hard as a known problem" . I'd like to undestand more about the exact specifics of what we need to find out.  There are efficient ways to avoid having to have to run automata intersections, if the regular langugage is friendly enough. We should discuss this in detail, to see what tricks we can use here.
>
> We can impose timeouts or ideally deterministic budgets for record validation, so that records can be deterministically rejected or admitted.
> So schemas can be classified across several dimensions: what is the worst case cost? what is the actual cost? what is the provable cost (by static analysis)?
> Proving worst case cost, or actual cost is probably difficult in general, but for certain schemas, we might be able to prove that it never costs more than some X, and if X is < allowed budget. We can say that this schema is provably good. When someone designs a schema, that probably is useful. It means that schema is guaranteed to be "good" under all conditions, and anyone authoring the schema should strive for achieving that.   The question is, what classes of schemas can be analyzed like this and how accurate the ceiling would be?
> Then there are 2 more interesting classes of schemas: just bad. Schema is too large and too complex to even bother analyzing it or applying it to documents, and we should reject it outright.  And then the grey area, schema may work for some documents well, but for others it may not, or we don't know how well it will work. It would be nice if we could identify parts of the schema, that cause it to not be provably good, and issue warnings, that we can't prove that schema is good, and user has to use it on their own risk.
>
> Is any of that feasible?

In chat:

> Ae: lets open a ticket for it. And for now we can go with some simple solution, with schema rejection for schemas where it's obvious they should be refused, and otherwise we can pretend that problem doesn't exist, and shift responsibility on the user for now.

## Applied in

Draft v0.15: §9.2 ("What a schema may cost"), and §9.1's size bound, which now says that it limits what reading a file costs; the
I2 design's section 9 ("Crafted schemas"); [U20](U20.md)'s record. Suite case `validation/schemas/crafted-recursion-not-refused`:
#111's schema, with `type: object` added so that a record can fail it, is used, and of two records nested three levels deep the
one whose innermost `x` is a number is a `schema-violation` and its near miss is valid; main passes it. The classification is
#119.
