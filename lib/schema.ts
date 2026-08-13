// lib/schema.ts
import { z } from "zod";

export const OutputSchema = z.object({
  company: z.string().min(1),
  roleTitle: z.string().min(1),
  adaptationNotes: z.string().min(10),
  tailoredResume: z.string().min(50),
  interviewQuestions: z.array(z.string().min(1)).min(8).max(12),
});

export type Output = z.infer<typeof OutputSchema>;
