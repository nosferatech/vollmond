import { isEmail, isUri, isUriReference, isUuid } from "@hyperjump/json-schema-formats";
import type { Value } from "../value/value.js";

// The lexical spaces of the standard logical types (§4.3), checked by small grammars over the string, never by `Date.parse`,
// whose reading of other forms is implementation-defined. Each reader gives the value's parts, so that comparisons can use
// them without parsing again, or null for a string outside the type's lexical space.

/** The parts of an RFC 3339 full-date. */
export interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The parts of an RFC 3339 partial-time, and its offset when it has one. */
export interface TimeParts {
  readonly hour: number;
  readonly minute: number;
  /** 0 to 59, or 60 for a leap second. */
  readonly second: number;
  /** The digits after the point, as written; `""` when there is no fraction. */
  readonly fraction: string;
  /** The offset from UTC in minutes, `Z` and `-00:00` being 0; null for a local time, which has none. */
  readonly offset: number | null;
}

/** The parts of a date-time or a local date-time. */
export interface DateTimeParts {
  readonly date: DateParts;
  readonly time: TimeParts;
}

/** The parts of an RFC 3339 duration, each 0 when the duration leaves it out. */
export interface DurationParts {
  readonly years: bigint;
  readonly months: bigint;
  readonly weeks: bigint;
  readonly days: bigint;
  readonly hours: bigint;
  readonly minutes: bigint;
  readonly seconds: bigint;
}

/** The parts of a decimal as written: its sign, and the digits before and after the point, either of which may be empty. */
export interface DecimalParts {
  readonly negative: boolean;
  readonly integer: string;
  readonly fraction: string;
}

/** A logical type's check, as the validator applies it to a value of any JSON type. */
export interface LogicalType {
  /** What the type is, for messages: `a date (RFC 3339 full-date)`. */
  readonly description: string;
  /** Whether a value is valid: a value of a JSON type the type does not apply to is, as `format` has it. */
  readonly check: (value: Value) => boolean;
}

const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = 2n ** 63n - 1n;

/** The minutes of 23:59, the only minute of a UTC day that may have a leap second. */
const LAST_MINUTE = 23 * 60 + 59;

/** Reads an RFC 3339 full-date: four digits of year, two of month and two of day that the Gregorian calendar has. */
export function readDate(text: string): DateParts | null {
  return text.length === 10 ? dateAt(text, 0) : null;
}

/**
 * Reads an RFC 3339 full-time: a partial-time with any fraction, then `Z`, `z` or a numeric offset `±hh:mm`. A seconds field
 * of 60 is a leap second, valid only at 23:59 UTC once the offset is applied.
 */
export function readTime(text: string): TimeParts | null {
  const partial = partialTimeAt(text, 0);
  if (partial === null) return null;
  const offset = offsetAt(text, partial.end);
  if (offset === null) return null;
  return leapSecondAllowed(partial.time, offset) ? { ...partial.time, offset } : null;
}

/** Reads an RFC 3339 date-time: a full-date, `T` or `t`, and a full-time. A space separator is not accepted. */
export function readDateTime(text: string): DateTimeParts | null {
  if (text.length < 20 || (text[10] !== "T" && text[10] !== "t")) return null;
  const date = dateAt(text, 0);
  const time = readTime(text.slice(11));
  return date === null || time === null ? null : { date, time };
}

/**
 * Reads TOML 1.0.0's local date-time: a full-date, `T`, `t` or a space, and a partial-time with any fraction and no offset. A
 * leap second is valid only at 23:59, the time being taken as UTC.
 */
export function readLocalDateTime(text: string): DateTimeParts | null {
  if (text.length < 19 || (text[10] !== "T" && text[10] !== "t" && text[10] !== " ")) return null;
  const date = dateAt(text, 0);
  const partial = partialTimeAt(text, 11);
  if (date === null || partial === null || partial.end !== text.length) return null;
  return leapSecondAllowed(partial.time, 0) ? { date, time: { ...partial.time, offset: null } } : null;
}

/**
 * Reads an RFC 3339 Appendix A duration, without regard to case: `P`, then date units in the order Y, M, D with none skipped
 * between the first and the last, and a `T` with time units H, M, S likewise; or weeks alone. No fraction and no sign.
 */
