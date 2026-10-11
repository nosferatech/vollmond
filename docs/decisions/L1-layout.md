---
id: L1-layout
title: "One top-level directory per language"
round: "I0"
date: "2026-10-10"
status: accepted
decided_by: owner
sources:
  card: "L1"
  log: "Decisions of phase I0 / Round trips, queries, the suite and process"
  chat: ["2026-10-10T00:15:09Z"]
  prs: [49]
  commits: ["faf919e"]
---

## Question

The repository root belonged to TypeScript: `package.json`, `tsconfig`, `biome.json` and `packages/` sat at the top, and only
`docs/` (the spec) and `conformance/` (the suite) were language-neutral. A Python implementation, likely the Read and Query
profiles first, needs its own `pyproject`, tools (ruff, pytest) and CI job, and may be followed by other languages. Apache Arrow
is a close precedent: one top-level directory per language around a shared format specification and shared integration tests.
The TypeScript code was still a skeleton (about 20 files), and nothing outside the repository referred to its paths. Where does a
second language's implementation go in the repository? The owner raised it in chat, asking whether a Python implementation
would change the top-level structure.

## Options

- **(a) One directory per language, starting now (`js/`, later `python/`).** Chosen, as recommended. One mechanical PR moves the
  TypeScript workspace into `js/` and updates paths in CI, README, AGENTS.md, Dependabot and the plan's §1.1. The root then holds
  only shared things: `docs/`, `conformance/`, AGENTS.md and one CI workflow per language, each running only when its directory
  changes. Adding `python/` later touches nothing in `js/`. The required CI check becomes one per language, so the ruleset is
  updated in the same change.
- **(b) Keep TypeScript at the root, add `python/` beside it later.** Nothing moves now. Later the root stays npm-shaped and
  Python lives inside it as a guest: root tools (Biome, npm scripts, Dependabot) must be told to skip `python/`, and a Python
  contributor first meets a JavaScript repository. Moving later costs more, with more files, more references and open PRs to
  rebase.
- **(c) A separate repository per language.** The spec and the suite stay here; `vollmond-python` lives in its own
  repository and takes the suite as a git submodule or a tagged release. Each language gets its own releases and CI. A spec
  change then needs coordinated PRs in several repositories, and agents need several checkouts to keep them in step.

## Decision

(a). One top-level directory per language. The TypeScript workspace moves to `js/` in a separate pull request, and Python later
goes to `python/`. `docs/` and `conformance/` stay shared at the root.

## Why

The card's reason: while the TypeScript code is a skeleton the move costs almost nothing, and the layout then matches the
language-neutral spec and suite already at the root; choose (c) instead if another team will own the Python implementation with
its own release cadence. (b) costs more the later the move comes.

## Owner's note

> There is one more consideration for the project structure. I think eventually we will want python implementation (and
> possibly other languages?), will that change the top level structure of the folder in this project?

## Applied in

#49 (`faf919e`), which moved the workspace into `js/` with one aggregate CI check. The id is `L1-layout` because card L's first
item is L1.
