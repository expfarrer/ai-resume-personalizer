import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const items = await prisma.generation.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        jobDesc: true,
        experience: true,
        resultJson: true,
      },
    });

    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load history" },
      { status: 500 },
    );
  }
}
