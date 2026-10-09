# AGENTS.md

Vollmond MD (vmd) is a record format and an access framework over Markdown, YAML and JSON, for agents, humans and programs. The
project is at the specification stage: there is no code yet.

## Where things are

- `docs/draft/vollmond-proposal.md` is the specification draft. Its status line gives the version and the commits of earlier
  versions. Sections are cited by number: `vollmond-proposal.md §7.3`.
- `docs/draft/vollmond-proposal-review.md` holds the review of Draft v0.1 and the **decision log**: one section per round of
  discussion, recording what the project owner decided.

## Changing the proposal

- **A decision goes into the decision log in the same change that applies it to the draft.** The draft states the current rule;
  the reasons and the history live in the log.
- **The draft is one document with many cross-references.** When a rule changes, update every section that restates it. After
  renumbering a section or an open question (§20), update the places that cite it: other sections, the implementation plan (§21)
  and the rollout plan (§22).
- **Earlier versions are cited by commit hash on `main`.** A hash from a branch can disappear when the branch is merged, so
  check the hashes after a merge.
- **Claims about other systems carry their source.** A fact about GitHub, AWS or a library that the design relies on is checked
  against current documentation, and anything unverified is marked as such in the text.

## Landing

Changes land on `main`, directly or through a pull request, as the project owner says.
