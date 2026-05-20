import { z } from "zod";

export const step7Schema = z.object({ agree_to_terms: z.literal(true) });
export type Step7Payload = z.infer<typeof step7Schema>;
