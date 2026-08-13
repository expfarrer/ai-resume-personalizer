// app/api/pdf/validate/route.ts
// Generates a PDF exactly like /api/pdf, then immediately re-extracts and
// validates it with an independent parser (see lib/pdfValidate.ts) instead
// of trusting our own generation/scoring code. Returns the validation
// report, not the PDF itself.
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildResumePdf } from "@/lib/pdfBuilder";
import { validatePdfExtraction } from "@/lib/pdfValidate";

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
      { error: "Invalid request body for PDF validation" },
      { status: 400 },
    );
  }

  const { company, roleTitle, tailoredResume } = parsed.data;
  const pdfBytes = await buildResumePdf({ company, roleTitle, tailoredResume });
  const result = await validatePdfExtraction(pdfBytes, tailoredResume);

  return NextResponse.json(result);
}
