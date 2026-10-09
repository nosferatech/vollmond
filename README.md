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
npm run build       # tsc -b: compile the packages to dist/ (tests are not built)
npm run typecheck   # type check all packages, tests included, without emitting
npm run lint        # Biome: lint and format check
npm run format      # Biome: rewrite files to the formatting rules
npm test            # Vitest: run all tests; needs no build
```

CI runs build, type check, lint, tests and a smoke run of the built command on every pull request and on pushes to `main`.
Dependencies are pinned to exact versions (`.npmrc`); commit `package-lock.json` with any change to them.

To run the command from a checkout, build first and then use `node packages/cli/dist/main.js --version`, or
`npm exec --workspace @vollmond/cli vmd -- --version`. Do not use `npx vmd`: the registry has an unrelated package named `vmd`, and
`npx` would run that. The `vmd` link in `node_modules/.bin` appears only after a build followed by `npm rebuild` or a fresh
`npm install`, because the link points at a file that `tsc` creates.

`@vollmond/core` must not use Node APIs. Its `tsconfig.json` leaves out Node's types, and `packages/core/src/no-node-types.typecheck.ts`
makes `npm run typecheck` fail if they ever become visible to it.
