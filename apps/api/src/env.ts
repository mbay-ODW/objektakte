import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_TOKEN: z.string().min(8, "API_TOKEN muss mindestens 8 Zeichen lang sein"),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  STORAGE_BACKEND: z.enum(["local", "nextcloud"]).default("local"),
  STORAGE_DIR: z.string().default("./data/files"),
  STORAGE_BASE_PATH: z.string().default("/objektakte"),
  NEXTCLOUD_URL: z.string().url().optional(),
  NEXTCLOUD_USER: z.string().optional(),
  NEXTCLOUD_PASSWORD: z.string().optional(),
  GOTENBERG_URL: z.string().url().optional(),
  WHISPER_URL: z.string().url().optional(),
  WHISPER_MODEL: z.string().default("Systran/faster-whisper-large-v3"),
  WHISPER_API_KEY: z.string().optional(),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(500).default(10000),
  /** URL des E-Rechnungs-Validators (Sidecar aus /validator) */
  EINVOICE_VALIDATOR_URL: z.string().url().optional(),
  /** required = ohne erfolgreiche externe Prüfung kein Festschreiben; internal = nur Vorprüfung */
  EINVOICE_VALIDATION: z.enum(["required", "internal"]).default("required"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
