# AGENTS.md

Vollmond MD (vmd) is a record format and an access framework over Markdown, YAML and JSON, for agents, humans and programs. The
specification is a draft and the implementation is in progress: a TypeScript npm workspace in `js/packages/` (`core`, `cli`, and
the private conformance runner `conformance`).
A Python implementation will go in `python/`. `docs/` and `conformance/` are shared by all languages. Node 24 or later is
required for the TypeScript code.

Commands for the TypeScript code, run in `js/` (details in `README.md`):

- `npm ci`: install the pinned dependencies.
- `npm run build`: compile the packages to `dist/`.
- `npm run typecheck`: type check every package, tests included.
- `npm run lint`: Biome lint and format check (`npm run format` fixes formatting).
- `npm test`: run the Vitest tests; no build needed.
- `npm run conformance`: run the conformance suite, after a build.

## Where things are

- `docs/draft/vollmond-proposal.md` is the specification draft. Its status line gives the version and the commits of earlier
  versions. Sections are cited by number: `vollmond-proposal.md §7.3`.
- `docs/decisions/` holds every decision, **one record per decision**, named by its id (`G3.md`, `H2.3.md`): the question, the
  options with their consequences, the decision, why it won and why the others lost, the project owner's words, and where it was
  applied. It is a vmd store, with its schema in `docs/decisions/.vmd/schema/`. Compare a bug or a feature request with the
  decisions it touches before choosing how to address it.
- `docs/draft/vollmond-proposal-review.md` holds the review of Draft v0.1 and the **decision log**: the index of the decision
  records, one line per decision, grouped by round.
- `docs/plan/implementation-plan.md` breaks the implementation into phases and tasks. Each task is a GitHub issue, and each phase a
  milestone. Work is tracked in GitHub issues.

## Changing the proposal

- **A decision gets its record in `docs/decisions/` in the same change that applies it to the draft**, and its line in the
  decision log's index. The draft states the current rule; the options, the reasons and the history live in the record. A
  decision that changes an earlier one lists it in `supersedes`, and the earlier record gets it in `superseded_by` and its new
  `status`. Where the sources hold no rejected option or no reason, the record says "Not recorded."
  `node scripts/check-decisions.mjs`, in `js/` after a build, reads every record and checks the links; CI runs it.
- **The draft is one document with many cross-references.** When a rule changes, update every section that restates it. After
  renumbering a section or an open question (§20), update the places that cite it: other sections, the implementation plan (§21)
  and the rollout plan (§22).
- **Earlier versions are cited by commit hash on `main`.** A hash from a branch can disappear when the branch is merged, so
  check the hashes after a merge.
- **Claims about other systems carry their source.** A fact about GitHub, AWS or a library that the design relies on is checked
  against current documentation, and anything unverified is marked as such in the text.

## Landing

Changes land on `main`, directly or through a pull request, as the project owner says.
