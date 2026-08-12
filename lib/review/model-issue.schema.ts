import { z } from "zod";

export const MAX_ISSUE_TITLE = 120;
export const MAX_ISSUE_BODY = 2000;

export const modelIssueSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .describe(
        "Exact file path, copied verbatim from get_pr_files_summary. Do not invent or modify it.",
      ),
    line_start: z
      .number()
      .int()
      .positive()
      .describe(
        "First line of the issue in the NEW version of the file (1-based). Use the @@ hunk header as the anchor and count down to the exact line. Do not guess",
      ),
    line_end: z
      .number()
      .int()
      .positive()
      .describe(
        "Last line of the issue (1-based). Equal to line_start for a single-line issue; never less than line_start",
      ),
    severity: z
      .enum(["error", "warning", "nit", "suggestion"])
      .describe(
        "How serious the issue is (error is most serious, suggestion the least). Follow the SEVERITY rubric in the instructions. Use error/warning only when you're confident; if uncertain, use nit/suggestion or skip it entirely.",
      ),
    title: z
      .string()
      .min(1)
      .max(MAX_ISSUE_TITLE)
      .describe(
        `One-line summary of the problem (max ${MAX_ISSUE_TITLE} characters)`,
      ),
    body: z
      .string()
      .min(1)
      .max(MAX_ISSUE_BODY)
      .describe(
        "Markdown explanation: what is wrong and why it matters. Be specific and concise.",
      ),
    suggestion: z
      .string()
      .optional()
      .describe(
        "Optional. The replacement code for the flagged lines — raw code only, ready to paste into the file. No prose, no backticks or ``` fences, no explanations: reasoning belongs in body. If you are not confident in the fix, omit this field entirely — do not send an empty string or a guess.",
      ),
  })
  .refine((v) => v.line_end >= v.line_start, {
    message: "line_end must be >= line_start",
  });

export type ModelIssue = z.infer<typeof modelIssueSchema>;
