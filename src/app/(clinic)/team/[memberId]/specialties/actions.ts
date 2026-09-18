"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type MemberSpecialtiesActionState = { error?: string; success?: string } | undefined;

/**
 * Mecanismo 2 (restricción real, ver
 * supabase/migrations/20260917090000_clinician_specialty_filtering.sql):
 * exclusivo del admin de la clínica. El chequeo de rol aquí es defensa
 * en profundidad; la barrera real es RLS
 * (disabled_specialties_insert/delete, is_clinic_admin).
 *
 * Reemplazo completo del conjunto deshabilitado para este miembro en
 * cada guardado (borrar todo lo existente + insertar lo recién
 * desmarcado) en vez de diffear -- más simple de razonar, y el peor
 * caso de inconsistencia entre las dos llamadas (una especialidad
 * brevemente habilitada de más) es aceptable: no es una escritura
 * clínica ni una fuga de datos.
 */
export async function updateDisabledSpecialties(
  memberId: string,
  _prevState: MemberSpecialtiesActionState,
  formData: FormData
): Promise<MemberSpecialtiesActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") {
    return { error: "Solo un admin puede gestionar las especialidades de un miembro." };
  }

  const { data: member } = await supabase
    .from("clinic_members")
    .select("id")
    .eq("id", memberId)
    .eq("clinic_id", membership.clinicId)
    .maybeSingle();
  if (!member) return { error: "Miembro no encontrado." };

  const { data: allTemplates } = await supabase
    .from("specialty_templates")
    .select("id")
    .eq("is_active", true);

  // Habilitada = el checkbox "enabled-<id>" llegó marcado. Cualquier
  // especialidad activa cuyo checkbox NO llegó marcado se guarda como
  // deshabilitada para este miembro.
  const disabledIds = (allTemplates ?? [])
    .map((t) => t.id)
    .filter((id) => formData.get(`enabled-${id}`) !== "on");

  const { error: deleteError } = await supabase
    .from("clinic_member_disabled_specialties")
    .delete()
    .eq("clinic_member_id", memberId);
  if (deleteError) return { error: "No se pudo actualizar las especialidades." };

  if (disabledIds.length > 0) {
    // clinic_id se deriva aquí de la membresía del admin y, de nuevo, en
    // el trigger disabled_specialties_set_clinic_id en la base de datos
    // — la barrera de seguridad real es el trigger, esto es solo para
    // satisfacer el tipo de Insert (mismo patrón que el resto del
    // proyecto).
    const { error: insertError } = await supabase.from("clinic_member_disabled_specialties").insert(
      disabledIds.map((specialtyTemplateId) => ({
        clinic_id: membership.clinicId,
        clinic_member_id: memberId,
        specialty_template_id: specialtyTemplateId,
        disabled_by_user_id: user.id,
      }))
    );
    if (insertError) return { error: "No se pudo actualizar las especialidades." };
  }

  revalidatePath(`/team/${memberId}/specialties`);
  return { success: "Especialidades actualizadas." };
}
