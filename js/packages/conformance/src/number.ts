/** A number of a case file as the runner reads it: its double, or why it is an error. */
export type NumberReading = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly detail: string };

/** A JSON number with no fraction and no exponent, which the data model calls an integer by form. */
const INTEGER_FORM = /^-?(?:0|[1-9][0-9]*)$/;

/**
 * Reads a number of a case file as the data model reads one: it means its nearest double, and `-0` is `0`. Three numbers are
 * errors, since no value can hold them: an integer by form whose double differs from it (`9007199254740993`), a number too large
 * for a double (`1e400`), and a non-zero number that a double rounds to zero (`1e-400`). A fraction or an exponent with more
 * digits than a double holds is not an error, so `1e23` means its nearest double.
 *
 * `source` is the number's text in the file, and `value` the double that `JSON.parse` made of it.
 */
export function readNumber(source: string, value: number): NumberReading {
  if (!Number.isFinite(value)) {
    return { ok: false, detail: `the number ${source} is too large for a double` };
  }
  if (INTEGER_FORM.test(source)) {
    if (BigInt(source) !== BigInt(value)) {
      return { ok: false, detail: `the integer ${source} has no exact double` };
    }
  } else if (value === 0 && /[1-9]/.test(source.split(/[eE]/)[0] ?? "")) {
    return { ok: false, detail: `the number ${source} is not zero, but its double is` };
  }
  return { ok: true, value: value === 0 ? 0 : value };
}
