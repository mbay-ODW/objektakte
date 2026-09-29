/**
 * Normalisiert Kontaktkanäle, damit eingehende Nachrichten zuverlässig zugeordnet werden können.
 * Telefonnummern werden in E.164-ähnliche Ziffernfolgen ohne "+" überführt (Default-Land DE).
 */
export function normalizeChannelValue(kind: string, value: string): string {
  const trimmed = value.trim();
  switch (kind) {
    case "email":
      return trimmed.toLowerCase();
    case "phone":
    case "mobile":
    case "whatsapp":
    case "signal":
    case "fax":
      return normalizePhone(trimmed);
    case "website":
      return trimmed
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
    default:
      return trimmed;
  }
}

export function normalizePhone(value: string, defaultCountryCode = "49"): string {
  let digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.slice(1).replace(/\D/g, "");
  digits = digits.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return defaultCountryCode + digits.slice(1);
  return digits;
}
