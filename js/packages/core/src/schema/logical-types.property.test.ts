import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  readBigint,
  readDate,
  readDateTime,
  readDecimal,
  readDuration,
  readInt64,
  readLocalDateTime,
  readTime,
} from "./logical-types.js";

// The oracles are independent of the checks: the calendar is Date.UTC's, and so is a leap second's place in a zoned time, the
// time less its offset taken to UTC by Date.UTC, while a local date-time takes a leap second in any minute; and the lexical forms are regular expressions transcribed from RFC 3339's ABNF (section
// 5.6 and Appendix A), TOML 1.0.0's local date-time, XML Schema 1.1's decimal and §4.3's integer pattern, matched without regard to case where the
// ABNF says so (RFC 5234, section 2.3).

/** Whether a day exists in the Gregorian calendar, by Date.UTC. */
function dayExists(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Whether a seconds field of 60 is allowed at this time with this offset, in minutes: only at 23:59 UTC. The UTC time comes
 * from `Date.UTC`'s arithmetic, which carries the offset across midnight, not from the code's modular formula.
 */
function leapAllowed(hour: number, minute: number, offset: number): boolean {
  const utc = new Date(Date.UTC(2000, 0, 2, hour, minute - offset));
  return utc.getUTCHours() === 23 && utc.getUTCMinutes() === 59;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

const FULL_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const PARTIAL_TIME = "[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?";
const OFFSET = "(?:Z|[+-][0-9]{2}:[0-9]{2})";
const FULL_TIME = new RegExp(`^${PARTIAL_TIME}${OFFSET}$`, "i");
const DATE_TIME = new RegExp(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T${PARTIAL_TIME}${OFFSET}$`, "i");
const LOCAL_DATE_TIME = new RegExp(`^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt ]${PARTIAL_TIME}$`);
const DUR_TIME = "T(?:[0-9]+H(?:[0-9]+M(?:[0-9]+S)?)?|[0-9]+M(?:[0-9]+S)?|[0-9]+S)";
const DUR_DATE = `(?:[0-9]+D|[0-9]+M(?:[0-9]+D)?|[0-9]+Y(?:[0-9]+M(?:[0-9]+D)?)?)(?:${DUR_TIME})?`;
const DURATION = new RegExp(`^P(?:${DUR_DATE}|${DUR_TIME}|[0-9]+W)$`, "i");
const DECIMAL = /^(\+|-)?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/;
const INTEGER = /^-?(0|[1-9][0-9]*)$/;

/** Components of a date and a time, some outside their ranges, so that both valid and invalid strings come out. */
const components = fc.record({
  year: fc.integer({ min: 0, max: 9999 }),
  month: fc.integer({ min: 0, max: 13 }),
  day: fc.integer({ min: 0, max: 32 }),
  hour: fc.integer({ min: 0, max: 24 }),
  minute: fc.integer({ min: 0, max: 60 }),
  second: fc.oneof(fc.integer({ min: 0, max: 61 }), fc.constant(60)),
  fraction: fc.option(fc.stringMatching(/^[0-9]{1,12}$/), { nil: undefined }),
  offset: fc.option(
    fc.record({
      sign: fc.constantFrom("+", "-"),
      hours: fc.integer({ min: 0, max: 24 }),
      minutes: fc.integer({ min: 0, max: 60 }),
    }),
    {
      nil: undefined,
    },
  ),
  zulu: fc.constantFrom("Z", "z"),
  separator: fc.constantFrom("T", "t"),
});
type Components = typeof components extends fc.Arbitrary<infer C> ? C : never;

const dateText = (c: Components) => `${pad(c.year, 4)}-${pad(c.month, 2)}-${pad(c.day, 2)}`;
const partialText = (c: Components) =>
  `${pad(c.hour, 2)}:${pad(c.minute, 2)}:${pad(c.second, 2)}${c.fraction === undefined ? "" : `.${c.fraction}`}`;
const offsetText = (c: Components) =>
  c.offset === undefined ? c.zulu : `${c.offset.sign}${pad(c.offset.hours, 2)}:${pad(c.offset.minutes, 2)}`;
const offsetMinutes = (c: Components) =>
  c.offset === undefined ? 0 : (c.offset.sign === "-" ? -1 : 1) * (c.offset.hours * 60 + c.offset.minutes);

const dateValid = (c: Components) => c.month >= 1 && c.month <= 12 && c.day >= 1 && dayExists(c.year, c.month, c.day);
const offsetValid = (c: Components) => c.offset === undefined || (c.offset.hours <= 23 && c.offset.minutes <= 59);
const timeValid = (c: Components, offset: number) =>
  c.hour <= 23 && c.minute <= 59 && (c.second <= 59 || (c.second === 60 && leapAllowed(c.hour, c.minute, offset)));
/** Whether a local date-time's time is valid: a leap second in any minute, since it has no zone. */
const localTimeValid = (c: Components) => c.hour <= 23 && c.minute <= 59 && c.second <= 60;

/** A mutation of a string: a character replaced, removed or doubled, or a letter's case changed. */
const mutation = fc.record({
  kind: fc.constantFrom("replace", "remove", "double", "case"),
  at: fc.nat(),
  by: fc.constantFrom("0", "9", ":", "-", "T", " ", ".", "+", "Z", "a", "P", "W"),
});
function mutate(text: string, m: { kind: string; at: number; by: string }): string {
  if (text.length === 0) return m.by;
  const i = m.at % text.length;
  const c = text[i] as string;
  switch (m.kind) {
    case "replace":
      return text.slice(0, i) + m.by + text.slice(i + 1);
    case "remove":
      return text.slice(0, i) + text.slice(i + 1);
    case "double":
      return text.slice(0, i) + c + text.slice(i);
    default:
      return text.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + text.slice(i + 1);
  }
}

/** Whether a string the grammar accepts has components in their ranges: what the oracle requires beyond the grammar. */
function dateTimeComponentsValid(text: string, local: boolean): boolean {
  const date = text.slice(0, 10);
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || !dayExists(year, month, day)) return false;
  return timeComponentsValid(text.slice(11), local);
}
function timeComponentsValid(text: string, local: boolean): boolean {
  const hour = Number(text.slice(0, 2));
  const minute = Number(text.slice(3, 5));
  const second = Number(text.slice(6, 8));
  let offset = 0;
  if (!local) {
    const zone = /[Zz]|[+-][0-9]{2}:[0-9]{2}$/.exec(text)?.[0] ?? "Z";
    if (zone.length > 1) {
      const hours = Number(zone.slice(1, 3));
      const minutes = Number(zone.slice(4, 6));
      if (hours > 23 || minutes > 59) return false;
      offset = (zone[0] === "-" ? -1 : 1) * (hours * 60 + minutes);
    }
  }
  if (hour > 23 || minute > 59) return false;
  return second <= 59 || (second === 60 && (local || leapAllowed(hour, minute, offset)));
}

describe("property test 2: dates and times against Date.UTC and RFC 3339's ABNF", () => {
  test("a full-date is valid exactly when its day exists", () => {
    fc.assert(
      fc.property(components, (c) => {
        expect(readDate(dateText(c)) !== null).toBe(dateValid(c));
      }),
      { numRuns: 2000 },
    );
  });

  test("a full-time is valid exactly when its components are, a leap second only at 23:59 UTC after its offset", () => {
    fc.assert(
      fc.property(components, (c) => {
        const valid = offsetValid(c) && timeValid(c, offsetMinutes(c));
        expect(readTime(`${partialText(c)}${offsetText(c)}`) !== null).toBe(valid);
      }),
      { numRuns: 4000 },
    );
  });

  test("a leap second is valid at 23:59 UTC whatever the offset", () => {
    fc.assert(
      fc.property(fc.integer({ min: -(23 * 60 + 59), max: 23 * 60 + 59 }), (offset) => {
        const local = (((23 * 60 + 59 + offset) % 1440) + 1440) % 1440;
        const sign = offset < 0 ? "-" : "+";
        const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60), 2)}:${pad(Math.abs(offset) % 60, 2)}`;
        const time = `${pad(Math.floor(local / 60), 2)}:${pad(local % 60, 2)}:60${zone}`;
        expect(readTime(time)).not.toBeNull();
        const next = `${pad(Math.floor(((local + 1) % 1440) / 60), 2)}:${pad((local + 1) % 60, 2)}:60${zone}`;
        expect(readTime(next)).toBeNull();
      }),
    );
  });

  test("a date-time and a local date-time are valid exactly when their parts are", () => {
    fc.assert(
      fc.property(components, fc.constantFrom("T", "t", " "), (c, localSeparator) => {
        const dateTime = `${dateText(c)}${c.separator}${partialText(c)}${offsetText(c)}`;
        expect(readDateTime(dateTime) !== null).toBe(dateValid(c) && offsetValid(c) && timeValid(c, offsetMinutes(c)));
        const local = `${dateText(c)}${localSeparator}${partialText(c)}`;
        expect(readLocalDateTime(local) !== null).toBe(dateValid(c) && localTimeValid(c));
      }),
      { numRuns: 4000 },
    );
  });

  test("a mutated date, time or date-time is valid exactly when the ABNF and the components accept it", () => {
    const valid = components.filter((c) => dateValid(c) && offsetValid(c) && timeValid(c, offsetMinutes(c)));
    fc.assert(
      fc.property(valid, mutation, (c, m) => {
        const date = mutate(dateText(c), m);
        expect(readDate(date) !== null).toBe(FULL_DATE.test(date) && dateTimeComponentsValid(`${date}T00:00:00`, true));
        const time = mutate(`${partialText(c)}${offsetText(c)}`, m);
        expect(readTime(time) !== null).toBe(FULL_TIME.test(time) && timeComponentsValid(time, false));
        const dateTime = mutate(`${dateText(c)}${c.separator}${partialText(c)}${offsetText(c)}`, m);
        expect(readDateTime(dateTime) !== null).toBe(DATE_TIME.test(dateTime) && dateTimeComponentsValid(dateTime, false));
        const local = mutate(`${dateText(c)}T${partialText(c)}`, m);
        expect(readLocalDateTime(local) !== null).toBe(LOCAL_DATE_TIME.test(local) && dateTimeComponentsValid(local, true));
      }),
      { numRuns: 4000 },
    );
  });
});

