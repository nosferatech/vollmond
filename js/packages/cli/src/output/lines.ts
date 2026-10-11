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
  return escapeUnsafe(text, NOTHING_KEPT);
}

const NOTHING_KEPT: ReadonlySet<string> = new Set();

/**
 * The characters {@link terminalText} keeps: a line feed and a tab, and the line and paragraph separators, which are neither
 * controls nor bidirectional formatting characters.
 */
const LINES_KEPT: ReadonlySet<string> = new Set(["\n", "\t", "\u2028", "\u2029"]);

/** The character {@link oneLineWithTabs} keeps: a tab. */
const TAB_KEPT: ReadonlySet<string> = new Set(["\t"]);

/**
 * Returns `text` as {@link oneLine} does, but with its tabs kept, so that a line copied from the output still matches the
 * file it came from.
 */
export function oneLineWithTabs(text: string): string {
  return escapeUnsafe(text, TAB_KEPT);
}

/**
 * Returns text of several lines safe to print on a terminal, so that a record cannot retitle it or reorder what it shows:
 * each control character (C0, DEL and C1) and each bidirectional formatting character (`Bidi_Control`: ALM, LRM, RLM, the
 * embeddings, overrides and isolates) is written as a JSON escape, except the line feed and the tab. A carriage return is
 * escaped like every other control; every other character, the line and paragraph separators included, is kept.
 */
export function terminalText(text: string): string {
  return escapeUnsafe(text, LINES_KEPT);
}

/** Writes each character {@link UNSAFE} matches as a JSON escape, except those in `kept`. */
function escapeUnsafe(text: string, kept: ReadonlySet<string>): string {
  return text.replace(UNSAFE, (c) =>
    kept.has(c) ? c : (SHORT_ESCAPES[c] ?? `\\u${(c.codePointAt(0) as number).toString(16).padStart(4, "0")}`),
  );
}

/** Whether `text` holds a character that {@link oneLine} escapes. */
export function hasUnsafeCharacter(text: string): boolean {
  return text.search(UNSAFE) !== -1;
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
