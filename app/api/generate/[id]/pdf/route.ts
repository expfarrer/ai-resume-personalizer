// app/api/generate/[id]/pdf/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { OutputSchema } from "@/lib/schema";
import {
  buildAsciiFilename,
  buildResumeFilename,
  buildResumePdf,
} from "@/lib/pdfBuilder";

export const runtime = "nodejs";

function extractPdfFields(resultJson: string): {
  company: string;
  roleTitle: string;
  tailoredResume: string;
} {
  const parsed = OutputSchema.safeParse(JSON.parse(resultJson));
  if (parsed.success) {
    return {
      company: parsed.data.company,
      roleTitle: parsed.data.roleTitle,
      tailoredResume: parsed.data.tailoredResume,
    };
  }

  // Fall back for history rows saved before company/roleTitle existed.
  const raw = JSON.parse(resultJson);
  const tailoredResume: string =
    typeof raw?.tailoredResume === "string"
      ? raw.tailoredResume
      : [
          typeof raw?.summary === "string" ? raw.summary : "",
          Array.isArray(raw?.resumeBullets) ? raw.resumeBullets.join("\n- ") : "",
        ]
          .filter(Boolean)
          .join("\n\n") || "No content available.";

  return {
    company: typeof raw?.company === "string" ? raw.company : "",
    roleTitle: typeof raw?.roleTitle === "string" ? raw.roleTitle : "",
    tailoredResume,
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const gen = await prisma.generation.findUnique({
    where: { id },
    select: { resultJson: true },
  });

  if (!gen) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { company, roleTitle, tailoredResume } = extractPdfFields(
    gen.resultJson,
  );
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
