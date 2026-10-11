---
id: chat-1
title: "Agent instructions in AGENTS.md, with project facts only"
round: "chat"
date: "2026-10-09"
status: accepted
decided_by: owner
sources:
  chat: ["2026-10-09T21:37:42Z", "2026-10-09T22:17:53Z"]
  session: ["2026-10-09T21:39:43Z", "2026-10-09T22:18:28Z"]
  commits: ["b34ceb5"]
---

## Question

The repository had no agent instructions. vampiredb's `CLAUDE.md` and guidelines hold rules that would also suit vollmond, but
some are specific to the owner's style of work, and vollmond is public. How are its agent instructions arranged, and in which file?

## Options

On what goes into the public repository:

- **(a) Commit the owner's general working rules into the repository.** Some are specific to the owner's style of work, and the
  repository is public.
- **(b) The general rules live in a private repository loaded at the user level; the repository holds project facts only.**
  Chosen, as the session proposed. Project facts also help outside contributors.

On the file name, after the session wrote a public `CLAUDE.md`:

- **(c) `CLAUDE.md`**, which Claude Code reads.
- **(d) `AGENTS.md`, with a `CLAUDE.md` that only imports it.** Chosen, by the owner. Other agents (Codex, Cursor, Copilot and more)
  read `AGENTS.md`, and the import makes Claude Code load the same file.

## Decision

(b) and (d). The project's instructions are in `AGENTS.md`, holding project facts only: where the draft and the decision log are,
how the proposal changes, and how changes land. `CLAUDE.md` is one line that imports it.

## Why

The owner's reason for (d): contributors can use other agents. The owner's concern behind (b): the repository is public, and some
of the rules are specific to the owner's style of work. The session's reason for (b): project facts help outside contributors too.

## Owner's note

> and and organizational thing: this branch has no CLAUDE.md, and no agent guidelines either. [vampiredb] has CLAUDE.md and docs
> have guidelines for agents. Some of stuff there is specific to vampiredb and rust, but some stuff is not. It would be great if
> the same general rules and agreements could also be used in this project as well. This is a public repo, so not sure if we want
> to commit those to the github, as some of the rules there are kinda specific to my style of work.

> would using AGENTS.md work in vollmond repo? if so, lets rename to AGENTS.md so that contributors can use other agents.

## Applied in

`b34ceb5` ("Add agent instructions for the repository"): `AGENTS.md` and a one-line `CLAUDE.md`. Its rule on the decision log is
[chat-2](chat-2.md).
