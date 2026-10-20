import type { Issue } from "../issue/issue.js";
import { fail, type Outcome, succeed } from "../issue/outcome.js";
import type { FileInfo, StorageReader } from "./storage.js";

/** How many paths a page of the listing holds. */
const LIST_PAGE = 1000;

/**
 * Lists every file of a backend but the paths `exclude` matches, those `glob` matches when given, page by page, with the
 * issues of the pages, among them the `storage-failed` of each file it could not read. Fails as the backend's `list` does.
 */
export async function listEveryFile(
  backend: StorageReader,
  exclude: readonly string[],
  glob?: string,
): Promise<Outcome<FileInfo[]>> {
  const files: FileInfo[] = [];
  const issues: Issue[] = [];
  let cursor: string | null = null;
  do {
    const page = await backend.list({
      prefix: "",
      exclude,
      limit: LIST_PAGE,
      ...(glob === undefined ? {} : { glob }),
      ...(cursor === null ? {} : { cursor }),
    });
    if (!page.ok) return fail(page.issues);
    for (const file of page.value.items) files.push(file);
    for (const issue of page.issues) issues.push(issue);
    cursor = page.value.cursor;
  } while (cursor !== null);
  return succeed(files, issues);
}
