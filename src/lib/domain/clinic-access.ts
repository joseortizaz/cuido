/**
 * Estado de acceso de la clínica (período de prueba y suscripciones) -- parte
 * PURA: tipos, textos y la lógica de qué aviso mostrar. Sin dependencias de
 * Next ni de Supabase, para poder probarla con fechas límite
 * (scripts/test-access-banner.ts). El estado en sí lo calcula la base de datos
 * (supabase/migrations/20261007100000_subscription_plan_periods_and_payments.sql);
 * la lectura vive en src/lib/supabase/clinic-access.ts.
 */

export type ClinicAccessState =
  | "prueba"
  | "activa"
  | "por_renovar"
  | "vencida_en_gracia"
  | "solo_lectura"
  | "suspendida"
  | "exenta"
  | "sin_plan";

export type ClinicAccess = {
  clinicId: string;
  state: ClinicAccessState;
  /** Negativo una vez vencida. null si la clínica no tiene ninguna fecha. */
  daysToExpiry: number | null;
  /** 0 el primer día de solo lectura. */
  daysToReadonly: number | null;
  /** Solo para el admin (get_my_clinic_access los devuelve null al resto). */
  seatsUsed: number | null;
  seatsIncluded: number | null;
  /** Una clínica en solo lectura o suspendida no puede escribir. */
  isReadOnly: boolean;
};

export const CONTACT_NARNIA = "info@narniats.com / WhatsApp 829-374-8878";
export const CONTACT_EMAIL = "info@narniats.com";
export const CONTACT_WHATSAPP_URL = "https://wa.me/18293748878";

export const READONLY_MESSAGE =
  "Tu clínica está en modo solo lectura: puedes consultar toda la información y el administrador puede " +
  `exportar los pacientes y las consultas, pero no se puede crear ni modificar nada. Contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`;

export const SUSPENDED_MESSAGE =
  `Tu clínica está suspendida. Contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`;

export const ACCESS_STATE_LABELS: Record<ClinicAccessState, string> = {
  prueba: "Período de prueba",
  activa: "Plan activo",
  por_renovar: "Por renovar",
  vencida_en_gracia: "Vencida (en período de gracia)",
  solo_lectura: "Solo lectura",
  suspendida: "Suspendida",
  exenta: "Exenta",
  sin_plan: "Sin plan asignado",
};

export type BannerTone = "info" | "warning" | "danger";

export type AccessBanner = {
  tone: BannerTone;
  title: string;
  detail: string;
};

function days(n: number): string {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/**
 * Qué aviso muestra la barra de la clínica, o null si no hay nada que avisar.
 *
 * Cuenta de días: el día de vencimiento todavía es válido, así que
 * `daysToExpiry = 0` es el ÚLTIMO día. "Te quedan N días" incluye el día de
 * hoy (quedan d + 1 días de uso). Enfático en los últimos 3 días de la prueba
 * (hoy incluido, o sea d <= 2) y en los últimos 7 de los 30 de gracia.
 *
 * `isAdmin`: el recordatorio de renovación (por_renovar) es solo del admin. La
 * base de datos ya se lo devuelve como `activa` al resto del equipo; el
 * parámetro es defensa en profundidad.
 */
export function describeAccessBanner(
  access: Pick<ClinicAccess, "state" | "daysToExpiry" | "daysToReadonly">,
  isAdmin: boolean
): AccessBanner | null {
  const { state, daysToExpiry, daysToReadonly } = access;

  switch (state) {
    case "prueba": {
      if (daysToExpiry === null) return null;
      const d = daysToExpiry;
      const title =
        d <= 0
          ? "Hoy es el último día de tu prueba"
          : d === 1
            ? "Mañana es el último día de tu prueba"
            : `Te quedan ${d + 1} días de prueba`;
      return {
        tone: d <= 2 ? "danger" : "info",
        title,
        detail:
          "Cuando termine tendrás 30 días de gracia antes de pasar a solo lectura. " +
          `Para contratar tu plan, contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`,
      };
    }

    case "por_renovar": {
      if (!isAdmin || daysToExpiry === null) return null;
      const d = daysToExpiry;
      return {
        tone: "warning",
        title: d <= 0 ? "Tu plan vence hoy" : d === 1 ? "Tu plan vence mañana" : `Tu plan vence en ${days(d)}`,
        detail: `Para renovarlo, contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`,
      };
    }

    case "vencida_en_gracia": {
      if (daysToExpiry === null || daysToReadonly === null) return null;
      const since = -daysToExpiry;
      return {
        tone: daysToReadonly <= 7 ? "danger" : "warning",
        title: `La suscripción de tu clínica venció hace ${days(since)}`,
        detail:
          `Puedes seguir trabajando con normalidad, pero en ${days(daysToReadonly)} tu clínica pasará a modo ` +
          `solo lectura. Contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`,
      };
    }

    case "solo_lectura":
      return {
        tone: "danger",
        title: "Tu clínica está en modo solo lectura",
        detail:
          "Puedes seguir consultando toda tu información, y el administrador puede exportar los pacientes y las consultas, " +
          "pero no se puede crear ni modificar nada. " +
          `Para reactivarla, contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`,
      };

    case "suspendida":
      return { tone: "danger", title: "Tu clínica está suspendida", detail: `Contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.` };

    default:
      // activa, exenta, sin_plan: nada que avisar.
      return null;
  }
}
