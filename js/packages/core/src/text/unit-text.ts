/**
 * The text of one parse unit as its parser reads it, with the way back to the file: a part of the file's decoded text,
 * possibly changed (line breaks read as LF, or an indentation removed from each line), and for each index into it the index
 * of the same place in the file's text, as the start of a range and as its end.
 */
export interface UnitText {
  /** The text the parser reads. */
  readonly text: string;
  /**
   * Converts an index into {@link UnitText.text}, from 0 to its length, to the UTF-16 index of the same place in the file's
   * text, which `SourceText.byteOffset` turns into a byte offset, as the start of a range: at the start of a line, it is after
   * whatever the unit left out of the file there, such as an indentation. Indexes keep their order. Throws a `RangeError` for
   * an index outside `[0, text.length]`.
   */
  fileIndex(index: number): number;
  /**
   * Converts an index as {@link UnitText.fileIndex} does, but as the end of a range: at the start of a line, it is before
   * whatever the unit left out of the file there, so that a range ending with a line break does not take the next line's
   * indentation. It is never after `fileIndex` of the same index. Throws a `RangeError` for an index outside
   * `[0, text.length]`.
   */
  fileEnd(index: number): number;
}

/**
 * Gives the unit text of `fileText.slice(start, end)`, whose index 0 is index `start` of the file's text.
 *
 * Throws a `RangeError` unless `0 <= start <= end <= fileText.length`.
 */
export function sliceUnitText(fileText: string, start: number, end: number): UnitText {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > fileText.length) {
    throw new RangeError(`[${start}, ${end}) is not a range of the text`);
  }
  const text = fileText.slice(start, end);
  const fileIndex = (index: number): number => {
    checkIndex(index, text.length);
    return start + index;
  };
  return { text, fileIndex, fileEnd: fileIndex };
}

const CR = 0x0d;
const LF = 0x0a;

/** A line of an indented unit: where it starts in the unit text and in the file, and how many spaces the unit left out. */
interface IndentedLine {
  readonly unitStart: number;
  /** The file index of the line's first character in the unit, after the spaces left out. */
  readonly fileStart: number;
  readonly removed: number;
}

/**
 * Gives the unit text of `fileText.slice(start, end)` with up to `indent` spaces removed from the start of each line, as
 * CommonMark removes a fenced code block's indentation from its content lines: only spaces, so a tab stops the removal.
 * Lines end at LF, CRLF or a lone CR, which the text keeps. At the start of a line, `fileIndex` is after the spaces removed
 * and `fileEnd` before them, except at index 0, where both are after them.
 *
 * Throws a `RangeError` unless `0 <= start <= end <= fileText.length` and `indent` is a natural number.
 *
 * Note: `fileIndex` and `fileEnd` cost the logarithm of the number of lines.
 */
export function sliceIndentedUnitText(fileText: string, start: number, end: number, indent: number): UnitText {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > fileText.length) {
    throw new RangeError(`[${start}, ${end}) is not a range of the text`);
  }
  if (!Number.isInteger(indent) || indent < 0) throw new RangeError(`${indent} is not an indentation`);
  const lines: IndentedLine[] = [];
  let text = "";
  for (let line = start; line < end; ) {
    let removed = 0;
    while (removed < indent && line + removed < end && fileText.charCodeAt(line + removed) === 0x20) removed += 1;
    let next = line + removed;
    while (next < end && fileText.charCodeAt(next) !== LF && fileText.charCodeAt(next) !== CR) next += 1;
    if (next < end) next += fileText.charCodeAt(next) === CR && fileText.charCodeAt(next + 1) === LF && next + 1 < end ? 2 : 1;
    lines.push({ unitStart: text.length, fileStart: line + removed, removed });
    text += fileText.slice(line + removed, next);
    line = next;
  }
  /** The last line that starts at or before `index` in the unit text. */
  const lineAt = (index: number): IndentedLine | undefined => {
    let low = 0;
    let high = lines.length - 1;
    let found: IndentedLine | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const candidate = lines[middle] as IndentedLine;
      if (candidate.unitStart <= index) {
        found = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  };
  const fileIndex = (index: number): number => {
    checkIndex(index, text.length);
    const line = lineAt(index);
    return line === undefined ? start : line.fileStart + (index - line.unitStart);
  };
  return {
    text,
    fileIndex,
    fileEnd: (index) => {
      const after = fileIndex(index);
      const line = lineAt(index);
      // At a line's start, a range ends before the spaces removed there.
      if (line === undefined || line.unitStart !== index || index === 0) return after;
      return after - line.removed;
    },
  };
}

/**
 * Reads the line breaks of a unit text as LF: a CRLF becomes LF, and so does a lone CR. Other characters, a `\r` escape among
 * them, are kept. The index of the LF that a CRLF becomes maps to the CR, and the index after it to the place after the LF,
 * so a range that ends before a line break ends before the CRLF in the file. Returns `unit` itself when it holds no CR.
 *
 * Note: the result holds one number for each CRLF, and `fileIndex` and `fileEnd` cost the logarithm of their count.
 */
export function readLineBreaksAsLf(unit: UnitText): UnitText {
  const source = unit.text;
  if (!source.includes("\r")) return unit;
  // The index in the new text of the LF of each CRLF, whose CR is dropped, in ascending order.
  const droppedAt: number[] = [];
  let text = "";
  let copiedTo = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) !== CR) continue;
    if (source.charCodeAt(i + 1) === LF) {
      text += source.slice(copiedTo, i);
      droppedAt.push(text.length);
      copiedTo = i + 1;
    } else {
      text += `${source.slice(copiedTo, i)}\n`;
      copiedTo = i + 1;
    }
  }
  text += source.slice(copiedTo);
  return {
    text,
    fileIndex: (index) => {
      checkIndex(index, text.length);
      return unit.fileIndex(index + countBelow(droppedAt, index));
    },
    fileEnd: (index) => {
      checkIndex(index, text.length);
      return unit.fileEnd(index + countBelow(droppedAt, index));
    },
  };
}

/** Counts the elements of the ascending `sorted` that are less than `value`. */
function countBelow(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] as number) < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function checkIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError(`index ${index} is outside the unit text`);
}
