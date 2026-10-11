// Sizes as listings print them: counts with thousands separators, and approximate tokens, bytes divided by four.

/** Writes a non-negative integer with a comma between each group of three digits: `1,204`. */
export function formatCount(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${count} is not a count`);
  return String(count).replace(/\B(?=(\d{3})+$)/g, ",");
}

/** The approximate number of tokens in a text of `bytes` UTF-8 bytes: a quarter of its bytes, not rounded. */
export function approximateTokens(bytes: number): number {
  return bytes / 4;
}

/**
 * Writes the approximate tokens of a text of `bytes` bytes, marked `~` and followed by `tok`, with two or three significant
 * digits: `~90 tok`, `~1.2k tok`, `~31k tok`, `~166k tok`, `~1.5M tok`. Below 1,000 tokens the count is rounded to an integer;
 * from 1,000 it is in thousands, with one decimal below ten thousand; from a million, in millions the same way. A count that
 * rounds up to the next unit is written in that unit: 3,999 bytes are `~1.0k tok`, not `~1000 tok`.
 *
 * Throws a `RangeError` when `bytes` is not a non-negative safe integer.
 */
export function formatTokens(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError(`${bytes} is not a size in bytes`);
  return `~${scaled(approximateTokens(bytes))} tok`;
}

/** Writes a non-negative number with two or three significant digits and a unit suffix, as {@link formatTokens} describes. */
function scaled(value: number): string {
  if (Math.round(value) < 1000) return String(Math.round(value));
  for (const [unit, suffix] of [
    [1e3, "k"],
    [1e6, "M"],
    [1e9, "G"],
  ] as const) {
    const tenths = Math.round((value / unit) * 10);
    if (tenths < 100) return `${(tenths / 10).toFixed(1)}${suffix}`;
    const whole = Math.round(value / unit);
    if (whole < 1000 || suffix === "G") return `${whole}${suffix}`;
  }
  throw new Error("unreachable");
}
