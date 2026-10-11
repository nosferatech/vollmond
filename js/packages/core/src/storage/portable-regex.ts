import { type Issue, makeIssue } from "../issue/issue.js";

// Deviation from the specification, recorded in issue #16: no issue code is defined for a grep pattern outside the portable
// subset, so this checker reports `query-invalid`, the code of a query that does not parse, until one is chosen.

/**
 * Checks that a pattern is in the portable regex subset, the syntax that RE2, Python's `re` and ECMAScript (with the `u` flag)
 * all accept with the same structure: literals; the escapes `\d \D \w \W \s \S \t \n \r \f \v`, `\xHH` and a backslash before
 * one of `^ $ \ . * + ? ( ) [ ] { } | /`; classes, with ranges between single characters; `.`; the anchors `^ $ \b \B`;
 * capturing groups and `(?:...)`; alternation; and the greedy and lazy quantifiers `* + ? {n} {n,} {n,m}`, within RE2's
 * limit: each count at most 1000, and the counts of nested `{...}` quantifiers (the maximum, or the minimum for `{n,}`) with
 * a product of at most 1000. The flag `i` is given apart from the pattern.
 *
 * Returns an issue for each construct outside the subset, empty for a portable pattern, which `new RegExp(pattern, "u")`
 * compiles. Backreferences, lookaround, named groups, atomic groups, inline flags, possessive quantifiers, Unicode property
 * escapes, `\uHHHH` and the other escapes one of the three engines lacks are reported, and so is syntax the engines read
 * differently: a `]` first in a class, an unescaped `{`, `}` or `]` outside a class, an unescaped `[` in a class, a `-` in the
 * middle of a class, `&&`, `||` and `~~` in a class, and `{,n}`. A pattern that does not parse (an unclosed group, a reversed
 * range) is reported too. The check is syntactic: the engines still differ in what `\d`, `\w`, `\s`, `\b` and
 * case-insensitive matching accept outside ASCII.
 *
 * Its cost is linear in the length of the pattern.
 */
export function checkPortableRegex(pattern: string): readonly Issue[] {
  if (!pattern.isWellFormed()) {
    return [patternIssue(pattern, "a lone surrogate, which is not a character", null)];
  }
  const checker = new PortableRegexChecker(pattern);
  checker.check();
  return checker.issues;
}

function patternIssue(pattern: string, what: string, column: number | null, hint?: string): Issue {
  const where = column === null ? "" : ` at column ${column}`;
  return makeIssue({
    code: "query-invalid",
    path: null,
    at: null,
    message: `pattern ${JSON.stringify(pattern)}: ${what}${where} is not in the portable regex subset`,
    ...(hint === undefined ? {} : { hint }),
  });
}

/** The characters a backslash may escape outside a class. */
const SYNTAX_CHARACTERS = new Set("^$\\.*+?()[]{}|/");
/** RE2's largest repeat count, which also bounds the product of nested repeat counts. */
const MAX_REPEAT = 1000;
/** What the term before a quantifier was, which decides whether it may be repeated. */
type TermKind = "none" | "atom" | "assertion" | "quantified";
/** What one item of a class is: a single character, which may bound a range, or a set such as `\d`. */
type ClassAtom = { readonly kind: "character"; readonly codePoint: number } | { readonly kind: "set" } | null;

/** A recursive-descent reader of one pattern, which collects the issues it finds. */
class PortableRegexChecker {
  readonly issues: Issue[] = [];
  readonly #pattern: string;
  /** The UTF-16 index of the next character. */
  #index = 0;
  /** Set when the pattern cannot be read further, after the issue that says why. */
  #stopped = false;

  constructor(pattern: string) {
    this.#pattern = pattern;
  }

