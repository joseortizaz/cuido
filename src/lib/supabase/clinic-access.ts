import { cache } from "react";
import { createClient } from "./server";

import type { ClinicAccess, ClinicAccessState } from "@/lib/domain/clinic-access";
import { BLOCKED_MESSAGE, READONLY_MESSAGE, SUSPENDED_MESSAGE } from "@/lib/domain/clinic-access";

// Tipos, textos y la lógica del aviso viven en src/lib/domain/clinic-access.ts
// (módulo puro, probable con fechas límite). Se re-exportan aquí para que los
// llamadores existentes sigan importando todo desde un solo lugar.
export type { ClinicAccess, ClinicAccessState } from "@/lib/domain/clinic-access";
export { BLOCKED_MESSAGE, CONTACT_NARNIA, READONLY_MESSAGE, SUSPENDED_MESSAGE } from "@/lib/domain/clinic-access";

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
    daysToBlock: row.days_to_block,
    seatsUsed: row.seats_used,
    seatsIncluded: row.seats_included,
    isReadOnly: state === "solo_lectura" || state === "bloqueada" || state === "suspendida",
  };
}

/**
 * Para las Server Actions que ESCRIBEN: devuelve el mensaje claro a mostrar si
 * la clínica está en solo lectura, bloqueada o suspendida, o null si puede escribir.
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
  if (access.state === "suspendida") return SUSPENDED_MESSAGE;
  return access.state === "bloqueada" ? BLOCKED_MESSAGE : READONLY_MESSAGE;
}

/**
 * Para los Route Handlers de exportación: en una clínica bloqueada o suspendida
 * RLS ya no entrega ningún dato, así que el archivo saldría VACÍO y parecería
 * una exportación completa. Devuelve el mensaje a responder (403) en esos
 * estados, o null si se puede exportar (solo lectura incluido).
 */
export async function exportBlockedMessage(supabase: ServerClient): Promise<string | null> {
  const access = await getClinicAccess(supabase);
  if (access?.state === "suspendida") return SUSPENDED_MESSAGE;
  if (access?.state === "bloqueada") return BLOCKED_MESSAGE;
  return null;
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
