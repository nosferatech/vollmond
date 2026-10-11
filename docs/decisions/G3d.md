---
id: G3d
title: "A newer client reads an older store with a warning, unless a change in between alters meaning"
round: "G"
date: "2026-10-10"
status: accepted
supersedes: [G3c.md]
sections: ["§9.1", "§9.5"]
decided_by: owner
sources:
  card: "G3"
  log: "Decisions of phase I0 / The owner's answers to the review (G1 to G9)"
  chat: ["2026-10-10T18:45:04Z", "2026-10-10T19:19:50Z"]
  prs: [56]
  commits: ["17e3087"]
  issues: [46]
---

## Question

After confirming [G3c](G3c.md), the owner reconsidered: maybe a client newer than the store can read it. A validating store
rejects newer features, and a reader is generally expected to read older versions, but a change such as YAML's `no` against
`"no"` breaks that argument. What does a client newer than the store do?

## Options

- **(a) Refuse it, as G3c decided**, unless the client is configured at the store's compatibility level.
- **(b) Read it with a warning.** The owner's first thought: a validating store guarantees the features are at its level, and a
  reader is expected to read older versions. A change in meaning, such as YAML's `no` against `"no"`, would be read silently
  wrong.
- **(c) Read it with a warning unless a change in between alters the meaning of existing syntax, and refuse it otherwise.**
  Chosen, as the session proposed. Each major version lists the changes in meaning it makes, so a client knows which case
  applies; writes from a newer client stay at the store's level.

## Decision

(c). A newer client reads an older store with a warning (`format-version-older`) when no change between the two versions alters
the meaning of existing syntax, and refuses it otherwise (`format-version-unsupported`); it may instead implement the old
meaning as a compatibility level. Each major version lists its changes in meaning. A validating backend rejects newer features,
and for one that does not validate, the writers' compatibility level proposed in #46 keeps a writer at the store's level. An
older client still refuses a newer store.

## Why

The session's argument: of what a major version can change, removing a feature makes a newer reader fail safely, and an
undetectable addition hurts only older readers; only a change in what existing syntax means, such as a new slug rule, new number
parsing or YAML's `no`, makes a newer reader read old data silently wrong, and validation cannot catch it, since the data is
valid under both rules. Recording which changes alter meaning, a bit of the compatibility class proposed in #46, lets the client
tell the cases apart, so (c) keeps the warning of (b) without betting that major versions are harmless, and refuses exactly where
the owner said erroring out is better. (a) refuses where reading is safe.

## Owner's note

> actually, on the second thought. Maybe permitting client newer than the store is fine. We can ignore non-validating stores,
> they promise nothing. But when using validating store, the store will validate that the features are at proper version level
> (as it wont understand and accept newer stuff). And the reader is generally expected to read older versions just fine. So a
> warning is fine. There might be versions like the yaml "no" vs no that break this argument, and may require special handling.
> I'm kinda basing this argument that major version bumps don't typically introduce this kinda of nasty data interpetation
> problem. But if they do, then maybe actually erroring out is bette.

> ok, I think I agree with the versioning proposal. The one thing to watch out for, if versioning becomes too much burden for
> us, we need to surface that issue and possibly revisit choices.

## Applied in

#56 (`17e3087`), §9.1 and §9.5, before Draft v0.5.