export function readDuration(text: string): DurationParts | null {
  const units = new Map<string, bigint>();
  let index = 1;
  if (text[0] !== "P" && text[0] !== "p") return null;
  // Each unit read, in order: the date part's, then the time part's, each a run with none skipped.
  let section: "date" | "time" = "date";
  let previous: string | null = null;
  while (index < text.length) {
    const character = text[index] as string;
    if (character === "T" || character === "t") {
      if (section === "time" || index + 1 === text.length || units.has("W")) return null;
      section = "time";
      previous = null;
      index += 1;
      continue;
    }
    const start = index;
    while (index < text.length && isDigit(text.charCodeAt(index))) index += 1;
    if (index === start || index === text.length) return null;
    const unit = (text[index] as string).toUpperCase();
    index += 1;
    const order = section === "date" ? DATE_UNITS : TIME_UNITS;
    const position = order.indexOf(unit);
    if (position === -1) return null;
    if (previous !== null && position !== order.indexOf(previous) + 1) return null;
    if (unit === "W" && (units.size > 0 || index !== text.length)) return null;
    previous = unit;
    units.set(section === "time" ? `T${unit}` : unit, BigInt(text.slice(start, index - 1)));
  }
  if (units.size === 0) return null;
  // A unit after weeks, a week after another unit, and a date part that starts in its middle were refused above; a date part
  // that starts with M after Y is fine, while one that skips (Y then D) is not, which the order check covers.
  return {
    years: units.get("Y") ?? 0n,
    months: units.get("M") ?? 0n,
    weeks: units.get("W") ?? 0n,
    days: units.get("D") ?? 0n,
    hours: units.get("TH") ?? 0n,
    minutes: units.get("TM") ?? 0n,
    seconds: units.get("TS") ?? 0n,
  };
}

/** The date units in order: weeks stand alone, so they follow nothing and nothing follows them. */
const DATE_UNITS = ["Y", "M", "D", "W"];
const TIME_UNITS = ["H", "M", "S"];

/**
 * Reads an int64: a number whose value is an integer in [−2^63, 2^63−1], or a string matching `-?(0|[1-9][0-9]*)` whose value
 * is, `"-0"` included. Gives the exact value, or null.
 */
export function readInt64(value: Value): bigint | null {
  const read = readBigint(value);
  return read !== null && read >= MIN_INT64 && read <= MAX_INT64 ? read : null;
}

/** Reads a bigint: as {@link readInt64}, without bounds. */
export function readBigint(value: Value): bigint | null {
  if (typeof value === "number") return Number.isInteger(value) ? BigInt(value) : null;
  if (typeof value !== "string") return null;
  const digits = value.startsWith("-") ? value.slice(1) : value;
  if (digits.length === 0 || (digits.length > 1 && digits[0] === "0")) return null;
  for (let index = 0; index < digits.length; index++) if (!isDigit(digits.charCodeAt(index))) return null;
  return BigInt(value);
}

/** Reads XML Schema 1.1's decimal: an optional sign, then digits with an optional point, at least one digit in all. */
export function readDecimal(text: string): DecimalParts | null {
  let index = 0;
  const sign = text[0];
  if (sign === "+" || sign === "-") index = 1;
  const point = text.indexOf(".", index);
  const integer = text.slice(index, point === -1 ? text.length : point);
  const fraction = point === -1 ? "" : text.slice(point + 1);
  if (integer.length + fraction.length === 0 || !allDigits(integer) || !allDigits(fraction)) return null;
  return { negative: sign === "-", integer, fraction };
}

