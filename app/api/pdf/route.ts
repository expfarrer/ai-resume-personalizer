// app/api/pdf/route.ts
// Stateless PDF generation from arbitrary content — used by the document
// editor so "Generate PDF" reflects whatever the user has just edited,
// without needing to persist those edits first. For a specific past
// generation's original (unedited) PDF, see /api/generate/[id]/pdf.
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAsciiFilename,
  buildResumeFilename,
  buildResumePdf,
} from "@/lib/pdfBuilder";

export const runtime = "nodejs";

const BodySchema = z.object({
  company: z.string().min(1),
  roleTitle: z.string().min(1),
  tailoredResume: z.string().min(1),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body for PDF generation" },
      { status: 400 },
    );
  }

  const { company, roleTitle, tailoredResume } = parsed.data;
  const pdfBytes = await buildResumePdf({ company, roleTitle, tailoredResume });
  const filename = buildResumeFilename(company, roleTitle);
  const asciiFilename = buildAsciiFilename(filename).replace(/"/g, "");

  return new NextResponse(pdfBytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
