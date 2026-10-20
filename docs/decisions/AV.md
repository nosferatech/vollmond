---
id: AV
title: "A local date-time accepts a leap second, `:60`, in any minute, as the grammar allows"
round: "AV"
date: "2026-10-20"
status: accepted
supersedes: [J1.md]
sections: ["§4.3"]
decided_by: owner
sources:
  card: "AV"
  design: ["docs/design/i2-validate.md, section 3.4"]
  prs: [165]
---

## Question

From the owner's note on card [W12](W12.md), item 4, which asked the owner to confirm [J1](J1.md)'s labelled reading that a
date-time without an offset is taken as UTC for the leap-second check. The note (below) asked how a time is interpreted. The
card's background: "vmd never converts a date or time. A value is stored and returned exactly as written; a schema's `format`
only checks it and orders it. So nothing can be reinterpreted in another time zone." And: "The check follows the grammar the
draft names (§4.3: RFC 3339, and TOML 1.0.0 for a local date-time), implemented by vmd itself, not by `Date.parse` or Python's
`datetime`. That is deliberate: the platforms' parsers disagree. JavaScript's `Date.parse` reads a date-time without an offset as
the machine's local time, and accepts forms the standards don't; Python's `fromisoformat` accepts different forms by version."

"The one place a time zone matters is a leap second, `:60`. Leap seconds happen at 23:59:60 UTC, so with an offset vmd can check
it (`01:59:60+02:00` is valid, `12:30:60Z` is not), as JavaScript's main validator (Ajv) does. A local date-time has no zone, so
the same moment could be written `23:59:60`, `01:59:60` (in UTC+2) or `05:29:60` (in UTC+5:30). Today vmd takes it as UTC: only
`23:59:60` is valid. That is W12's item 4."

The card's example: "a schema field `at` with `format: local-date-time`; values `2016-12-31T23:59:60`, `2017-01-01T01:59:60`,
`2017-01-01T12:30:60`."

## Options

- **(c) Any `:60`, as the grammar allows.** Chosen, as recommended. The card: "All three are valid. vmd adds no rule of its own
  for a value it can't place in time; RFC 3339's grammar allows `60` in any minute, and only its leap-second rules, which need a
  zone, narrow it. A typo like `12:30:60` passes."
- **(a) Only `23:59:60`, as today.** The card: "Only the first is valid, as Ajv's lenient check (a missing offset read as zero)
  does. A real leap second written in local time anywhere but UTC is refused."
- **(b) No `:60` in a local date-time.** The card: "None is valid, as Python's usual checker refuses `:60` everywhere. A leap
  second can't be written as a local date-time at all."

## Decision

(c): a local date-time accepts a seconds field of `60` in any minute, as the grammar allows, and vmd adds no rule of its own for
it. A `time` and a `date-time`, which have an offset, keep J1's check: `60` only at 23:59 UTC once the offset is applied.

This decides J1's labelled reading the other way: J1's record said that a local date-time is taken as UTC for the check, and the
draft applied it from Draft v0.7. That reading was never confirmed, but J1's record and the draft applied it, so AV supersedes
J1, as [AP](AP.md) superseded [AO](AO.md) for the reading it decided against. J1's rule for zoned values stands, and so does its
reason for them, that `12:30:60` is almost always a typo; for a local date-time AV accepts that cost.

**Agent's reading, for the owner to confirm.** For ordering, a local `hh:mm:60` falls after `hh:mm:59` and before the next
minute's `:00`, widening §4.3's comparison, "`23:59:60` falls after `23:59:59` and before the next midnight", to any minute. This
is #165's reading 1; no code compares date-times yet.

## Why

The card's reason: "It is the least involvement you asked for: the standard's grammar and nothing vmd made up. Without a zone, any
narrower rule guesses the zone, which (a) does, and (b) refuses real values. The cost is that a `:60` typo in a local date-time
isn't caught. Zoned values keep today's check."

Why (a) and (b) lost: the card's reason above, that (a) guesses the zone and (b) refuses real values.

## Owner's note

The project owner chose (c) on the review desk on 2026-10-20, with no note. The note on W12 that led to this card:

> Not sure about the leap second parting as UTC. Can we tell how the time will be interpreted by the actual parser? Like is it possible that the time after parse may get reinterpreted as different time zone? Ideally we shouldn’t be involved as little as possible in time and date parsing and just use standard library. Given cross platform the standard library may not be well defined. So is the case here that we need to declare the specific parsing rules for the format?

## Applied in

#165 (`a6e6c8e`): the code, the I2 design's table of logical types (section 3.4) and its property test 2, and the suite cases
`values/logical-types/leap-seconds-at-2359-utc-valid` and `leap-seconds-elsewhere-invalid`. Draft v0.19 (#168): §4.3's "Leap
seconds"; J1's record.
