import { createHash, timingSafeEqual } from "node:crypto";
import { formatDrDate, formatDrTime } from "@/lib/domain/dr-time";

/**
 * Lógica pura de los recordatorios de citas por WhatsApp (scripts/test-whatsapp-replies.ts):
 * qué plantilla se usa, cómo se arman sus variables y los botones, cómo se reconoce lo que
 * responde el paciente y cómo se autentica la llamada del planificador. Sin Next ni Supabase.
 */

/** Plantilla de recordatorio (creada en la cuenta «Cuido»). Se puede cambiar con WHATSAPP_REMINDER_TEMPLATE. */
export const DEFAULT_REMINDER_TEMPLATE = "recordatorio_cita_v3";
export const REMINDER_TEMPLATE_LANGUAGE = "es";

/** Respuesta que se manda al paciente cuando se da de baja (dentro de la ventana de 24 h que él abre). */
export const OPT_OUT_CONFIRMATION_TEXT =
  "Listo, no recibirá más recordatorios de citas por WhatsApp. Si desea volver a recibirlos, avise en su clínica.";

// ---------------------------------------------------------------------------
// Variables y botones
// ---------------------------------------------------------------------------

/** Meta no admite saltos de línea, tabuladores ni más de 3 espacios seguidos en una variable. */
function cleanParam(text: string, max: number): string {
  return text
    .replace(/[  ]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Variables de la plantilla, en orden: {{1}} clínica, {{2}} fecha («15 de octubre»), {{3}} hora
 * («10:00 a. m.»), ambas en hora de República Dominicana. Nada de datos clínicos ni del paciente.
 */
export function buildReminderParams(clinicName: string, scheduledAt: Date | string): [string, string, string] {
  return [
    cleanParam(clinicName, 60) || "su clínica",
    cleanParam(formatDrDate(scheduledAt, { day: "numeric", month: "long" }), 40),
    cleanParam(formatDrTime(scheduledAt, { hour: "numeric", minute: "2-digit" }), 20),
  ];
}

/** `payload` de los dos botones de la plantilla («Confirmar», «Cancelar»), en ese orden. */
export function reminderButtonPayloads(reminderId: string): [string, string] {
  return [`r:${reminderId}:c`, `r:${reminderId}:x`];
}

const PAYLOAD_RE = /^r:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(c|x)$/i;

export type ReminderAction = "confirmar" | "cancelar";

/** Lee el `payload` de un botón: a qué recordatorio responde y qué eligió. null si no es de un recordatorio. */
export function parseReminderPayload(payload: unknown): { reminderId: string; action: ReminderAction } | null {
  if (typeof payload !== "string") return null;
  const m = PAYLOAD_RE.exec(payload.trim());
  if (!m) return null;
  return { reminderId: m[1].toLowerCase(), action: m[2].toLowerCase() === "c" ? "confirmar" : "cancelar" };
}

// ---------------------------------------------------------------------------
// Baja
// ---------------------------------------------------------------------------

const OPT_OUT_WORDS = new Set(["baja", "stop", "parar", "no mas", "nomas", "dar de baja", "darme de baja"]);

function normalizeReplyText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El texto que escribió el paciente es una baja? Solo si el mensaje ENTERO es una de esas palabras
 * («BAJA», «Stop», «no más.»): una frase larga que contenga «baja» (p. ej. «me baja la presión») no
 * cuenta, para no dar de baja a alguien por error.
 */
export function isOptOutText(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return OPT_OUT_WORDS.has(normalizeReplyText(text));
}

// ---------------------------------------------------------------------------
// Planificador (Vercel Cron)
// ---------------------------------------------------------------------------

/** `Authorization: Bearer <CRON_SECRET>` con comparación de tiempo constante. Sin secreto nunca autoriza. */
export function isAuthorizedCron(authorizationHeader: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !authorizationHeader) return false;
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const received = createHash("sha256").update(authorizationHeader).digest();
  return timingSafeEqual(expected, received);
}
