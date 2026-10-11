// A generator of candidate regex patterns for the property tests of the portable regex checker. It is not built.
import fc from "fast-check";

/** Pieces of regex syntax, alone and in the combinations the checker treats specially. */
const piece = fc.constantFrom(
  ..."ab-^$.|*+?(){}[],:=!<>&~#0123456789".split(""),
  "\\",
  "\\d",
  "\\b",
  "\\B",
  "\\s",
  "\\S",
  "[^",
  "\\x4",
  "\\x41",
  "\\-",
  "\\]",
  "\\1",
  "\\k",
  "\\p",
  "(?:",
  "(?",
  "{2}",
  "{1,3}",
  "{40}",
  "\u{1F600}",
);

/** Patterns of up to twelve pieces, most of them outside the subset and some inside it. */
export const candidatePatterns: fc.Arbitrary<string> = fc.array(piece, { maxLength: 12 }).map((pieces) => pieces.join(""));
