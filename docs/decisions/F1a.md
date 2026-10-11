---
id: F1a
title: "The roles of readers, validators, backends and queries"
round: "I0"
date: "2026-10-10"
status: reversed
superseded_by: [G2.md, G7.md, U12.md]
sections: ["§9.4", "§9.5"]
decided_by: owner
sources:
  card: "F1"
  log: "Decisions of phase I0 / Errors, parsing and validation"
  prs: [50]
  issues: [46]
  commits: ["1043a6c"]
---

## Question

Answering [F1](F1.md), the owner drew a distinction worth elaborating in the design: what each part of vmd does with data that
may not be valid, and in particular what a query does when the data does not pass validation, both on data that was never
validated, such as a local edit copy, and on data that was supposed to be validated.

## Options

- **(a) The owner's elaboration.** Chosen. A reader reads unvalidated data as long as its syntax is proper; a validator reports
  every error and fails according to the configured strictness; a backend rejects any update that does not validate. Queries
  default to best effort and assume the backend is correct, with an option to enforce the schema while reading.

Other options: Not recorded.

## Decision

(a), written into §9.5. A reader opened on data that is not validated reads it as long as its syntax is proper. A validator
reports all errors and fails according to the configured strictness. A backend rejects any update that does not validate.
Queries default to best effort and assume the backend is correct, and a strict read mode, configurable per client or
connection, makes records that fail validation errors rather than results, for cases where correctness matters more than
availability. A reader using an incompatible format version must fail loudly; the owner calls this "quite important" and expects
it to need "a good systematic solution", which belongs to the versioning design (#46).

## Why

The owner's reason: on data that is supposed to be validated, a backend holding data that fails its own constraints means
nothing vmd does will be correct anyway, so readers can read at best effort and assume the backend is correct; whether to
prefer correctness or availability depends on the deployment, hence the option of a strict read. A reader that misinterprets
correct data because of a format version mismatch should fail loudly, at least in tests and staging.

## Owner's note

> All right, I think there is a subtle distinction here. That is probably worth elaborating in the design:
> 1) A reader opened on not validated, should read the data as long as it's syntax is proper.
> 2) A validator should report all error (syntax, schema, constraint violations), and fail to validate according to the
> configured strictness.
> 3) A backend should reject any update that does not validate.
>
> This then brings the question: When running a query, what should happen if the data does not pass validation:
> a) if query is running on not validated data (e.g. a local edit copy), then query should work as a best-effort.
> b) if a query is running on validated data (or data that was supposed to be validated). This is less obvious. Because if user
> correctness depends on schema conformance, and data doesn't conform in practice, then it could cause serious problem? But the
> premise here is that the backend somehow contains data that fails to validate against its constraints, so at this point
> nothing we will do will be correct.  There is I think one more scenario. A backend data is correct, but whoever is reading is
> misinterpreting it? If I was running a reader that was using an incompatible format version compared to the backend, I'd
> probably like that reader to fail very loud, so that I can fix it, at lest in tests and staging environments.  On the other
> hand when I was running this in production, it may depend on whether I want correctness at a cost of availability or the other
> way around.
> So I think, me may actually need to offer an option, to strictly enforce schema while reading, for cases where correctness is
> more important than availability. As a default I think we can let readers read to their best effort, and assume that backend
> is actually correct.
> This question I think it quite important, and we may need to discuss it later. The case of mismatched readers/writers is scary,
> and I think it will require a good systematic solution.

## Applied in

Draft v0.4 (#50, `1043a6c`), §9.5. [G2](G2.md) defined what a backend is and when one validates, [G7](G7.md) narrowed what the
strict read mode refuses, and [U12](U12.md) made readers refuse the records of a collection whose schema is invalid, against
point 1.
