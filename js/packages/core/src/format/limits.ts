/**
 * The deepest nesting of arrays and objects (sequences and mappings in YAML) that a parse unit may have, in every format, the
 * unit's top value counting as level 1. A deeper unit is a `syntax-error`, the same on every runtime, whatever its call stack
 * holds. Parsers check it before a library recurses into the unit.
 */
export const MAX_NESTING = 256;

/**
 * The largest record, in bytes: 16 MiB. A larger record is a `syntax-error` whatever it holds, and a store refuses it by its
 * size before reading it.
 */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;
