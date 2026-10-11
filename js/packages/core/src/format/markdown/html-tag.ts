/** An attribute of an HTML open tag, as CommonMark reads one. */
export interface HtmlAttribute {
  /** The name in ASCII lower case, since HTML compares attribute names without case. */
  readonly name: string;
  /** The value as written, without its quotes and with no character reference decoded; `""` for an attribute without one. */
  readonly value: string;
  /** The index of the value's first character in the text the tag was read from, after its quote. */
  readonly valueStart: number;
}

/** An HTML open tag, as CommonMark's raw HTML syntax defines one. */
export interface HtmlOpenTag {
  /** The tag name in ASCII lower case. */
  readonly name: string;
  /** The attributes in source order, a repeated name included. */
  readonly attributes: readonly HtmlAttribute[];
  /** Whether the tag ends with `/>`. */
  readonly selfClosing: boolean;
  /** The index just after the tag's `>`. */
  readonly end: number;
}

const TAG_NAME = /[A-Za-z][A-Za-z0-9-]*/y;
const ATTRIBUTE_NAME = /[A-Za-z_:][A-Za-z0-9_.:-]*/y;
const VALUE_SEPARATOR = /[ \t\r\n]*=[ \t\r\n]*/y;
const ATTRIBUTE_VALUE = /"([^"]*)"|'([^']*)'|([^ \t\r\n"'=<>`]+)/y;
const WHITE_SPACE = /[ \t\r\n]+/y;
const TAG_END = /[ \t\r\n]*(\/?)>/y;
const CLOSING_TAG = /^<\/([A-Za-z][A-Za-z0-9-]*)[ \t\r\n]*>$/;

/**
 * Reads the HTML open tag that starts at `start` of `text`, by the syntax of CommonMark 0.31.2 (section 6.6): `<`, a tag name,
 * attributes each after white space, with an optional value that is unquoted, single-quoted or double-quoted, then optional
 * white space, an optional `/` and `>`. White space is spaces, tabs and line breaks. Returns null where no open tag starts,
 * such as at a closing tag, a comment or a declaration.
 */
export function readOpenTag(text: string, start: number): HtmlOpenTag | null {
  if (text.charCodeAt(start) !== 0x3c) return null;
  TAG_NAME.lastIndex = start + 1;
  const name = TAG_NAME.exec(text);
  if (name === null) return null;
  const attributes: HtmlAttribute[] = [];
  let index = TAG_NAME.lastIndex;
  for (;;) {
    TAG_END.lastIndex = index;
    const end = TAG_END.exec(text);
    if (end !== null) {
      return { name: name[0].toLowerCase(), attributes, selfClosing: end[1] === "/", end: TAG_END.lastIndex };
    }
    WHITE_SPACE.lastIndex = index;
    if (WHITE_SPACE.exec(text) === null) return null;
    ATTRIBUTE_NAME.lastIndex = WHITE_SPACE.lastIndex;
    const attributeName = ATTRIBUTE_NAME.exec(text);
    if (attributeName === null) return null;
    index = ATTRIBUTE_NAME.lastIndex;
    VALUE_SEPARATOR.lastIndex = index;
    let value = "";
    let valueStart = index;
    if (VALUE_SEPARATOR.exec(text) !== null) {
      ATTRIBUTE_VALUE.lastIndex = VALUE_SEPARATOR.lastIndex;
      const written = ATTRIBUTE_VALUE.exec(text);
      if (written === null) return null;
      value = written[1] ?? written[2] ?? written[3] ?? "";
      valueStart = written[3] === undefined ? VALUE_SEPARATOR.lastIndex + 1 : VALUE_SEPARATOR.lastIndex;
      index = ATTRIBUTE_VALUE.lastIndex;
    }
    attributes.push({ name: attributeName[0].toLowerCase(), value, valueStart });
  }
}

/** Reads the name, in ASCII lower case, of the HTML closing tag that `text` is, such as `</a>`; null when it is not one. */
export function readClosingTagName(text: string): string | null {
  return CLOSING_TAG.exec(text)?.[1]?.toLowerCase() ?? null;
}

/** A token of an HTML `class` attribute: a tag, and the index of its first character. */
export interface ClassToken {
  readonly name: string;
  readonly start: number;
}

/**
 * Splits a `class` attribute's value into its tokens, in source order, on ASCII white space (tab, line feed, form feed,
 * carriage return and space), as HTML splits a set of space-separated tokens. A repeated token is kept each time.
 */
export function classTokens(attribute: HtmlAttribute): ClassToken[] {
  const tokens: ClassToken[] = [];
  for (const match of attribute.value.matchAll(/[^\t\n\f\r ]+/g)) {
    tokens.push({ name: match[0], start: attribute.valueStart + match.index });
  }
  return tokens;
}
