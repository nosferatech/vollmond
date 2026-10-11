// One line per item: the text of each item kept on its line, and columns aligned for people reading a terminal.

/**
 * The characters that would break a line or act on the terminal: the controls (C0, DEL and C1), the line and paragraph
 * separators, and the bidirectional controls, which can make a line read in another order than it is.
 */
const UNSAFE = /[\p{Cc}\u2028\u2029\p{Bidi_Control}]/gu;

/** The escapes of JSON for the controls it names; every other unsafe character is written as `\uXXXX`. */
const SHORT_ESCAPES: Readonly<Record<string, string>> = { "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r" };

/**
 * Returns `text` safe to print on one line of a terminal: each control character, line or paragraph separator and
 * bidirectional control is written as a JSON escape (`\n`, `\u001b`). Other characters, a backslash included, are kept, so an
 * escape and the same characters typed in the text look alike.
 */
export function oneLine(text: string): string {
  return text.replace(UNSAFE, (c) => SHORT_ESCAPES[c] ?? `\\u${(c.codePointAt(0) as number).toString(16).padStart(4, "0")}`);
}

/** A character a terminal shows two columns wide: East Asian scripts and emoji shown as pictures. */
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}\u3000-\u303f\uff01-\uff60]/u;
/** A character a terminal shows on the column of the one before it: a mark, a zero-width format character. */
const ZERO_WIDTH = /[\p{M}\p{Cf}]/u;

/**
 * Estimates how many terminal columns `text` takes, for alignment: two for East Asian characters and emoji, none for marks and
 * format characters, one for every other code point. It is an estimate: terminals disagree on some characters.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const c of text) {
    if (ZERO_WIDTH.test(c)) continue;
    width += WIDE.test(c) ? 2 : 1;
  }
  return width;
}

/** One printed line of columns: its cells, and how deep it is indented, two spaces per level. */
export interface ColumnRow {
  readonly cells: readonly string[];
  readonly depth?: number;
}

/** Two spaces between columns, as between the columns of every listing. */
const GAP = "  ";

/**
 * Formats rows as aligned columns, one line per row, each line ending with a line break. Every cell is made safe with
 * {@link oneLine}; a column is as wide as its widest cell, the indentation of a row counted in its first cell; columns are
 * separated by two spaces, and a line has no trailing spaces. An empty list gives the empty string.
 */
export function formatColumns(rows: readonly ColumnRow[]): string {
  const lines = rows.map((row) => {
    const cells = row.cells.map(oneLine);
    if (cells.length > 0) cells[0] = "  ".repeat(row.depth ?? 0) + cells[0];
    return cells;
  });
  const widths: number[] = [];
  for (const cells of lines) {
    cells.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, displayWidth(cell));
    });
  }
  return lines
    .map((cells) => {
      const padded = cells.map((cell, column) =>
        column === cells.length - 1 ? cell : cell + " ".repeat((widths[column] as number) - displayWidth(cell)),
      );
      return `${padded.join(GAP).replace(/ +$/, "")}\n`;
    })
    .join("");
}
