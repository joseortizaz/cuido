import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Lo MÍNIMO de una consulta que necesita quien factura, agenda o firma consentimientos: id, paciente, fecha,
 * cita enlazada y quién la atendió. Nunca motivo, notas, diagnóstico, signos vitales ni especialidad.
 *
 * Desde el PR 4b (supabase/migrations/20261123100000_receptionist_clinical_isolation.sql) recepción ya no lee la
 * tabla `encounters`; esta función de la base (security definer) es lo que ve. Admin y médicos también pueden usarla
 * cuando solo necesitan estos datos. Respeta el acceso reforzado de las especialidades sensibles: esas consultas no
 * aparecen para quien no tiene acceso a ellas.
 */
export type EncounterStub = {
  id: string;
  patient_id: string;
  encounter_date: string;
  appointment_id: string | null;
  provider_id: string;
};

/** Siempre con algún filtro (la función de la base no devuelve un listado libre). */
export async function fetchEncounterStubs(
  supabase: SupabaseClient<Database>,
  filter: { patientId?: string; encounterIds?: string[]; appointmentIds?: string[] }
): Promise<EncounterStub[]> {
  if (filter.encounterIds && filter.encounterIds.length === 0) return [];
  if (filter.appointmentIds && filter.appointmentIds.length === 0) return [];
  if (!filter.patientId && !filter.encounterIds && !filter.appointmentIds) return [];

  const { data, error } = await supabase.rpc("encounter_stubs", {
    ...(filter.patientId ? { p_patient_id: filter.patientId } : {}),
    ...(filter.encounterIds ? { p_encounter_ids: filter.encounterIds } : {}),
    ...(filter.appointmentIds ? { p_appointment_ids: filter.appointmentIds } : {}),
  });
  if (error) throw new Error(`No se pudieron leer las consultas: ${error.message}`);
  return (data ?? []) as EncounterStub[];
}
