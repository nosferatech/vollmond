import { describe, expect, test } from "vitest";
import {
  LOGICAL_TYPES,
  readBigint,
  readDate,
  readDateTime,
  readDecimal,
  readDuration,
  readInt64,
  readLocalDateTime,
  readTime,
} from "./logical-types.js";

describe("readDate, RFC 3339 full-date", () => {
  test.each(["2026-10-09", "2024-02-29", "2000-02-29", "1999-12-31", "0000-01-01", "9999-12-31"])("%s is a date", (text) => {
    expect(readDate(text)).not.toBeNull();
  });

  test.each([
    "2026-13-45",
    "2026-00-10",
    "2026-10-00",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-10-9",
    "20261009",
    "2026-10-09T08:00:00Z",
    "+2026-10-09",
    "2026-10-09 ",
    "２０２６-10-09",
    "",
  ])("%j is not a date", (text) => {
    expect(readDate(text)).toBeNull();
  });

  test("gives the date's parts", () => {
    expect(readDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });
});

describe("readTime, RFC 3339 full-time", () => {
  test.each([
    "08:00:00Z",
    "08:00:00+02:00",
    "23:59:59-05:30",
    "00:00:00Z",
    "08:00:00.5Z",
    "08:00:00.123456789012Z",
    "08:00:00-00:00",
    "08:00:00z",
    "23:59:60Z",
    "01:59:60+02:00",
    "18:59:60-05:00",
    "00:29:60+00:30",
  ])("%s is a time", (text) => {
    expect(readTime(text)).not.toBeNull();
  });

  test.each([
    "08:00:00",
    "8:00:00Z",
    "24:00:00Z",
    "08:60:00Z",
    "08:00:61Z",
    "08:00Z",
    "08:00:00+2:00",
    "08:00:00+02",
    "08:00:00+0200",
    "08:00:00+24:00",
    "08:00:00+02:60",
    "08:00:00.Z",
    "12:30:60Z",
    "23:59:60+02:00",
    "23:58:60Z",
    "08:00:00 Z",
  ])("%j is not a time", (text) => {
    expect(readTime(text)).toBeNull();
  });

  test("gives the time's parts, with its offset in minutes", () => {
    expect(readTime("01:59:60.25+02:00")).toEqual({ hour: 1, minute: 59, second: 60, fraction: "25", offset: 120 });
    expect(readTime("08:00:00-05:30")).toEqual({ hour: 8, minute: 0, second: 0, fraction: "", offset: -330 });
    expect(readTime("08:00:00Z")?.offset).toBe(0);
  });
});

describe("readDateTime, RFC 3339 date-time", () => {
  test.each([
    "2026-10-09T08:00:00Z",
    "2026-10-09T08:00:00+02:00",
    "2024-02-29T23:59:59-05:30",
    "2026-10-09t08:00:00z",
    "2026-10-09T08:00:00.5Z",
    "2026-12-31T23:59:60Z",
    "2026-12-31T18:59:60-05:00",
    "2027-01-01T00:59:60+01:00",
  ])("%s is a date-time", (text) => {
    expect(readDateTime(text)).not.toBeNull();
  });

  test.each([
    "2026-10-09T08:00:00",
    "2026-10-09",
    "2026-10-09T25:00:00Z",
    "2026-02-30T08:00:00Z",
    "2026-10-09 08:00:00Z",
    "2026-10-09T12:00:60Z",
    "2026-10-09TT08:00:00Z",
  ])("%j is not a date-time", (text) => {
    expect(readDateTime(text)).toBeNull();
  });
});

describe("readLocalDateTime, TOML 1.0.0's local date-time", () => {
  test.each([
    "2026-10-09T08:00:00",
    "2024-02-29T23:59:59",
    "2026-10-09 08:00:00",
    "2026-10-09t08:00:00",
    "2026-10-09T08:00:00.5",
    "2026-10-09T08:00:00.123456789",
    "2026-12-31T23:59:60",
  ])("%s is a local date-time", (text) => {
    expect(readLocalDateTime(text)).not.toBeNull();
  });

  test.each([
    "2026-10-09T08:00:00Z",
    "2026-10-09T08:00:00+02:00",
    "2026-10-09",
    "08:00:00",
    "2026-13-01T08:00:00",
    "2026-10-09T08:15:60",
    "2026-10-09  08:00:00",
  ])("%j is not a local date-time", (text) => {
    expect(readLocalDateTime(text)).toBeNull();
  });
});

describe("readDuration, RFC 3339 Appendix A", () => {
  test.each(["PT10M", "P3D", "P1Y2M", "P1DT12H", "pt10m", "PT0S", "P2W", "P1Y2M3DT4H5M6S", "P1M2D", "PT1M2S", "PT1H2M"])(
    "%s is a duration",
    (text) => {
      expect(readDuration(text)).not.toBeNull();
    },
  );

  test.each([
    "P",
    "PT",
    "10M",
    "P1H",
    "P1DT",
    "PT1.5S",
    "P1Y3D",
    "PT1H30S",
    "P1W2D",
    "P1D2W",
    "P1Y2W",
    "P2WT1H",
    "P-1D",
    "P1DT1S1M",
    " P1D",
    "P1D ",
  ])("%j is not a duration", (text) => {
    expect(readDuration(text)).toBeNull();
  });

  test("gives the duration's parts", () => {
    expect(readDuration("p1y2m3dt4h5m6s")).toEqual({
      years: 1n,
      months: 2n,
      weeks: 0n,
      days: 3n,
      hours: 4n,
      minutes: 5n,
      seconds: 6n,
    });
    expect(readDuration("P2W")?.weeks).toBe(2n);
  });
});

describe("readInt64 and readBigint", () => {
  test.each([
    0,
    42,
    -7,
    9007199254740991,
    -9007199254740991,
    9007199254740992,
    1e3,
    1.0,
    -(2 ** 63),
    "42",
    "-0",
    "0",
    "9007199254740993",
    "9223372036854775807",
    "-9223372036854775808",
  ])("%j is an int64", (value) => {
    expect(readInt64(value)).not.toBeNull();
  });

  test.each([
    "9223372036854775808",
    "-9223372036854775809",
    2 ** 63,
    1.5,
    "1.5",
    "abc",
    "007",
    "+5",
    " 42",
    "1e3",
    "",
    "-",
    "00",
  ])("%j is not an int64", (value) => {
    expect(readInt64(value)).toBeNull();
  });

  test("an int64 reads as its exact value", () => {
    expect(readInt64("-9223372036854775808")).toBe(-(2n ** 63n));
    expect(readInt64("-0")).toBe(0n);
    expect(readInt64(1e3)).toBe(1000n);
  });

  test("bigint is int64 without bounds", () => {
    expect(readBigint("123456789012345678901234567890")).toBe(123456789012345678901234567890n);
    expect(readBigint("9223372036854775808")).toBe(2n ** 63n);
    expect(readBigint(2 ** 70)).toBe(2n ** 70n);
    expect(readBigint("007")).toBeNull();
    expect(readBigint("+5")).toBeNull();
    expect(readBigint(1.5)).toBeNull();
  });
});

describe("readDecimal, XML Schema 1.1's decimal", () => {
  test.each(["0", "123.456", "-0.5", "100", ".5", "+1", "1.", "01", "1.50", "-0"])("%j is a decimal", (text) => {
    expect(readDecimal(text)).not.toBeNull();
  });

  test.each(["1e5", "1.5E3", "abc", "1e3", " 1", ".", "", "+", "-.", "1..2", "1,5"])("%j is not a decimal", (text) => {
    expect(readDecimal(text)).toBeNull();
  });

  test("gives the sign and the digits as written", () => {
    expect(readDecimal("+01.50")).toEqual({ negative: false, integer: "01", fraction: "50" });
    expect(readDecimal("-.5")).toEqual({ negative: true, integer: "", fraction: "5" });
  });
});

describe("LOGICAL_TYPES, the format checks", () => {
  test("names exactly the types of §4.3", () => {
    expect([...LOGICAL_TYPES.keys()].sort()).toEqual(
      [
        "bigint",
        "date",
        "date-time",
        "decimal",
        "duration",
        "email",
        "int64",
        "local-date-time",
        "time",
        "uri",
        "uri-reference",
        "uuid",
      ].sort(),
    );
  });

  test("a check passes a value of a JSON type its type does not apply to", () => {
    const date = LOGICAL_TYPES.get("date");
    expect(date?.check(5)).toBe(true);
    expect(date?.check(null)).toBe(true);
    expect(date?.check("2026-13-01")).toBe(false);
    const int64 = LOGICAL_TYPES.get("int64");
    expect(int64?.check(true)).toBe(true);
    expect(int64?.check(1.5)).toBe(false);
    expect(int64?.check("1.5")).toBe(false);
    const decimal = LOGICAL_TYPES.get("decimal");
    expect(decimal?.check(1.5)).toBe(true);
  });

  test("the identifier formats follow JSON Schema's", () => {
    const check = (name: string, value: string) => LOGICAL_TYPES.get(name)?.check(value);
    expect(check("uri", "https://example.com/a")).toBe(true);
    expect(check("uri", "../a.md")).toBe(false);
    expect(check("uri-reference", "../a.md#b")).toBe(true);
    expect(check("uri-reference", "%zz")).toBe(false);
    expect(check("email", "ada@example.com")).toBe(true);
    expect(check("email", "ada.example.com")).toBe(false);
    expect(check("uuid", "123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(check("uuid", "123e4567e89b12d3a456426614174000")).toBe(false);
  });
});
