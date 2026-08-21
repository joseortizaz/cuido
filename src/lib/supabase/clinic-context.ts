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
 *
 * Filtra por user_id EXPLÍCITAMENTE -- no basta con dejar que RLS scope
 * "la fila propia" implícitamente. Desde que existe la política
 * clinic_members_select_by_operator (supabase/migrations/20260821000500_platform_operators.sql),
 * un operador de plataforma puede ver TODAS las filas de clinic_members, así
 * que un `.limit(1)` sin filtro le devolvía una fila arbitraria de
 * cualquier clínica -- no necesariamente (ni casi nunca) la suya propia.
 */
export async function getCurrentClinicMembership(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ClinicMembership | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("clinic_members")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { clinicId: data.clinic_id, role: data.role };
}
