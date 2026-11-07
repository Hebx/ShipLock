export interface AddedLine {
  line: number; // line number in the new file
  text: string;
}

export interface DiffFile {
  path: string; // new path, or old path for deletions
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
  binary: boolean;
  modeChange?: { from?: string; to: string };
  added: AddedLine[];
  deletions: number;
  unparsedPath?: boolean;
}

const DIFF_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses `git diff` unified output (GitHub `application/vnd.github.diff`). Pure text
 * processing: repository content is never executed or interpreted.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let newLine = 0;
  let inHunk = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const header = DIFF_HEADER.exec(raw);
      // Quoted paths (spaces, unicode) are not decoded; the file is still scanned and flagged.
      current = header
        ? { path: header[2]!, status: "modified", binary: false, added: [], deletions: 0 }
        : { path: raw.slice("diff --git ".length), status: "modified", binary: false, added: [], deletions: 0, unparsedPath: true };
      if (header && header[1] !== header[2]) current.oldPath = header[1]!;
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;

    if (!inHunk) {
      if (raw.startsWith("new file mode ")) {
        current.status = "added";
        current.modeChange = { to: raw.slice("new file mode ".length) };
      } else if (raw.startsWith("deleted file mode ")) {
        current.status = "deleted";
      } else if (raw.startsWith("old mode ")) {
        current.modeChange = { from: raw.slice("old mode ".length), to: "" };
      } else if (raw.startsWith("new mode ") && current.modeChange) {
        current.modeChange.to = raw.slice("new mode ".length);
      } else if (raw.startsWith("rename from ")) {
        current.status = "renamed";
        current.oldPath = raw.slice("rename from ".length);
      } else if (raw.startsWith("rename to ")) {
        current.path = raw.slice("rename to ".length);
      } else if (raw.startsWith("Binary files ") || raw === "GIT binary patch") {
        current.binary = true;
      }
    }

    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      inHunk = true;
      newLine = Number(hunk[1]);
      continue;
    }
    if (!inHunk) continue;

    if (raw.startsWith("+")) {
      current.added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith("-")) {
      current.deletions++;
    } else if (raw.startsWith(" ")) {
      newLine++;
    }
    // "\ No newline at end of file" and empty trailing lines are ignored.
  }
  return files;
}
