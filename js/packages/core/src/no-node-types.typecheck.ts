// Regression guard: `core` runs in browsers and Lambda, so Node's types must not be visible to it.
// While they are not, the import below is an error and `@ts-expect-error` accepts it. If Node's types
// leak in (for example a dependency starts to reference them, or `types` in the tsconfig changes), the
// import compiles, `@ts-expect-error` becomes unused (TS2578) and the type check fails.
// This file is only type checked; it is not a Vitest test and is not built.

// @ts-expect-error core must not see the types of Node's `fs` module
export type NodeFsModule = typeof import("node:fs");
