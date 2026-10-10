# Contributing

vmd is at an early stage: the specification is a draft (`docs/draft/vollmond-proposal.md`) and the implementation has just started
(`docs/plan/implementation-plan.md`). Contributions are welcome, and bug reports and questions as much as code.

## Before you start

- **Open an issue first** for anything larger than a small fix, so the approach can be agreed before you spend time on it. Work is
  tracked in GitHub issues, one per task of the implementation plan.
- **A change to what the specification says** goes into the proposal, and its reason into the decision log
  (`docs/draft/vollmond-proposal-review.md`), in the same pull request. The project owner decides such changes.
- `AGENTS.md` describes the repository's layout and conventions for coding agents and people alike.

## Making a change

- Work on a branch and open a pull request against `main`. `main` accepts only pull requests, merged by squashing.
- Every pull request must pass CI: build, type check, lint, tests and a smoke run of the `vmd` command. Run them locally first:
  `npm ci`, then `npm run build`, `npm run typecheck`, `npm run lint` and `npm test`.
- Keep one pull request to one root cause, and write the failing test before the fix.
- Dependencies are pinned to exact versions; commit `package-lock.json` with any change to them.

## Licence

vmd is MIT-licensed (`LICENSE`). By contributing, you agree that your contribution is licensed under the same terms.
