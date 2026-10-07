import { cache } from "react";
import { createClient } from "./server";

/**
 * Estado de acceso de la clínica (período de prueba y suscripciones), tal
 * como lo calcula la base de datos -- ver
 * supabase/migrations/20261006100000_subscription_access_state.sql y
 * 20261007100000_subscription_plan_periods_and_payments.sql.
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

export const READONLY_MESSAGE =
  "Tu clínica está en modo solo lectura: puedes consultar y descargar toda la información, " +
  `pero no crear ni modificar nada. Contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`;

export const SUSPENDED_MESSAGE =
  `Tu clínica está suspendida. Contacta a Narnia Tech Solution: ${CONTACT_NARNIA}.`;

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Estado de acceso de la clínica del usuario actual. Cualquier miembro lo
 * puede leer: la función de la base devuelve estado y días, NUNCA montos; el
 * recordatorio de renovación (`por_renovar`) y los cupos solo les llegan al
 * admin (al resto se les muestra `activa`).
 *
 * null si el usuario no tiene clínica o si la consulta falla. Fallar "abierto"
 * es deliberado: este helper es capa de COMODIDAD (mensajes claros, botones
 * deshabilitados); la barrera real es el trigger readonly_guard de la base de
 * datos, que rechaza la escritura de todos modos.
 */
export async function getClinicAccess(supabase: ServerClient): Promise<ClinicAccess | null> {
  const { data, error } = await supabase.rpc("get_my_clinic_access");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const state = row.state as ClinicAccessState;
  return {
    clinicId: row.clinic_id,
    state,
    daysToExpiry: row.days_to_expiry,
    daysToReadonly: row.days_to_readonly,
    seatsUsed: row.seats_used,
    seatsIncluded: row.seats_included,
    isReadOnly: state === "solo_lectura" || state === "suspendida",
  };
}

/**
 * Para las Server Actions que ESCRIBEN: devuelve el mensaje claro a mostrar si
 * la clínica está en solo lectura (o suspendida), o null si puede escribir.
 *
 *   const blocked = await readOnlyBlock(supabase);
 *   if (blocked) return { error: blocked };
 *
 * Evita que el usuario vea un error técnico del trigger; el bloqueo real
 * sigue siendo el de la base de datos.
 */
export async function readOnlyBlock(supabase: ServerClient): Promise<string | null> {
  const access = await getClinicAccess(supabase);
  if (!access?.isReadOnly) return null;
  return access.state === "suspendida" ? SUSPENDED_MESSAGE : READONLY_MESSAGE;
}

/**
 * Igual que getClinicAccess pero para Server Components: `cache()` de React
 * la memoiza POR PETICIÓN, así que el layout, la página y los componentes
 * hijos comparten una sola consulta a la base en vez de una cada uno.
 */
export const getCurrentClinicAccess = cache(async (): Promise<ClinicAccess | null> => {
  const supabase = await createClient();
  return getClinicAccess(supabase);
});