describe("property test 2: durations against RFC 3339 Appendix A", () => {
  const digits = fc.stringMatching(/^[0-9]{1,4}$/);
  /** A duration built from the grammar's productions, in a random case. */
  const durTime = fc.oneof(
    fc
      .tuple(digits, fc.option(fc.tuple(digits, fc.option(digits))))
      .map(([h, m]) => `T${h}H${m === null ? "" : `${m[0]}M${m[1] === null ? "" : `${m[1]}S`}`}`),
    fc.tuple(digits, fc.option(digits)).map(([m, s]) => `T${m}M${s === null ? "" : `${s}S`}`),
    digits.map((s) => `T${s}S`),
  );
  const durDate = fc
    .tuple(
      fc.oneof(
        digits.map((d) => `${d}D`),
        fc.tuple(digits, fc.option(digits)).map(([m, d]) => `${m}M${d === null ? "" : `${d}D`}`),
        fc
          .tuple(digits, fc.option(fc.tuple(digits, fc.option(digits))))
          .map(([y, m]) => `${y}Y${m === null ? "" : `${m[0]}M${m[1] === null ? "" : `${m[1]}D`}`}`),
      ),
      fc.option(durTime),
    )
    .map(([date, time]) => `${date}${time ?? ""}`);
  const grammar = fc
    .tuple(
      fc.oneof(
        durDate,
        durTime,
        digits.map((w) => `${w}W`),
      ),
      fc.boolean(),
    )
    .map(([body, lower]) => (lower ? `p${body}`.toLowerCase() : `P${body}`));

  test("every duration the grammar generates is valid", () => {
    fc.assert(
      fc.property(grammar, (text) => {
        expect(readDuration(text)).not.toBeNull();
      }),
      { numRuns: 2000 },
    );
  });

  test("a mutated duration is valid exactly when the ABNF accepts it", () => {
    fc.assert(
      fc.property(grammar, mutation, (text, m) => {
        const mutated = mutate(text, m);
        expect(readDuration(mutated) !== null).toBe(DURATION.test(mutated));
      }),
      { numRuns: 4000 },
    );
  });

  test("§4.3's near misses are not durations", () => {
    for (const text of ["PT1.5S", "P1Y3D", "PT1H30S", "P1W2D", "P", "PT", "P1DT"]) expect(readDuration(text)).toBeNull();
  });
});

