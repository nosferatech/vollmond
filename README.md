# vollmond
Vollmond MD is mixed data format plus access framework, built around Markdown and Front Matter: 
- provides schema validation, query and update framework.  
- intended to be friendly to humans, agents and applications.
- core formats: Markdown, YAML, JSON.

## Development

The code is a TypeScript npm workspace: `packages/core` (`@vollmond/core`, no Node APIs, so it also runs in browsers and Lambda) and
`packages/cli` (`@vollmond/cli`, the `vmd` command). Plans and specification are in `docs/`.

Prerequisites: Node 24 or later and npm.

```sh
npm ci              # install the pinned dependencies
npm run build       # tsc -b: compile the packages to dist/
npm run typecheck   # type check all packages
npm run lint        # Biome: lint and format check
npm run format      # Biome: rewrite files to the formatting rules
npm test            # Vitest: run all tests
```

CI runs build, type check, lint and tests on every pull request and on pushes to `main`. Dependencies are pinned to exact versions
(`.npmrc`); commit `package-lock.json` with any change to them.
