export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface ParsedCsv {
  header: string[];
  rows: { line: number; cells: string[] }[];
  /** A quoted field was never closed: the file is malformed. */
  unterminated: boolean;
}

/**
 * Small RFC 4180 reader: BOM, CRLF/LF/CR line ends, quoted fields with "" escapes and embedded newlines.
 * Blank lines are skipped. `line` is the physical line a record starts on (header = line 1), for error messages.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => { cells.push(field); field = ""; fieldStarted = false; };
  const endRecord = () => {
    endField();
    if (cells.some((c) => c.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else { if (ch === "\n") line++; field += ch; }
      continue;
    }
    if (ch === '"' && !fieldStarted) { quoted = true; fieldStarted = true; }
    else if (ch === ",") endField();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else { field += ch; fieldStarted = true; }
  }
  const unterminated = quoted;
  if (field !== "" || fieldStarted || cells.length) endRecord();

  const [head, ...rows] = records;
  return { header: (head?.cells ?? []).map((h) => h.trim()), rows, unterminated };
}

export const PEOPLE_COLUMNS = ["name", "email", "title", "department", "orcid", "employeeId", "kind", "rollNo"];
export const ORG_UNIT_COLUMNS = ["name", "type", "parent"];

/** Templates use obviously made-up sample rows. */
export const TEMPLATES = {
  people: [
    PEOPLE_COLUMNS.join(","),
    "Dr. Sample Person,sample.person@university.example,Assistant Professor,Computer Science,,EMP9001,faculty,",
    "Sample Scholar,sample.scholar@university.example,PhD Scholar,Computer Science,,,scholar,RS25901",
  ].join("\n") + "\n",
  "org-units": [
    ORG_UNIT_COLUMNS.join(","),
    "School of Sample Studies,school,Demo University",
    "Department of Sample Science,department,School of Sample Studies",
  ].join("\n") + "\n",
} as const;

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