  /** Reads the whole pattern. */
  check(): void {
    while (!this.#stopped) {
      this.#alternation();
      if (this.#stopped || this.#atEnd()) return;
      // Only an unmatched `)` ends an alternation before the end of the pattern.
      this.#report("an unmatched )", this.#index, "write \\) for a literal parenthesis");
      this.#index += 1;
    }
  }

  /** Reads alternatives up to the end or a `)`, and returns the largest product of nested repeat counts in them. */
  #alternation(): number {
    let product = this.#alternative();
    while (!this.#stopped && this.#peek() === "|") {
      this.#index += 1;
      product = Math.max(product, this.#alternative());
    }
    return product;
  }

  /** Reads one alternative, and returns the largest product of nested repeat counts in its terms. */
  #alternative(): number {
    let last: TermKind = "none";
    // The product of repeat counts in the last term, which a quantifier after it multiplies.
    let termProduct = 1;
    let product = 1;
    while (!this.#stopped && !this.#atEnd()) {
      const start = this.#index;
      const character = this.#peek();
      if (character === "|" || character === ")") break;
      if (
        character === "*" ||
        character === "+" ||
        character === "?" ||
        (character === "{" && this.#braceQuantifier() !== null)
      ) {
        termProduct = this.#quantifier(last, start, termProduct);
        product = Math.max(product, termProduct);
        last = "quantified";
        continue;
      }
      termProduct = 1;
      switch (character) {
        case "{":
          // A brace that only looks like a quantifier, such as `{,3}`, is one construct, reported once.
          this.#report("an unescaped {", start, "write \\{ for a literal brace, or {0,n} for at most n");
          this.#index += 1;
          this.#skip(/^[\d,]*\}/);
          last = "atom";
          break;
        case "}":
        case "]":
          this.#report(`an unescaped ${character}`, start, `write \\${character} for a literal one`);
          this.#index += 1;
          last = "atom";
          break;
        case "^":
        case "$":
          this.#index += 1;
          last = "assertion";
          break;
        case "(":
          termProduct = this.#group();
          product = Math.max(product, termProduct);
          last = "atom";
          break;
        case "[":
          this.#characterClass();
          last = "atom";
          break;
        case "\\":
          last = this.#escape();
          break;
        default:
          this.#advanceCharacter();
          last = "atom";
      }
    }
    return product;
  }

  /**
   * Reads a quantifier and its lazy `?`, at `start`, after a term of kind `last` whose nested repeat counts have the product
   * `inner`, and returns the product with this quantifier's count. As in RE2, only a `{...}` quantifier counts, by its
   * maximum, or its minimum when it has none, and a count of 0 is left out of the product.
   */
  #quantifier(last: TermKind, start: number, inner: number): number {
    if (last === "none") {
      this.#report("a quantifier with nothing to repeat", start, "escape it for a literal character");
    } else if (last === "assertion") {
      this.#report("a quantifier on an anchor", start);
    } else if (last === "quantified") {
      this.#report("a quantifier after a quantifier (possessive or repeated)", start);
    }
    if (this.#peek() === "{") {
      const brace = this.#braceQuantifier() as { readonly length: number; readonly min: number; readonly max: number | null };
      this.#index += brace.length;
      if (this.#peek() === "?") this.#index += 1;
      if (brace.min > MAX_REPEAT || (brace.max !== null && brace.max > MAX_REPEAT)) {
        this.#report(`a repeat count above ${MAX_REPEAT}`, start);
        return 1;
      }
      if (brace.max !== null && brace.min > brace.max) {
        this.#report("a repeat range whose minimum exceeds its maximum", start);
        return 1;
      }
      const count = brace.max ?? brace.min;
      const product = count > 0 ? inner * count : inner;
      if (product > MAX_REPEAT) {
        // Reported once, at the quantifier that takes the product over the limit; the product then counts as within it.
        this.#report(`nested repeat counts whose product is above ${MAX_REPEAT}`, start, "RE2 refuses them");
        return 1;
      }
      return product;
    }
    this.#index += 1;
    if (this.#peek() === "?") this.#index += 1;
    return inner;
  }

  /** Reads `{n}`, `{n,}` or `{n,m}` at the current index without moving, or returns null when the brace is not one. */
  #braceQuantifier(): { readonly length: number; readonly min: number; readonly max: number | null } | null {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(this.#pattern.slice(this.#index));
    if (match === null) return null;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === "" ? null : Number(match[3]);
    return { length: match[0].length, min, max };
  }

  /** Reads a group from its `(` to its `)`, and returns the largest product of nested repeat counts in it. */
  #group(): number {
    const start = this.#index;
    this.#index += 1;
    if (this.#peek() === "?") {
      const rest = this.#pattern.slice(this.#index + 1);
      if (rest.startsWith(":")) {
        this.#index += 2;
      } else if (!this.#excludedGroup(start, rest)) {
        return 1;
      }
    }
    const product = this.#alternation();
    if (this.#stopped) return product;
    if (this.#peek() === ")") {
      this.#index += 1;
    } else {
      this.#report("an unclosed group", start);
      this.#stopped = true;
    }
    return product;
  }

  /**
   * Reports a `(?` group outside the subset, at `start`, whose text after `(?` is `rest`. Returns true when a body follows,
   * from the current index, which the caller reads; false when the group was skipped whole or reading stopped.
   */
  #excludedGroup(start: number, rest: string): boolean {
    const withBody: readonly (readonly [RegExp, string])[] = [
      [/^=/, "a lookahead"],
      [/^!/, "a negative lookahead"],
      [/^<=/, "a lookbehind"],
      [/^<!/, "a negative lookbehind"],
      [/^<[^>]*>/, "a named group, whose syntax the engines do not share"],
      [/^P<[^>]*>/, "a named group, whose syntax the engines do not share"],
      [/^>/, "an atomic group"],
      [/^\|/, "a branch reset group"],
      [/^[A-Za-z-]+:/, "inline flags"],
    ];
    for (const [prefix, what] of withBody) {
      const match = prefix.exec(rest);
      if (match === null) continue;
      this.#report(what, start, what === "inline flags" ? "give the flags i and m with the query" : undefined);
      this.#index += 1 + match[0].length;
      return true;
    }
    const whole: readonly (readonly [RegExp, string])[] = [
      [/^P=[^)]*\)/, "a named backreference"],
      [/^P>[^)]*\)/, "a recursion"],
      [/^#[^)]*\)/, "a comment group"],
      [/^[A-Za-z-]+\)/, "inline flags"],
    ];
    for (const [prefix, what] of whole) {
      const match = prefix.exec(rest);
      if (match === null) continue;
      this.#report(what, start, what === "inline flags" ? "give the flags i and m with the query" : undefined);
      this.#index += 1 + match[0].length;
      return false;
    }
    const what = rest.startsWith("(") ? "a conditional group" : "a group starting with (?";
    this.#report(what, start);
    this.#stopped = true;
    return false;
  }

  /** Reads an escape outside a class and says whether it is an assertion or an atom. */
  #escape(): TermKind {
    const start = this.#index;
    const next = this.#pattern[start + 1];
    if (next === undefined) {
      this.#report("a backslash at the end", start, "write \\\\ for a literal backslash");
      this.#stopped = true;
      return "atom";
    }
    if (next === "b" || next === "B") {
      this.#index += 2;
      return "assertion";
    }
    if (next === "A" || next === "z" || next === "Z" || next === "G") {
      this.#report(`the anchor \\${next}`, start, "use ^ and $");
      this.#index += 2;
      return "assertion";
    }
    this.#characterEscape(false);
    return "atom";
  }

  /** Reads an escape that stands for a character or a set, outside a class or in one, and returns what it is. */
  #characterEscape(inClass: boolean): ClassAtom {
    const start = this.#index;
    const next = this.#pattern.codePointAt(start + 1) as number;
    const letter = String.fromCodePoint(next);
    this.#index += 1 + letter.length;
    if ("dDwWsS".includes(letter)) return { kind: "set" };
    const control: Record<string, number> = { t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d };
    const controlCode = control[letter];
    if (controlCode !== undefined) return { kind: "character", codePoint: controlCode };
    if (SYNTAX_CHARACTERS.has(letter) || (inClass && letter === "-")) return { kind: "character", codePoint: next };
    switch (letter) {
      case "x": {
        const hex = /^[0-9A-Fa-f]{2}/.exec(this.#pattern.slice(this.#index));
        if (hex !== null) {
          this.#index += 2;
          return { kind: "character", codePoint: Number.parseInt(hex[0], 16) };
        }
        const braced = /^\{[^}]*\}/.exec(this.#pattern.slice(this.#index));
        if (braced !== null) {
          this.#report("the escape \\x{...}", start, "use \\xHH for a code point below 0x100, or the character itself");
          this.#index += braced[0].length;
        } else {
          this.#report("\\x without two hexadecimal digits", start);
        }
        return null;
      }
      case "u":
        this.#report("the escape \\u, which RE2 does not accept", start, "use \\xHH below 0x100, or the character itself");
        this.#skip(/^(\{[^}]*\}|[0-9A-Fa-f]{4})/);
        return null;
      case "p":
      case "P":
        this.#report(`the Unicode property escape \\${letter}, which Python's re does not accept`, start);
        this.#skip(/^(\{[^}]*\}|[A-Za-z])/);
        return null;
      case "k":
        this.#report("a named backreference", start);
        this.#skip(/^<[^>]*>/);
        return null;
      case "c":
        this.#report("the control escape \\c", start, "use \\xHH");
        this.#skip(/^[A-Za-z]/);
        return null;
      case "0":
        this.#report("the escape \\0 or an octal escape", start, "use \\x00");
        this.#skip(/^[0-7]{0,2}/);
        return null;
      case "b":
        // Only in a class: outside one, `\b` is an anchor and never reaches here.
        this.#report("\\b in a class, a backspace in two of the engines and an error in RE2", start, "use \\x08");
        return null;
      case "B":
        this.#report("\\B in a class", start);
        return null;
      case "Q":
      case "E":
        this.#report(`the quoting escape \\${letter}`, start, "escape each character");
        return null;
      default:
        break;
    }
    if (letter >= "1" && letter <= "9") {
      this.#report("a backreference", start);
      this.#skip(/^\d*/);
      return null;
    }
    if (/^[A-Za-z0-9]$/.test(letter)) {
      this.#report(`the unknown escape \\${letter}`, start);
      return null;
    }
    this.#report(
      `the escape \\${letter}, which ECMAScript rejects`,
      start,
      inClass ? `write ${letter} unescaped` : `write ${letter} unescaped, or [${letter}]`,
    );
    return null;
  }

  /** Reads a class from its `[` to its `]`. */
  #characterClass(): void {
    const start = this.#index;
    this.#index += 1;
    if (this.#peek() === "^") this.#index += 1;
    const first = this.#index;
    let reported = false;
    if (this.#peek() === "]") {
      this.#report("a ] first in a class, an empty class in ECMAScript and a literal ] elsewhere", this.#index, "write \\]");
      this.#index += 1;
      reported = true;
    }
    while (!this.#stopped) {
      if (this.#atEnd()) {
        // After a `]` first, as in `[^]`, the class is unclosed only for the engines that read that `]` as a literal.
        if (!reported) this.#report("an unclosed class", start);
        this.#stopped = true;
        return;
      }
      const character = this.#peek();
      if (character === "]") {
        this.#index += 1;
        return;
      }
      const atomStart = this.#index;
      if (character === "-" && this.#index !== first && this.#pattern[this.#index + 1] !== "]") {
        this.#report("a - in the middle of a class, outside a range", atomStart, "write \\- for a literal hyphen");
        this.#index += 1;
        continue;
      }
      const low = this.#classAtom();
      if (this.#peek() !== "-" || this.#pattern[this.#index + 1] === "]" || this.#pattern[this.#index + 1] === undefined)
        continue;
      this.#index += 1;
      const highStart = this.#index;
      if (this.#peek() === "-") this.#report("-- in a class", atomStart, "write \\- for a literal hyphen");
      const high = this.#classAtom();
      if (low?.kind === "set" || high?.kind === "set") {
        this.#report(
          "a class escape as the bound of a range",
          low?.kind === "set" ? atomStart : highStart,
          "write \\- for a hyphen",
        );
      } else if (low !== null && high !== null && low.codePoint > high.codePoint) {
        this.#report("a range whose start is above its end", atomStart);
      }
    }
  }

  /** Reads one item of a class: a character, an escape or a set. Returns null after an issue. */
  #classAtom(): ClassAtom {
    const start = this.#index;
    const character = this.#peek();
    if (character === "\\") {
      if (this.#pattern[start + 1] === undefined) {
        this.#report("a backslash at the end", start);
        this.#stopped = true;
        return null;
      }
      return this.#characterEscape(true);
    }
    if (character === "[") {
      const posix = /^\[:[A-Za-z]*:\]/.exec(this.#pattern.slice(start));
      if (posix !== null) {
        this.#report(`the POSIX class ${posix[0]}, which only RE2 accepts`, start, "write the characters, or \\d, \\w or \\s");
        this.#index += posix[0].length;
      } else {
        this.#report("an unescaped [ in a class", start, "write \\[");
        this.#index += 1;
      }
      return null;
    }
    if ((character === "&" || character === "|" || character === "~") && this.#pattern[start + 1] === character) {
      this.#report(`${character}${character} in a class, a set operation in newer engines`, start, `write \\${character}`);
      this.#index += 2;
      return null;
    }
    const codePoint = this.#pattern.codePointAt(start) as number;
    this.#advanceCharacter();
    return { kind: "character", codePoint };
  }

  #skip(expression: RegExp): void {
    const match = expression.exec(this.#pattern.slice(this.#index));
    if (match !== null) this.#index += match[0].length;
  }

  #peek(): string | undefined {
    return this.#pattern[this.#index];
  }

  #atEnd(): boolean {
    return this.#index >= this.#pattern.length;
  }

  #advanceCharacter(): void {
    this.#index += (this.#pattern.codePointAt(this.#index) as number) > 0xffff ? 2 : 1;
  }

  /** Records an issue about the construct at the UTF-16 index `start`, with its column counted in code points from 1. */
  #report(what: string, start: number, hint?: string): void {
    const column = [...this.#pattern.slice(0, start)].length + 1;
    this.issues.push(patternIssue(this.#pattern, what, column, hint));
  }
}
