import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_TOKEN: z.string().min(8, "API_TOKEN muss mindestens 8 Zeichen lang sein"),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
