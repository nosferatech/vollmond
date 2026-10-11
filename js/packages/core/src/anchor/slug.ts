// The slug of the derived-anchor rule, from a heading's visible text. Every Unicode property comes from the tables generated
// from the pinned Unicode version, so that the slug does not depend on the runtime's own data, except NFC, which comes from the
// runtime: removing the code points the pinned version leaves unassigned first means that every runtime at that version or
// later normalizes the rest alike. The runtime's `toLowerCase` and `trim` are not used: the first applies the Final_Sigma
// context, and the second keeps U+0085, which is White_Space.

import { isDefaultIgnorable, isLetterMarkDigitOrConnector, isUnassigned, isWhiteSpace, lowerCaseOf } from "./unicode/unicode.js";

const HYPHEN = 0x2d;

/**
 * Computes the slug of a heading from its visible text, the text a reader sees with line breaks as `\n`:
 *
 * 1. removes every Default_Ignorable_Code_Point and every code point unassigned in the tables' Unicode version, noncharacters
 *    included, then normalizes to NFC;
 * 2. lower-cases each code point by its default mapping, with no context and no locale;
 * 3. trims White_Space at both ends;
 * 4. turns each White_Space character into `-`, keeps letters, marks, decimal digits, connector punctuation and `-`, and
 *    removes every other character.
 *
 * Hyphens are neither collapsed nor trimmed. The slug may be empty. Costs time linear in the text's length.
 */
export function slugOf(visibleText: string): string {
  let kept = "";
  for (const character of visibleText) {
    const codePoint = character.codePointAt(0) as number;
    if (!isDefaultIgnorable(codePoint) && !isUnassigned(codePoint)) kept += character;
  }
  const lower: number[] = [];
  for (const character of kept.normalize("NFC")) {
    for (const mapped of lowerCaseOf(character.codePointAt(0) as number)) lower.push(mapped.codePointAt(0) as number);
  }
  let first = 0;
  let end = lower.length;
  while (first < end && isWhiteSpace(lower[first] as number)) first += 1;
  while (end > first && isWhiteSpace(lower[end - 1] as number)) end -= 1;
  let slug = "";
  for (let i = first; i < end; i++) {
    const codePoint = lower[i] as number;
    if (isWhiteSpace(codePoint)) {
      slug += "-";
    } else if (codePoint === HYPHEN || isLetterMarkDigitOrConnector(codePoint)) {
      slug += String.fromCodePoint(codePoint);
    }
  }
  return slug;
}

const ANCHOR_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Returns whether `name` is a valid anchor or tag name: an ASCII letter, then ASCII letters, digits, `_` and `-`. */
export function isAnchorName(name: string): boolean {
  return ANCHOR_NAME.test(name);
}
