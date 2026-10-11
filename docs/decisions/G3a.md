---
id: G3a
title: "Three versions: the data's, the reader's and the writer's"
round: "G"
date: "2026-10-10"
status: superseded
supersedes: [G3.md]
superseded_by: [U21.md]
sections: ["§9.1", "§9.5", "§20"]
decided_by: owner
sources:
  card: "G3"
  log: "Decisions of phase I0 / The owner's answers to the review (G1 to G9)"
  chat: ["2026-10-10T18:27:55Z"]
  prs: [50]
  issues: [46]
---

## Question

On [G3](G3.md) the owner asked for no warning between minor versions, as long as they are compatible both ways. The session
objected that "both ways" means an older client must read data written under a newer minor version correctly, so a minor version
could never add syntax or a field type, and nearly every change would be a major version. When do minor versions warn, and what
may a minor version change?

## Options

- **(a) Minor versions compatible both ways, as G3 recorded.** No warning between minor versions; any change that is not
  compatible both ways is a major version. In the session's words, nearly every change would then be a major version.
- **(b) The additive rule.** A minor version only adds. A newer client reads older data, and an older client can tell when it
  meets something it does not know, and warns or refuses only then.
- **(c) The owner's model of three versions, those of the data, the reader and the writer.** Chosen. A store can move to 2.2,
  and a 2.1 reader reads its data without any warning as long as the data uses no 2.2 feature; a 2.1 reader that meets a 2.2
  feature fails with an error. If a 2.1 reader cannot read, or misreads, data that a 2.2 writer wrote at 2.1 compatibility, the
  change should not have been a minor version.

## Decision

(c). Minor versions only add and never change the meaning of existing syntax. Every addition must be detectable by an older
reader, as a new `$` section member, a new `data` info string or a new `x-vmd-*` keyword, which vmd's strictness supplies. A
reader decides from the features the data uses, not from the declared number (`feature-unsupported`), and a client refuses a
major version it does not support (§9.1). Left to #46 as proposals, with their precedents (§20): a store setting for the
writers' compatibility level; feature classes after ext4's compat, ro_compat and incompat flags, ZFS feature flags and git's
`extensions.*`; and how a store writes a minor version.

## Why

The session agreed that (c) is the additive rule (b) with one improvement: the reader decides by the features the data uses,
not by the store's version number, so upgrading a store gives no warning and a reader fails only on something it cannot read, as
ZFS's feature flags work. The model holds only if every addition is detectable by an older reader, which is why the rule for
additions is part of the decision. (a) would make nearly every change a major version.

## Owner's note

> on G3, hehe. So from reader-writer perspective, as in serializer/deserializers, if a 2.1 version reader can't read 2.2.
> version writer, or reads it wrongly, then I'd say that this shouldn't have been a minor version, as it basically makes the
> reader and writer incomatible. This assumes that the data was stil writted at 2.1 compatibility level. So in practice we have
> three versions here: data, reader, writer. So in this case. So a backend can move on to 2.2 version, and 2.1 can read it just
> fine, as long as data was not modified. And that should produce no warning. Reading a data that is actually suing 2.2
> features, with 2.1 reader is I think an error.

## Applied in

Draft v0.4 (#50, `1043a6c`), §9.1 and §9.5; the proposals went to #46. [G3b](G3b.md) scoped the safeguards that keep the rule
true, and [G3c](G3c.md) settled an older major version. [U21](U21.md) widened what counts as an addition beyond the three forms.
