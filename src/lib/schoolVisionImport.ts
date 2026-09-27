import { validateVisionBlocks, type VisionBlock } from "./schoolImport";

// Server-only by construction: this is imported only from the API route below,
// never from a client component, so the API key never reaches the browser.
// Calls the Anthropic API directly with an uploaded school-calendar photo/PDF
// and a strict tool schema, so the model can only respond in a shape
// validateVisionBlocks then re-checks anyway.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const EXTRACT_TOOL = {
  name: "extract_school_calendar",
  description:
    "Structured school term/holiday/INSET dates extracted from an uploaded term-date letter or annual school calendar image/PDF.",
  input_schema: {
    type: "object",
    properties: {
      legend_understood: {
        type: ["boolean", "null"],
        description:
          "Only for a colour-coded annual calendar: true if you found and understood the colour legend, false if you could not, null if this document has no colour legend (e.g. a plain written list).",
      },
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Short name, e.g. 'Autumn Term 1' or 'INSET Day'." },
            type: { type: "string", enum: ["TERM", "HOLIDAY", "INSET"] },
            startDate: {
              type: ["string", "null"],
              description: "YYYY-MM-DD. Set to null if you cannot confidently read this date - never guess.",
            },
            endDate: {
              type: ["string", "null"],
              description: "YYYY-MM-DD. Set to null if you cannot confidently read this date - never guess.",
            },
            weekdays: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 6 },
              description: "0=Sunday..6=Saturday. Omit entirely for a normal Monday-Friday term.",
            },
            confidence: { type: "string", enum: ["high", "review"] },
            note: { type: "string", description: "Only for a genuinely uncertain item: what is unclear about it." },
          },
          required: ["label", "type", "confidence"],
        },
      },
    },
    required: ["blocks"],
  },
} as const;

export type VisionExtractionResult = {
  blocks: VisionBlock[];
  warnings: string[];
  legendUnderstood: boolean | null;
};

export async function extractSchoolCalendarFromFile(params: {
  base64: string;
  mimeType: string;
  academicYearStart?: number;
}): Promise<VisionExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const isPdf = params.mimeType === "application/pdf";
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.base64 } }
    : { type: "image", source: { type: "base64", media_type: params.mimeType, data: params.base64 } };

  const yearHint = params.academicYearStart
    ? `If a date's year is ambiguous or omitted, assume the academic year starting ${params.academicYearStart} (September-December dates fall in ${params.academicYearStart}, January-August dates fall in ${params.academicYearStart + 1}).`
    : "";

  const instructions = `You are extracting UK school term dates from an uploaded document: either a written term-date letter, or an annual colour-coded school calendar.

Identify:
- TERM blocks: normal school attendance, each with a start and end date.
- HOLIDAY blocks: half term, Christmas, Easter, summer holiday, bank holidays, school closures.
- INSET/training day blocks: usually single dates.

${yearHint}

If this is a colour-coded calendar, find and read its legend to work out what each colour means before extracting dates. If you cannot find or confidently interpret the legend, set legend_understood to false and do not guess what any colour means.

Be conservative. If a date is blurry, cropped, cut off, or you are not genuinely confident, set that field to null and its confidence to "review" - never invent or guess a date you cannot actually read. Only mark a block "high" confidence when you clearly read both its dates.

Call the extract_school_calendar tool with everything you found.`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "extract_school_calendar" },
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: instructions }] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vision analysis request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: Array<Record<string, unknown>> };
  const toolUse = (data.content ?? []).find((c) => c.type === "tool_use" && c.name === "extract_school_calendar");
  if (!toolUse) throw new Error("The analyser did not return structured data.");

  const { blocks, warnings } = validateVisionBlocks(toolUse.input);
  const rawLegend = (toolUse.input as { legend_understood?: unknown } | undefined)?.legend_understood;
  const legendUnderstood = typeof rawLegend === "boolean" ? rawLegend : null;
  if (legendUnderstood === false) {
    warnings.unshift(
      "Couldn't confidently read the colour legend on this calendar — please check every colour-coded date carefully.",
    );
  }
  return { blocks, warnings, legendUnderstood };
}