/** The logical types of §4.3 by format name, each with its check. Every other format name is an annotation. */
export const LOGICAL_TYPES: ReadonlyMap<string, LogicalType> = new Map<string, LogicalType>([
  ["date", stringType("a date (RFC 3339 full-date)", readDate)],
  ["time", stringType("a time with an offset (RFC 3339 full-time)", readTime)],
  ["date-time", stringType("a date-time with an offset (RFC 3339 date-time)", readDateTime)],
  ["local-date-time", stringType("a local date-time (TOML 1.0.0)", readLocalDateTime)],
  ["duration", stringType("a duration (RFC 3339 Appendix A)", readDuration)],
  [
    "int64",
    {
      description: "an int64: an integer from -9223372036854775808 to 9223372036854775807, as a number or a decimal string",
      check: (value) => (typeof value !== "number" && typeof value !== "string") || readInt64(value) !== null,
    },
  ],
  [
    "bigint",
    {
      description: "a bigint: an integer, as a number or a decimal string",
      check: (value) => (typeof value !== "number" && typeof value !== "string") || readBigint(value) !== null,
    },
  ],
  ["decimal", stringType("a decimal (XML Schema 1.1), without an exponent", readDecimal)],
  ["uri", stringType("a URI (RFC 3986)", (text) => (isUri(text) ? text : null))],
  ["uri-reference", stringType("a URI reference (RFC 3986)", (text) => (isUriReference(text) ? text : null))],
  ["email", stringType("an email address (RFC 5321)", (text) => (isEmail(text) ? text : null))],
  ["uuid", stringType("a UUID (RFC 4122)", (text) => (isUuid(text) ? text : null))],
]);

/** A logical type of strings, which every other JSON type passes. */
function stringType(description: string, read: (text: string) => unknown): LogicalType {
  return { description, check: (value) => typeof value !== "string" || read(value) !== null };
}

/** Reads a full-date at `start`, its ten characters being the date. */
function dateAt(text: string, start: number): DateParts | null {
  const year = digitsAt(text, start, 4);
  const month = digitsAt(text, start + 5, 2);
  const day = digitsAt(text, start + 8, 2);
  if (year === null || month === null || day === null || text[start + 4] !== "-" || text[start + 7] !== "-") return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Reads a partial-time at `start`: `hh:mm:ss` and an optional fraction, giving where it ends. */
function partialTimeAt(text: string, start: number): { readonly time: Omit<TimeParts, "offset">; readonly end: number } | null {
  const hour = digitsAt(text, start, 2);
  const minute = digitsAt(text, start + 3, 2);
  const second = digitsAt(text, start + 6, 2);
  if (hour === null || minute === null || second === null) return null;
  if (text[start + 2] !== ":" || text[start + 5] !== ":" || hour > 23 || minute > 59 || second > 60) return null;
  let end = start + 8;
  let fraction = "";
  if (text[end] === ".") {
    const first = end + 1;
    end = first;
    while (end < text.length && isDigit(text.charCodeAt(end))) end += 1;
    if (end === first) return null;
    fraction = text.slice(first, end);
  }
  return { time: { hour, minute, second, fraction }, end };
}

/** Reads the offset that ends the text at `start`: `Z`, `z` or `±hh:mm`, in minutes; null when it is not one. */
function offsetAt(text: string, start: number): number | null {
  const sign = text[start];
  if (sign === "Z" || sign === "z") return start + 1 === text.length ? 0 : null;
  if ((sign !== "+" && sign !== "-") || text.length !== start + 6 || text[start + 3] !== ":") return null;
  const hours = digitsAt(text, start + 1, 2);
  const minutes = digitsAt(text, start + 4, 2);
  if (hours === null || minutes === null || hours > 23 || minutes > 59) return null;
  return (sign === "-" ? -1 : 1) * (hours * 60 + minutes);
}

/** Whether a time's seconds field is valid with this offset: 60 only at 23:59 UTC. */
function leapSecondAllowed(time: Omit<TimeParts, "offset">, offset: number): boolean {
  if (time.second !== 60) return true;
  return (((time.hour * 60 + time.minute - offset) % 1440) + 1440) % 1440 === LAST_MINUTE;
}

/** Reads `count` ASCII digits at `start` as a number, or null when they are not all there. */
function digitsAt(text: string, start: number, count: number): number | null {
  if (start + count > text.length) return null;
  let value = 0;
  for (let index = start; index < start + count; index++) {
    const code = text.charCodeAt(index);
    if (!isDigit(code)) return null;
    value = value * 10 + code - 48;
  }
  return value;
}

/** The days of a month of the Gregorian calendar. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function allDigits(text: string): boolean {
  for (let index = 0; index < text.length; index++) if (!isDigit(text.charCodeAt(index))) return false;
  return true;
}
