// app/api/coverletter/pdf/route.ts
// Stateless cover-letter PDF generation from arbitrary content — mirrors
// /api/pdf (same reasoning: reflect whatever the user has just edited,
// no need to persist first). Reuses buildResumePdf itself, since a cover
// letter is structurally the same thing as a resume for rendering
// purposes: plain flowing text, adaptively spaced to fit one page.
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAsciiFilename,
  buildCoverLetterFilename,
  buildResumePdf,
  extractCandidateName,
} from "@/lib/pdfBuilder";

export const runtime = "nodejs";

const BodySchema = z.object({
  company: z.string().min(1),
  roleTitle: z.string().min(1),
  coverLetter: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body for cover letter PDF generation" },
      { status: 400 },
    );
  }

  const { company, roleTitle, coverLetter } = parsed.data;
  const pdfBytes = await buildResumePdf({
    company,
    roleTitle,
    tailoredResume: coverLetter,
    documentLabel: "Cover Letter",
  });
  const filename = buildCoverLetterFilename(extractCandidateName(coverLetter), roleTitle);
  const asciiFilename = buildAsciiFilename(filename).replace(/"/g, "");

  return new NextResponse(pdfBytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
