---
id: AC
title: "An alias chain stops at any name a link reaches, keys included, and an alias holds its old name until it is pruned"
round: "AC"
date: "2026-10-12"
status: accepted
supersedes: [Z2.md, W4.md]
sections: ["§13.2", "§13.4", "§13.6", "§19.2", "§20", "§21", "Appendix D"]
decided_by: owner
sources:
  card: "AC"
  design: ["docs/design/i2-validate.md, section 5.5"]
  prs: [106, 121]
  issues: [48, 120]
---

## Question

From the pull request that follows chains of anchor aliases (#106). The card: "When a heading is renamed, vmd records the old name
as an alias, so `#old` links keep working. When it is renamed again, the aliases form a chain: `x` → `a` → `b`. The draft (§13.6)
says the chain stops at "an anchor of the record", so a link goes to the first name in the chain that still exists. You confirmed
that on card W4." In a JSON or YAML record a link can also reach a top-level key, which is not an anchor in the draft's sense
(§6.3). The card's example: `data/k.json` is `{"a": 1, "b": 2}`, with the aliases `x` → `a` and `a` → `b`; `#a` goes to the
live key `a`, and where should `#x` go? "PR #106 (alias chains) stops the chain at the live key, so `#x` goes to `a`, where `#a`
goes too. But the warning that tells you an alias's old name is taken by a live name (`alias-shadowed`) counts only headings and
explicit anchors, so it never warns that the live key `a` hides the alias `a` → `b`. The two features disagree about what a live
name is, and this card picks one meaning for both."

The owner's first note on the card (below) asked about the scenario behind it: a name renamed from `a` to `b` and then used
again, which is the caveat of [F8](F8.md), left to the design of renames (#48). The engineering manager's proposal in chat
answered it with #48's two directions: lock the old name while an alias holds it, "The lock ends when `vmd alias prune` removes
the alias, once no open branch is based before the rename. That answers how long a name stays reserved"; or resolve each new
reference once, at its change's base version, "cheap, but it needs vmd at integration time". "Option 1 alone can't stop plain
edits or git merges, so reads still need a fallback for "alias `a` → `b`, and a live `a` exists": a live name wins, with the
`alias-shadowed` warning. That is where AC comes in, and option (a) still fits." Its proposal: "the lock now, AC (a) as the
read-side fallback, and the clever scheme later with I5 (refactors)."

## Options

- **(a) Any name a link reaches, keys included.** Chosen, as recommended. The card: "`#x` goes to `a`, the same as `#a`. The
  shadowing warning also fires for keys. §13.6 says "a name the address's first step reaches" instead of "an anchor". #106 keeps
  its behaviour; a small code change to the warning follows."
- **(b) Headings and explicit anchors only.** The card: "`#x` runs past the live key and goes to `b`, while `#a` goes to `a`. The
  warning stays as it is. #106 changes to stop only at anchors."

For the lock, the proposal in chat named the cleverer scheme as the alternative, now #120: resolve each new reference at its
change's base version (the base an `apply` carries, or the git merge base), mapped through the renames since, and rewrite it to
the current name.

## Decision

(a), with the proposal in chat:

- A chain of anchor aliases stops at any name that a link's first step reaches in the record (§7.3): an anchor, explicit or
  derived, a key of the root (a JSON or YAML record's top-level key, or a Markdown record's front matter key), or a child section
  of the root by its key. `alias-shadowed` warns for the same names, so the chain and the warning agree on what a live name is.
- An alias holds its old name until it is pruned: vmd's own writes refuse to create a name that an alias in the file holds as
  its `from`, and `vmd alias prune` ends the lock. Plain edits and merges can still create such a name, and on read a live name
  then wins, with `alias-shadowed`.
- Resolving new references at their change's base version, which would let a renamed name be reused, is #120, out of scope.

This amends [Z2](Z2.md)'s rule and the reading [W4](W4.md) confirmed (its item 7, "Anchor alias chains stop at the first live
name"), in the same direction, by widening what a live name is from anchors to every name a first step reaches, so it supersedes
both. Z2's other details stand, and so do W4's other nine items.

**Agent's reading, for the owner to confirm.** Six details that neither the card nor the chat settles, which Draft v0.15 states
as follows:

1. The refusal is an operation error whose message names the alias and suggests `vmd alias prune`. The draft gives it no code
   yet: the code is named when the lock is implemented (I5), and then goes into Appendix D and core's table of codes together,
   which core's test `appendix-d.suite.test.ts` requires to list the same codes. No existing code fits: `conflict` is a
   version-token mismatch (exit code 3), and `unreadable-records` is about unreadable records.
2. "vmd's own writes" are its semantic operations (§13.2), the ones that name a node: `mv` and `new` refuse a record path that a
   record alias has as its `from`, and `rename`, `insert`, `set` (a new field) and `body` (a new block anchor) refuse to give a
   record a name that a first step reaches and that one of its anchor aliases has as its `from`, also a derived anchor that a
   retitle renumbers (§13.4). The brief for this draft named `rename`, `mv`, `new` and `insert`; `set` and `body` can create a name
   as well. Storage operations (`write`, `edit`, and `apply` of them) are left out: they change bytes without naming a node, as
   plain tools do, so `alias-shadowed` catches what they create.
3. **A rename back is refused.** Renaming `b` back to `a`, or moving `b.md` back to `a.md`, is refused while the alias `a` → `b`
   is in the file, until `vmd alias prune` removes it, so undoing a rename waits for the prune. The alternative not taken: let a
   rename back to an alias's old name drop or rewrite that alias instead of refusing it.
4. The held names are the same set as the one that stops a chain: a record's names held by its anchor aliases, those recorded
   under its old paths included, as Z2 decided for resolution.
5. The lock makes the Write profile read the alias file, so §19.2's Write row names the refusal; the implementation plan puts the
   lock with I5, where aliases are written (§21).
6. §13.6 now says that an anchor alias's `from` and `to` are anchor names (§6.2), as the I2 design's section 5.5 and the alias
   reader of #99 have it, so a section member such as `$title`, which a first step from the root reaches, can never be an alias's
   old name. The engineering manager raised the case for #121's warning.

## Why

The card's reason: "With (b), `#x` and `#a` end at different places although the chain passes through `a`, which is still there;
following an alias should end where a direct link to that name ends. And the warning then covers every name that can hide an
alias." For the lock, the owner's note: "if we don't want to faithfully apply the history, the only way out is to reject certain
writes and merges", and "we can define the limitations of atomic renames, like an old name lockout, so that we can simply the
resolution".

Why (b) lost: the card's reason above, that `#x` and `#a` would end at different places. Why the cleverer scheme was not taken
now: Not recorded; the owner asked for it to be its own ticket, #120.

## Owner's note

On the card:

> The scenario where a is renamed into b, and after that someone tries to use name a is sketchy.
> Assuming there is a linear history of snapshots (and in a nice linear git repo there is), then in general we can tell at every commit what renames are active, and any reference introduced before the commit is considered pointing to the new alias (or the final alias), and any ref introduces at or after is considered to point to the new incarnation of that name that was not subject to the rename, right?
> the problem is, that when reading and resolving we don't really want to know the timestamp of each ref, and compare it with the timestamped rename table.
> Similarly when syncing to the new version of repo, while having renames active (or a repo adding new renames) we also would need to take care of that.
> Ideally we want to promise that all renames and refs behave exactly as if we had faithfully applied the history. So if we don't want to faithfully apply the history, the only way out is to reject certain writes and merges.  Am I missing something here?
>
> So I think we can define the limitations of atomic renames, like an old name lockout, so that we can simply the resolution (e.g. a ref to old name, always goes to the final name in the rename chain).
> Or is there some clever (and cheap) scheme that we can use to allow reintroduction of old names after rename?
> There is also a question of how long, the old names should remain reserved?

In chat, on the proposal:

> AC: sounds good. We can file ticket for more clever approach

## Applied in

Draft v0.15: §13.6 (what stops a chain, the lock, the read-side fallback, #120, and #48's two remaining questions), §13.2 and
§13.4 (the refusal), §19.2 (the Write profile), §20 (#120 beside #48), §21 (I5), Appendix D `alias-shadowed`. Suite case
`references/alias-chains/refs-anchor-chain-stops-at-key`: `#x` stops at the live key `a`, `#a` is ok, and its near miss `#y`
passes a name the record does not have and reaches the key `b`; #106's code passes it. The warning for keys is #121 (open), which
adds the suite case `references/aliases/check-alias-shadowed-keys` and updates the I2 design's section 5.5. The lock has no suite
case yet, since the suite has no write operations before I4 (conformance README, operations reserved for I4). #48 has a comment
that records the lock, and #120 the cleverer scheme.
