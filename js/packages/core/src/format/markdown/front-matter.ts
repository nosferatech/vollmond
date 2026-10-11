import { lineEndOf, nextLineStart } from "./lines.js";

/** Where a Markdown record's front matter is, as indexes into the file's text. */
export type FrontMatterPlace =
  /** The text does not start with a delimiter line: the record has no front matter. */
  | { readonly kind: "none" }
  /** A delimiter line starts the text, and no other follows: the front matter is not closed. */
  | { readonly kind: "unclosed" }
  | {
      readonly kind: "closed";
      /** The YAML between the delimiter lines: from the line after the first to the start of the second. */
      readonly contentStart: number;
      readonly contentEnd: number;
      /** Where the rest of the record starts: the line after the closing delimiter line, or the end of the text. */
      readonly bodyStart: number;
    };

/**
 * Finds the front matter that starts at `start` of `text`, the index after a byte order mark, if any. Front matter is the
 * text between a delimiter line at `start` and the next delimiter line, where a delimiter line is exactly `---` at the start of
 * a line, optionally followed by spaces or tabs, and ended by a line break (LF, CRLF or a lone CR) or the end of the text. So
 * an indented `---`, or a `---` after a U+FEFF, delimits nothing, and nor does a `...` line.
 */
export function findFrontMatter(text: string, start: number): FrontMatterPlace {
  if (!isDelimiterLine(text, start)) return { kind: "none" };
  const contentStart = nextLineStart(text, start);
  for (let line = contentStart; line < text.length; line = nextLineStart(text, line)) {
    if (isDelimiterLine(text, line)) {
      return { kind: "closed", contentStart, contentEnd: line, bodyStart: nextLineStart(text, line) };
    }
  }
  return { kind: "unclosed" };
}

/** Whether the line that starts at `start` is a delimiter line: `---`, then only spaces or tabs. */
function isDelimiterLine(text: string, start: number): boolean {
  if (!text.startsWith("---", start)) return false;
  const end = lineEndOf(text, start);
  for (let i = start + 3; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09) return false;
  }
  return true;
}
