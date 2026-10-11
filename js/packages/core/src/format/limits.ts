/**
 * The deepest nesting that a parse unit may have, in every format: of arrays and objects (sequences and mappings in YAML), the
 * unit's top value counting as level 1; in a Markdown body, of block quotes and list items; and, within each Markdown block, of
 * inline elements that hold inline content (emphasis, strong emphasis, strikethrough and links), counted apart from the
 * containers. A deeper unit is a `syntax-error`, the same on every runtime, whatever its call stack holds. Parsers check it
 * before a library recurses into the unit, and the Markdown parser as its library opens each container, and on the tree it
 * builds for inline elements.
 */
export const MAX_NESTING = 256;

/**
 * The most runs of `*`, `_` or `~` that a Markdown paragraph, table cell or heading, or a data `$title`, may hold, each counted
 * on its own; one more is a `syntax-error`.
 */
export const MAX_EMPHASIS_RUNS = 4096;

/**
 * The largest record, in bytes: 16 MiB. A larger record is a `syntax-error` whatever it holds, and a store refuses it by its
 * size before reading it.
 */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;
