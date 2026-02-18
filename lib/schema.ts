// lib/schema.ts
import { z } from "zod";

export const OutputSchema = z.object({
  summary: z.string().min(10),
  resumeBullets: z
    .array(z.string().min(1))
    .length(5, { message: "resumeBullets must have exactly 5 items" }),
  interviewQuestions: z.array(z.string().min(1)).min(8).max(12),
});

export type Output = z.infer<typeof OutputSchema>;
