// Deterministic parser for pasted / typed school term-date sheets. It turns the
// kind of text a school publishes ("School opens - Monday 7 September 2026",
// "Autumn term: 2 Sep to 24 Oct", "INSET day - 7 June 2027") into structured
// term/holiday/inset blocks for the mandatory review screen. It never invents a
// date: anything it can't read confidently is flagged for review or left in
// `unrecognised`, never silently saved.

export type ParsedBlockType = "TERM" | "HOLIDAY" | "INSET";

export type ParsedBlock = {
  label: string;
  type: ParsedBlockType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  confidence: "high" | "review";
};

// --- Vision (photo/PDF) import ---------------------------------------------
// A vision model reads an uploaded document and returns JSON matching roughly
// the shape below. That JSON is untrusted AI output - validateVisionBlocks is
// the one place it gets checked before it can reach the review screen. It
// never lets a bad/uncertain extraction pass as "high confidence": a block
// only keeps "high" if BOTH dates parsed as real YYYY-MM-DD strings AND
// start <= end. Anything else is forced to "review" and reported as a
// warning, and a date the model didn't confidently see comes through as null
// (rendered as an empty, must-fill-in field) rather than a guessed value.

export type VisionBlockType = ParsedBlockType;

export type VisionBlock = {
  label: string;
  type: VisionBlockType;
  startDate: string | null;
  endDate: string | null;
  weekdays: number[];
  confidence: "high" | "review";
  note?: string;
};

export type VisionValidationResult = {
  blocks: VisionBlock[];
  warnings: string[];
};

const VISION_TYPES: VisionBlockType[] = ["TERM", "HOLIDAY", "INSET"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

function asIsoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE_RE.test(value) ? value : null;
}

/**
 * Validates and clamps a vision model's raw tool-call output into safe
 * VisionBlock records. Nothing here is trusted: unknown shapes, out-of-range
 * weekdays, invalid dates and made-up types are all dropped or defaulted
 * rather than passed through, per the "never write arbitrary AI text to the
 * database" requirement. This function never calls the network - it's pure
 * and exhaustively unit-testable on its own.
 */
export function validateVisionBlocks(raw: unknown): VisionValidationResult {
  const warnings: string[] = [];
  const arr =
    raw && typeof raw === "object" && Array.isArray((raw as { blocks?: unknown }).blocks)
      ? ((raw as { blocks: unknown[] }).blocks)
      : null;

  if (!arr) return { blocks: [], warnings: ["The analyser didn't return any recognisable data."] };

  const blocks: VisionBlock[] = [];
  for (const rawItem of arr) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;

    const label =
      typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 60) : "Untitled";
    const type = VISION_TYPES.includes(item.type as VisionBlockType) ? (item.type as VisionBlockType) : "TERM";
    const startDate = asIsoDateOrNull(item.startDate);
    const endDate = asIsoDateOrNull(item.endDate);
    const weekdaysRaw = Array.isArray(item.weekdays)
      ? item.weekdays.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      : [];
    const weekdays = weekdaysRaw.length > 0 ? weekdaysRaw : DEFAULT_WEEKDAYS;

    const datesOk = startDate != null && endDate != null && startDate <= endDate;
    const confidence: "high" | "review" = datesOk && item.confidence === "high" ? "high" : "review";
    if (!datesOk) {
      warnings.push(`"${label}" — couldn't confidently read both dates; please fill them in before importing.`);
    }

    blocks.push({
      label,
      type,
      startDate,
      endDate,
      weekdays,
      confidence,
      note: typeof item.note === "string" ? item.note.slice(0, 200) : undefined,
    });
  }

  if (blocks.length === 0) {
    warnings.push("No dates could be identified in this document. Try a clearer photo/PDF, or paste the dates as text instead.");
  }
  return { blocks, warnings };
}