describe("property test 2: int64, bigint and decimal against BigInt and XML Schema's expression", () => {
  const MIN = -(2n ** 63n);
  const MAX = 2n ** 63n - 1n;
  const integerText = fc.oneof(
    fc.bigInt({ min: MIN * 4n, max: MAX * 4n }).map(String),
    fc.bigInt({ min: MIN - 3n, max: MIN + 3n }).map(String),
    fc.bigInt({ min: MAX - 3n, max: MAX + 3n }).map(String),
    fc.stringMatching(/^[-+ ]?[0-9]{0,22}(\.[0-9]*)?(e[0-9])?$/),
  );

  test("an int64 or bigint string is valid exactly when it matches §4.3's pattern, and an int64 within the range", () => {
    fc.assert(
      fc.property(integerText, (text) => {
        const lexical = INTEGER.test(text);
        expect(readBigint(text)).toBe(lexical ? BigInt(text) : null);
        const inRange = lexical && BigInt(text) >= MIN && BigInt(text) <= MAX;
        expect(readInt64(text)).toBe(inRange ? BigInt(text) : null);
      }),
      { numRuns: 4000 },
    );
  });

  test("an int64 number is valid exactly when it is an integer within the range, compared as a BigInt", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ noNaN: true, noDefaultInfinity: true }),
          fc.integer(),
          fc.constant(2 ** 63),
          fc.constant(-(2 ** 63)),
        ),
        (number) => {
          const integer = Number.isInteger(number);
          expect(readBigint(number)).toBe(integer ? BigInt(number) : null);
          const inRange = integer && BigInt(number) >= MIN && BigInt(number) <= MAX;
          expect(readInt64(number)).toBe(inRange ? BigInt(number) : null);
        },
      ),
      { numRuns: 4000 },
    );
  });

  test("a decimal is valid exactly when it matches XML Schema 1.1's expression", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[-+ ]?[0-9]{0,4}\.?[0-9]{0,4}([eE][0-9])?$/), (text) => {
        expect(readDecimal(text) !== null).toBe(DECIMAL.test(text));
      }),
      { numRuns: 4000 },
    );
  });
});
