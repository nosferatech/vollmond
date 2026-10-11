# vollmond
Vollmond MD is mixed data format plus access framework, built around Markdown and Front Matter: 
- provides schema validation, query and update framework.  
- intended to be friendly to humans, agents and applications.
- core formats: Markdown, YAML, JSON.

## Development

Each language has its own top-level directory. The TypeScript implementation is an npm workspace in `js/`: `js/packages/core`
(`@vollmond/core`, no Node APIs, so it also runs in browsers and Lambda) and `js/packages/cli` (`@vollmond/cli`, the `vmd`
command). A Python implementation will go in `python/`. Plans and specification are in `docs/`, and the conformance suite in
`conformance/`; both are shared by all languages and stay at the root.

Prerequisites: Node 24 or later and npm. Run the commands below in `js/`.

```sh
cd js
npm ci              # install the pinned dependencies
npm run build       # tsc -b: compile the packages to dist/ (tests are not built)
npm run typecheck   # type check all packages, tests included, without emitting
npm run lint        # Biome: lint and format check
npm run format      # Biome: rewrite files to the formatting rules
npm test            # Vitest: run all tests; needs no build
```

CI runs build, type check, lint, tests and a smoke run of the built command on every pull request and on pushes to `main`.
Dependencies are pinned to exact versions (`js/.npmrc`); commit `js/package-lock.json` with any change to them. CI runs the Node
release in `js/.node-version`, raised by hand.

Derived anchors use Unicode tables generated from the Unicode Character Database 17.0.0, committed as
`js/packages/core/src/anchor/unicode/unicode-17.0.0.generated.ts`. `node packages/core/scripts/generate-unicode.mjs` (in `js/`)
regenerates them; it downloads the UCD files and checks their SHA-256 hashes, which it records. A test compares the tables with
the runtime's Unicode data over every code point, when `process.versions.unicode` is the tables' version (17.0, as in Node
24.21.0), and is skipped otherwise. CI sets `VMD_REQUIRE_UNICODE_COMPARISON=1`, which makes that skip a failure.

To run the command from a checkout, build first and then, in `js/`, use `node packages/cli/dist/main.js --version`, or
`npm exec --workspace @vollmond/cli vmd -- --version`. Do not use `npx vmd`: the registry has an unrelated package named `vmd`, and
`npx` would run that. The `vmd` link in `node_modules/.bin` appears only after a build followed by `npm rebuild` or a fresh
`npm install`, because the link points at a file that `tsc` creates.

`@vollmond/core` must not use Node APIs. Its `tsconfig.json` leaves out Node's types, and
`js/packages/core/src/no-node-types.typecheck.ts` makes
`npm run typecheck` fail if they ever become visible to it.
