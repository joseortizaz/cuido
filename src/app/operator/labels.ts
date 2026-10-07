import type { ClinicAccessState } from "@/lib/domain/clinic-access";

export const BUSINESS_MODEL_LABELS: Record<string, string> = {
  modelo_c: "Modelo C — Setup fee + suscripción por tramo",
  modelo_e: "Modelo E — Canal asociativo / franquicia",
  modelo_f: "Modelo F — Freemium con upsell",
};

export function formatPrice(price: number | string | null): string {
  if (price === null || price === undefined) return "—";
  const value = typeof price === "string" ? Number(price) : price;
  if (Number.isNaN(value)) return "—";
  return `RD$ ${value.toLocaleString("es-DO", { minimumFractionDigits: 2 })}`;
}

/** "2026-10-20" -> "20 oct 2026" (sin desfase de zona: se parsea como fecha local). */
export function formatDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("es-DO", { dateStyle: "medium" });
}

/**
 * Fecha de un timestamp (p. ej. clinics.created_at) EN America/Santo_Domingo. No
 * basta con cortar los primeros 10 caracteres del ISO: eso da la fecha UTC, y a
 * partir de las 8 pm hora local ya es "mañana" en UTC.
 */
export function formatTimestampDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });
}

/** Suma días a una fecha "YYYY-MM-DD" sin pasar por la zona horaria local (aritmética en UTC). */
export function addDaysIso(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Hoy en America/Santo_Domingo, "YYYY-MM-DD" (valor por defecto de los campos de fecha). */
export function todayInSantoDomingo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
}

/** Colores de la insignia de estado de acceso (lista y detalle del operador). */
export const ACCESS_STATE_BADGE: Record<ClinicAccessState, string> = {
  prueba: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  activa: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  por_renovar: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  vencida_en_gracia: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  solo_lectura: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  suspendida: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  exenta: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  sin_plan: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/**
 * Orden de la lista del operador: primero lo que requiere acción. Dentro del
 * mismo estado, por días hasta el vencimiento (los más urgentes arriba).
 */
export const ACCESS_STATE_PRIORITY: Record<ClinicAccessState, number> = {
  solo_lectura: 0,
  vencida_en_gracia: 1,
  por_renovar: 2,
  prueba: 3,
  suspendida: 4,
  sin_plan: 5,
  activa: 6,
  exenta: 7,
};

export const EVENT_KIND_LABELS: Record<string, string> = {
  trial_started: "Prueba iniciada",
  trial_extended: "Prueba extendida",
  plan_set: "Plan fijado",
  exempt_changed: "Exención",
  seats_changed: "Cupo de médicos",
  backfill: "Carga inicial",
};

function field(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return value === null || value === undefined ? "—" : String(value);
}

/** Texto legible de un evento de clinic_subscription_events. */
export function describeSubscriptionEvent(kind: string, rawDetails: unknown): string {
  const d = (rawDetails && typeof rawDetails === "object" ? rawDetails : {}) as Record<string, unknown>;
  const reason = typeof d.reason === "string" && d.reason ? ` Motivo: ${d.reason}` : "";
  switch (kind) {
    case "trial_started":
      return `La prueba termina el ${formatDate(typeof d.trial_ends_at === "string" ? d.trial_ends_at : null)}.`;
    case "trial_extended":
      return `+${field(d, "days")} días: ${formatDate(typeof d.previous_trial_ends_at === "string" ? d.previous_trial_ends_at : null)} → ${formatDate(typeof d.new_trial_ends_at === "string" ? d.new_trial_ends_at : null)}.${reason}`;
    case "plan_set":
      return `${field(d, "period_days")} días, monto ${formatPrice(typeof d.amount === "number" ? d.amount : null)}, inicio ${formatDate(typeof d.start_on === "string" ? d.start_on : null)}, vence ${formatDate(typeof d.due_on === "string" ? d.due_on : null)}.`;
    case "exempt_changed":
      return `${d.exempt ? "Exención activada." : "Exención quitada."}${reason}`;
    case "seats_changed":
      return `${d.previous_seats ?? "ilimitado"} → ${d.new_seats ?? "ilimitado"}.${reason}`;
    case "backfill":
      return `Fecha base ${formatDate(typeof d.base_date === "string" ? d.base_date : null)}.`;
    default:
      return "";
  }
}
