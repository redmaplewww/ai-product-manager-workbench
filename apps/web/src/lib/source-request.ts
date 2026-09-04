import { z } from "zod";

export const sourceUrlInputSchema = z.object({
  url: z.string().trim().url().max(2048).refine((value) => /^https?:\/\//i.test(value), "only http(s) URLs are allowed"),
  title: z.string().trim().max(160).optional().default("")
});
