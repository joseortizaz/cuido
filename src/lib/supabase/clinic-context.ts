import type { Database } from "./database.types";
import type { createClient } from "./server";

export type ClinicMembership = {
  clinicId: string;
  role: Database["public"]["Enums"]["clinic_member_role"];
};

/**
 * Clínica y rol del usuario autenticado actual. `null` si todavía no tiene
 * ninguna membresía (debe pasar por /onboarding).
 *
 * Fase 1: un usuario pertenece a una sola clínica (toma la primera fila).
 * Multi-clínica por usuario queda para una extensión futura.
 */
export async function getCurrentClinicMembership(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ClinicMembership | null> {
  const { data } = await supabase
    .from("clinic_members")
    .select("clinic_id, role")
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { clinicId: data.clinic_id, role: data.role };
}
