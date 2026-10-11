---
id: G3b
title: "The version safeguards cover vmd's own specification and implementations"
round: "G"
date: "2026-10-10"
status: accepted
sections: ["§9.1"]
decided_by: owner
sources:
  card: "G3"
  log: "Decisions of phase I0 / The owner's answers to the review (G1 to G9)"
  chat: ["2026-10-10T18:31:06Z", "2026-10-10T18:38:11Z"]
  prs: [56]
  issues: [45, 46]
---

## Question

Under [G3a](G3a.md) a minor version that causes misreads is a serious fault, and careful review alone would not catch one. The
session proposed five safeguards in #46: each change names its compatibility class in the decision log, downlevel cases in the
conformance suite, cross-version CI against the previous release's reader, pinned output of vmd's writer, and an audit of version
bumps (#45). How far do the safeguards reach?

## Options

- **(a) vmd's own specification and implementations only.** Chosen. vmd does not certify third-party serializers; a user who
  upgrades is responsible for their own data, and older versions stay available to them. A third party can run the conformance
  suite, but passing it is their claim, not vmd's certification.
- **(b) Also third-party serializers.** In the owner's words, "a lot of work, that we shouldn't need to do".

## Decision

(a). The safeguards proposed in #46 keep the list of changes in meaning true for vmd's own specification and implementations;
vmd does not certify third-party serializers, and a user who upgrades is responsible for their own data. The pinned output of
vmd's own writer stays in scope, since an upgrade of the YAML library it uses that changes what vmd writes is a vmd change.

## Why

The owner's reason: users are not required to upgrade and can keep using an older version, so making sure an upgrade does not
affect their data is their responsibility, while vmd must make sure that it handles minor versions itself and introduces no
such traps. Certifying third-party serializers (b) is a lot of work that vmd should not need to do.

## Owner's note

> Agreed. And minor version that causes misreads is actually a big deal. If we don't trust that serializers don't introduce
> those, then we may be forced to watch out for traps like this during version bumps.

> I think that this might be issue that we could just ignore and not solve. When we perform a version bump, users are not
> required to do so, they can still use older version. So if they want to do a version bump of vollmond and reader/writer
> libraries, it really is their problem to ensure that their data is not affected by it. What we should do, is to make sure that
> vollmond itself properly handles minor versions, and doesn't introduce traps like that. But I'd like to get away from having to
> certify 3rd party serializares, and that is a lot of work, that we shouldn't need to do.

## Applied in

The proposal in #46 (comments 6100820160 and 6100882003) and the audit in #45; recorded in the decision log by #56 (`17e3087`).
