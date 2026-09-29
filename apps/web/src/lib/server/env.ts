import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";

export interface WebEnv {
  apiUrl: string;
  apiToken: string;
  password: string;
  sessionSecret: string;
  /** Session-Cookie nur über HTTPS senden (Standard in Produktion). */
  secureCookie: boolean;
}

function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

let cached: WebEnv | undefined;

/** Liest die Konfiguration beim ersten Zugriff (nicht beim Build). */
export function webEnv(): WebEnv {
  if (cached) return cached;
  const sessionSecret = required("WEB_SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("WEB_SESSION_SECRET muss mindestens 32 Zeichen lang sein");
  }
  cached = {
    apiUrl: required("API_URL").replace(/\/+$/, ""),
    apiToken: required("API_TOKEN"),
    password: required("WEB_PASSWORD"),
    sessionSecret,
    secureCookie: env.WEB_COOKIE_SECURE ? env.WEB_COOKIE_SECURE !== "false" : !dev,
  };
  return cached;
}
