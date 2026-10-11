const LF = 0x0a;
const CR = 0x0d;

/** Whether the character at `index` of `text` ends a line: a line feed or a carriage return. */
export function isLineBreak(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code === LF || code === CR;
}

/**
 * Returns the index of the first character of the line that holds `index`: after the line break before it, or `floor`, the
 * start of the text the line is part of, such as the index after a byte order mark, which is not part of the first line.
 */
export function lineStartOf(text: string, index: number, floor = 0): number {
  let start = index;
  while (start > floor && !isLineBreak(text, start - 1)) start -= 1;
  return start;
}

/** Returns the index where the line that holds `index` ends: its line break, or the end of the text. */
export function lineEndOf(text: string, index: number): number {
  let end = index;
  while (end < text.length && !isLineBreak(text, end)) end += 1;
  return end;
}

/**
 * Returns the index of the first character of the line after the one that holds `index`: after its line break, a CRLF
 * counting as one, or the end of the text for the last line.
 */
export function nextLineStart(text: string, index: number): number {
  const end = lineEndOf(text, index);
  if (end === text.length) return end;
  return text.charCodeAt(end) === CR && text.charCodeAt(end + 1) === LF ? end + 2 : end + 1;
}

/** Whether `text` from `start` to `end` holds only spaces and tabs. */
export function isBlank(text: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09) return false;
  }
  return true;
}

/** Whether a character is white space as a Markdown body's ends are trimmed of it: a space, a tab or a line break. */
export function isTrimmedSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === LF || code === CR;
}

/** Reads a part of the text with its line breaks as `\n`: a CRLF becomes one, and so does a lone CR. */
export function withLfLineBreaks(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}
