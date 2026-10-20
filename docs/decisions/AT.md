---
id: AT
title: "A cache directory set with `XDG_CACHE_HOME` is not used inside any git checkout around the store; the default always is"
round: "AT"
date: "2026-10-20"
status: accepted
sections: ["§14.3"]
decided_by: owner
sources:
  card: "AT"
  design: ["docs/design/i2-validate.md, section 6.2.1"]
  prs: [153]
  issues: [25]
---

## Question

The card: "The local index (#153, in review) keeps a cache of each file's parse, and `vmd check` will trust it without re-reading
the file. A cache that a pull request can write is therefore a way to make a broken record look valid: commit a forged cache file,
point `XDG_CACHE_HOME` (the cache location) at it, and a CI check would pass. So vmd refuses a cache directory inside the store's
git checkout."

"The independent review found the check stops at the nearest `.git`. A store inside a submodule or a nested clone, with
`XDG_CACHE_HOME` pointing into the outer repository (say `$GITHUB_WORKSPACE/.cache`), uses that cache. The reviewer reproduced it:
a forged entry made a broken `bad.json` list as readable."

"Closing it fully has a cost for people whose home directory is itself a git checkout (a dotfiles repository, `~/.git`): every
store under home is then inside a checkout, and so is `~/.cache`."

The card's example: "`/work/outer/.git`, the store at `/work/outer/inner/store` with its own `/work/outer/inner/.git`, and
`XDG_CACHE_HOME=/work/outer/.cache`."

## Options

- **(c) Check every enclosing checkout, but only for an `XDG_CACHE_HOME` that is set.** Chosen, as recommended. The card: "Closes
  the nested case wherever someone points the cache somewhere. The default directory (`~/.cache/vmd`, `~/Library/Caches/vmd`) is
  always used, as the design trusts the user's home (it is never inside a CI workspace). A dotfiles user keeps the default cache;
  one who sets `XDG_CACHE_HOME` inside home's checkout gets none."
- **(a) Check every enclosing checkout, always.** The card: "Closes it everywhere. A dotfiles user gets no cache for any store
  under home unless they set `XDG_CACHE_HOME` outside it (e.g. under `/tmp`)."
- **(b) Look past submodules and worktrees only.** The card: "A `.git` that is a file (submodules, worktrees) doesn't stop the
  search; a real `.git` directory does. Closes submodules, not an independent clone inside another."
- **(d) Keep the nearest checkout and document the gap.** The card: "Simplest; the CI guidance already says to restore no vmd
  cache in a gate and to keep the cache outside the workspace."

## Decision

(c): a cache directory set with `XDG_CACHE_HOME` is not used when it lies at or below the store root, or at or below any git
working tree that encloses the store, every directory from the store root up to the filesystem's root that holds a `.git` entry.
The default directory in the user's home is always used, unless it lies at or below the store root.

**Agent's reading, for the owner to confirm.** Two details of how Draft v0.18 states it in §14.3, both as #153 implements it
(`js/packages/cli/src/cache/cache-directory.ts`):

1. A `.git` entry marks a working tree whether it is a directory or a file, and no git process is run; the default directory is
   still refused at or below the store root, which the card's "always used" does not say but the design's rule that the cache is
   never in the store does. A cache that may not serve the store is not used, as if `--no-cache` were given, with no warning.
2. An absolute `XDG_CACHE_HOME` is used on every platform, macOS included, where the I2 design names `~/Library/Caches`; a
   relative one is ignored, as the XDG Base Directory Specification says. The first is a deviation from the design recorded on
   #25. Draft v0.17's §14.3 did not say which applies on macOS; Draft v0.18 states the code's rule.

## Why

The card's reason: "The attack needs the cache pointed into a workspace on purpose, which only an explicit setting does; the
default per-user directory is the user's own, which the design already trusts. So (c) closes the hole without costing dotfiles
users their default cache."

Why (a), (b) and (d) lost: the card's reason above, and the card's consequences for each: under (a) a dotfiles user gets no cache
for any store under home unless they set `XDG_CACHE_HOME` outside it; (b) closes submodules, not an independent clone inside
another; (d) leaves the gap, documented.

## Owner's note

The project owner chose (c) on the review desk on 2026-10-20, with no note.

## Applied in

#153 (`02044ed`): the I2 design's section 6.2.1 and `js/packages/cli/src/cache/cache-directory.ts`. Draft v0.18: §14.3 (the
cache's location, `XDG_CACHE_HOME`, and the guard).
