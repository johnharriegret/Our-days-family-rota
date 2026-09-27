import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { apiError, withApi } from "@/lib/api";
import { extractSchoolCalendarFromFile } from "@/lib/schoolVisionImport";

// Vision analysis can take a while; give it more than the platform default.
export const maxDuration = 60;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
// Vercel's serverless functions cap the whole request body well under this
// (base64 inflates a file by ~33%), so this keeps real file size comfortably
// under that ceiling and gives a clear error instead of an opaque 413.
const MAX_BASE64_CHARS = 4_000_000; // ~2.9MB of real file data

export async function POST(request: Request) {
  return withApi(async () => {
    await requireRole("ADMIN", "PARENT");

    if (!process.env.ANTHROPIC_API_KEY) {
      return apiError(
        "Photo/PDF import isn't set up on this deployment yet (needs an ANTHROPIC_API_KEY). Use \"Import from text\" for now.",
        501,
      );
    }

    const body = await request.json();
    const { base64, mimeType, academicYearStart } = body as {
      base64?: string;
      mimeType?: string;
      academicYearStart?: number;
    };
    if (!base64 || !mimeType) return apiError("A file is required", 422);
    if (!ALLOWED_MIME.has(mimeType)) return apiError("Only PNG, JPG, WebP or PDF files are accepted", 422);
    if (base64.length > MAX_BASE64_CHARS) {
      return apiError(
        "That file is too large. Try a smaller photo (or lower-resolution scan), or paste the dates as text instead.",
        413,
      );
    }

    try {
      const result = await extractSchoolCalendarFromFile({
        base64,
        mimeType,
        academicYearStart: typeof academicYearStart === "number" ? academicYearStart : undefined,
      });
      return NextResponse.json(result);
    } catch (err) {
      console.error("Vision import failed", err);
      return apiError("Couldn't analyse that document. Try a clearer photo/PDF, or paste the dates as text instead.", 502);
    }
  });
}