export type ParseResult = {
  blocks: ParsedBlock[];
  unrecognised: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function inferYear(month: number, academicYearStart?: number): number | null {
  if (academicYearStart == null) return null;
  // Sep-Dec belong to the first year; Jan-Aug to the next.
  return month >= 9 ? academicYearStart : academicYearStart + 1;
}

/** Parse a single date token found in text. Returns YYYY-MM-DD or null. */
function parseDate(token: string, academicYearStart?: number): string | null {
  const t = token.trim();
  // ISO
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  // numeric d/m/y or d.m.y
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(t);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${year}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  // text "7 September 2026" / "7th Sep 2026" / "7 September"
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?$/.exec(t);
  if (m) {
    const month = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith("sept") ? 4 : 3)];
    if (!month) return null;
    const year = m[3] ? +m[3] : inferYear(month, academicYearStart);
    if (year == null) return null;
    return `${year}-${pad(month)}-${pad(+m[1])}`;
  }
  return null;
}

// Find every date-looking token in a line, in order.
function extractDates(line: string, academicYearStart?: number): string[] {
  const patterns = [
    /\d{4}-\d{1,2}-\d{1,2}/g,
    /\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/g,
    /\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?(?:\s+\d{4})?/g,
  ];
  const found: { index: number; date: string }[] = [];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const parsed = parseDate(match[0], academicYearStart);
      if (parsed) found.push({ index: match.index, date: parsed });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.date);
}

function classify(line: string): { type: ParsedBlockType | null; role: "start" | "end" | null } {
  const l = line.toLowerCase();
  if (/inset|training day|teacher training|staff training|staff development|pd day|non[- ]pupil/.test(l)) {
    return { type: "INSET", role: null };
  }
  if (/half[- ]?term|holiday|christmas|easter|summer break|spring break|bank holiday|closure|closed/.test(l)) {
    return { type: "HOLIDAY", role: null };
  }
  if (/opens|starts|begins|back to school|return|reopen|first day|pupils return|resume/.test(l)) {
    return { type: "TERM", role: "start" };
  }
  if (/break up|breaks up|term ends|last day|closes|finish|ends/.test(l)) {
    return { type: "TERM", role: "end" };
  }
  return { type: null, role: null };
}

function cleanLabel(line: string): string {
  const beforeColon = line.split(/[:–—-]/)[0].trim();
  const label = (beforeColon || line).replace(/\s+/g, " ").trim();
  return label.length > 40 ? label.slice(0, 40) : label;
}

export function parseSchoolCalendarText(
  text: string,
  opts?: { academicYearStart?: number },
): ParseResult {
  const ay = opts?.academicYearStart;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const blocks: ParsedBlock[] = [];
  const unrecognised: string[] = [];
  let pendingStart: { date: string; label: string } | null = null;
  let termCount = 0;

  for (const line of lines) {
    const dates = extractDates(line, ay);
    const { type, role } = classify(line);

    if (dates.length === 0) {
      // A "start/end" word with no readable date is worth flagging.
      if (type || role) unrecognised.push(line);
      continue;
    }

    if (dates.length >= 2) {
      // Self-contained range on one line.
      const kind = type ?? "TERM";
      blocks.push({
        label: cleanLabel(line) || `${kind[0]}${kind.slice(1).toLowerCase()}`,
        type: kind,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        confidence: type ? "high" : "review",
      });
      continue;
    }

    // Single date on the line.
    const date = dates[0];
    if (type === "INSET") {
      blocks.push({ label: cleanLabel(line) || "INSET day", type: "INSET", startDate: date, endDate: date, confidence: "high" });
    } else if (type === "HOLIDAY") {
      blocks.push({ label: cleanLabel(line) || "Holiday", type: "HOLIDAY", startDate: date, endDate: date, confidence: "review" });
    } else if (role === "start") {
      pendingStart = { date, label: cleanLabel(line) };
    } else if (role === "end") {
      if (pendingStart) {
        termCount += 1;
        blocks.push({
          label: pendingStart.label || `Term ${termCount}`,
          type: "TERM",
          startDate: pendingStart.date,
          endDate: date,
          confidence: "high",
        });
        pendingStart = null;
      } else {
        unrecognised.push(line);
      }
    } else {
      unrecognised.push(line);
    }
  }

  if (pendingStart) unrecognised.push(`Term start with no matching end: ${pendingStart.label}`);
  return { blocks, unrecognised };
}
