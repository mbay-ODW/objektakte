import type { Env } from "../env.js";
import { GotenbergRenderer, type PdfRenderer } from "./pdf.js";
import { type FileStorage, LocalStorage, WebDavStorage } from "./storage.js";
import { OpenAiCompatibleTranscriber, type Transcriber } from "./transcriber.js";
import { type EInvoiceValidator, HttpEInvoiceValidator } from "./validator.js";

/** Externe Dienste; in Tests durch Fakes ersetzbar. */
export interface Services {
  storage: FileStorage;
  /** Basisordner in der Dateiablage, z. B. "/objektakte" */
  storageBasePath: string;
  pdf?: PdfRenderer;
  transcriber?: Transcriber;
  validator?: EInvoiceValidator;
  /** required = Festschreiben nur nach bestandener externer Prüfung */
  eInvoiceValidation: "required" | "internal";
}

export function servicesFromEnv(env: Env): Services {
  const storage =
    env.STORAGE_BACKEND === "nextcloud"
      ? new WebDavStorage(
          required(env.NEXTCLOUD_URL, "NEXTCLOUD_URL"),
          required(env.NEXTCLOUD_USER, "NEXTCLOUD_USER"),
          required(env.NEXTCLOUD_PASSWORD, "NEXTCLOUD_PASSWORD"),
        )
      : new LocalStorage(env.STORAGE_DIR);
  return {
    storage,
    storageBasePath: env.STORAGE_BASE_PATH,
    pdf: env.GOTENBERG_URL ? new GotenbergRenderer(env.GOTENBERG_URL) : undefined,
    transcriber: env.WHISPER_URL
      ? new OpenAiCompatibleTranscriber(env.WHISPER_URL, env.WHISPER_MODEL, env.WHISPER_API_KEY)
      : undefined,
    validator: env.EINVOICE_VALIDATOR_URL
      ? new HttpEInvoiceValidator(env.EINVOICE_VALIDATOR_URL)
      : undefined,
    eInvoiceValidation: env.EINVOICE_VALIDATION,
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} fehlt (STORAGE_BACKEND=nextcloud)`);
  return value;
}
