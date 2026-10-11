import { type Issue, makeIssue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import { checkStoragePath } from "../storage/path.js";

/** An address: a record, by its store path, and the node of it that a fragment names; a null fragment names the root. */
export interface Address {
  readonly record: string;
  readonly fragment: Fragment | null;
}

/**
 * The fragment of an address: an exact path, a JSON Pointer as reference tokens, each unescaped (`~1` read as `/` and `~0`
 * as `~`); or a semantic path, as its steps, each decoded and never empty.
 */
export type Fragment =
  | { readonly kind: "exact"; readonly tokens: readonly string[] }
  | { readonly kind: "semantic"; readonly steps: readonly string[] };

/** How {@link parseAddress} reads an address. */
export interface AddressReading {
  /**
   * Whether characters that a URI fragment does not allow, such as a space or `é`, are taken as themselves rather than
   * refused, as the command line takes them. `/` still separates steps and tokens, and `%` still starts an escape.
   */
  readonly raw?: boolean;
}

/**
 * Reads an address: a record's store path, then optionally `#` and a fragment. No fragment, or `#` alone, is the record's
 * root; a fragment that starts with `/` is an exact path, decoded and then split into reference tokens, and any other is a
 * semantic path, split into steps that are then decoded. Percent-encoded bytes must be UTF-8.
 *
 * Fails with one `address-malformed`, which has no node, for an address that does not match the grammar: a record part that
 * is not a store path (and then the issue has no record either), an empty step, a character a fragment does not allow
 * (unless `raw`), a `%` without two hexadecimal digits, escaped bytes that are not UTF-8, and a `~` in an exact path that
 * is not `~0` or `~1`. The record part is a store path and is not decoded.
 */
export function parseAddress(text: string, reading: AddressReading = {}): Outcome<Address> {
  const hash = text.indexOf("#");
  const record = hash < 0 ? text : text.slice(0, hash);
  const pathIssue = checkStoragePath(record);
  if (pathIssue !== null) return fail([malformedAddress(text, null, pathIssue.message)]);
  const fragmentText = hash < 0 ? "" : text.slice(hash + 1);
  if (fragmentText === "") return succeed({ record, fragment: null });
  if (!fragmentText.isWellFormed()) return fail([malformedAddress(text, record, "its fragment holds a lone surrogate")]);
  const raw = reading.raw === true;
  if (fragmentText.startsWith("/")) {
    const decoded = percentDecode(fragmentText, raw);
    if (typeof decoded !== "string") return fail([malformedAddress(text, record, decoded.problem)]);
    const tokens: string[] = [];
    for (const escaped of decoded.slice(1).split("/")) {
      if (/~(?![01])/u.test(escaped)) {
        return fail([malformedAddress(text, record, `the token ${JSON.stringify(escaped)} has a "~" that is not "~0" or "~1"`)]);
      }
      // `~1` first, so that `~01` reads as `~1` (RFC 6901, section 4).
      tokens.push(escaped.replaceAll("~1", "/").replaceAll("~0", "~"));
    }
    return succeed({ record, fragment: { kind: "exact", tokens } });
  }
  const steps: string[] = [];
  for (const encoded of fragmentText.split("/")) {
    if (encoded === "") return fail([malformedAddress(text, record, "it has an empty step")]);
    const decoded = percentDecode(encoded, raw);
    if (typeof decoded !== "string") return fail([malformedAddress(text, record, decoded.problem)]);
    steps.push(decoded);
  }
  return succeed({ record, fragment: { kind: "semantic", steps } });
}

/**
 * Writes an address as {@link parseAddress} reads it: the record, and for a fragment `#` and the fragment as
 * {@link formatFragment} writes it.
 *
 * Throws a `RangeError` for a fragment that no address can write: an exact path without a token, or a semantic path without a
 * step or with an empty one.
 */
export function formatAddress(address: Address): string {
  return `${address.record}${formatFragment(address.fragment)}`;
}

/**
 * Writes a fragment with its `#`, or `""` for the root's null fragment: an exact path with each token escaped as RFC 6901
 * writes it and then {@link encodeExactPath}'s encoding; a semantic path as its steps, each encoded by {@link encodeStep},
 * joined with `/`.
 *
 * Throws a `RangeError` for an exact path without a token, or a semantic path without a step or with an empty one.
 */
export function formatFragment(fragment: Fragment | null): string {
  if (fragment === null) return "";
  if (fragment.kind === "exact") {
    if (fragment.tokens.length === 0) throw new RangeError("an exact path has at least one token");
    const pointer = fragment.tokens.map((token) => `/${token.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
    return `#${encodeExactPath(pointer)}`;
  }
  if (fragment.steps.length === 0) throw new RangeError("a semantic path has at least one step");
  if (fragment.steps.includes("")) throw new RangeError("a semantic path has no empty step");
  return `#${fragment.steps.map(encodeStep).join("/")}`;
}

/**
 * Percent-encodes a semantic step: every character that a URI fragment does not allow, and `/` and `%`, as the UTF-8 bytes of
 * the character in upper-case hexadecimal, so that `name with space` is `name%20with%20space` and `x:y` stays as it is.
 */
export function encodeStep(step: string): string {
  return percentEncode(step, false);
}

/**
 * Percent-encodes an exact path, given with RFC 6901's escapes (`/a~1b`): every character that a URI fragment does not allow,
 * and `%`, as {@link encodeStep} does. Its `/` separators stay.
 */
export function encodeExactPath(pointer: string): string {
  return percentEncode(pointer, true);
}

/**
 * The characters a URI fragment holds besides `/` and percent escapes (RFC 3986, sections 3.5 and 3.3): `pchar` without
 * `pct-encoded`, and `?`. That is the unreserved characters, the sub-delimiters, `:` and `@`.
 */
const FRAGMENT_CHARACTER = /^[A-Za-z0-9\-._~!$&'()*+,;=:@?]$/u;

const UTF8 = new TextEncoder();
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Encodes every character of `text` but the fragment characters, and `/` when `keepSlash`, as UTF-8 escapes. */
function percentEncode(text: string, keepSlash: boolean): string {
  let encoded = "";
  for (const character of text) {
    if (FRAGMENT_CHARACTER.test(character) || (keepSlash && character === "/")) {
      encoded += character;
    } else {
      for (const byte of UTF8.encode(character)) encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return encoded;
}

// Deviation from the specification, recorded in issue #15: escapes whose bytes are not UTF-8, such as `%E9`, match the
// grammar's `pct-encoded` but are `address-malformed`, since no member name of a value view can hold them.
/**
 * Decodes the percent-encoded text of a step or of a whole exact path, or says why it cannot be decoded. Outside raw reading,
 * every character must be a fragment character, `/` or part of an escape.
 */
function percentDecode(text: string, raw: boolean): string | { readonly problem: string } {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; ) {
    const character = String.fromCodePoint(text.codePointAt(index) as number);
    if (character === "%") {
      const hex = text.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hex))
        return { problem: `the "%" at index ${index} is not followed by two hexadecimal digits` };
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    if (!raw && character !== "/" && !FRAGMENT_CHARACTER.test(character)) {
      return { problem: `${JSON.stringify(character)} at index ${index} must be percent-encoded` };
    }
    bytes.push(...UTF8.encode(character));
    index += character.length;
  }
  try {
    return STRICT_UTF8.decode(new Uint8Array(bytes));
  } catch {
    return { problem: "its percent-encoded bytes are not UTF-8" };
  }
}

/** The issue of an address that does not match the grammar, about the record it names when that much of it reads. */
function malformedAddress(text: string, record: string | null, problem: string): Issue {
  return makeIssue({
    code: "address-malformed",
    path: record,
    at: null,
    message: `${JSON.stringify(text)} is not an address: ${problem}`,
  });
}
