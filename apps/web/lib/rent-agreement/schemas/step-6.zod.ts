import { z } from "zod";

export const step6Schema = z.object({ confirm: z.literal(true) });
export type Step6Payload = z.infer<typeof step6Schema>;
