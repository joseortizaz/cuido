"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type ProfileSpecialtiesActionState = { error?: string; success?: string } | undefined;

/**
 * Mecanismo 1 (preferencia de UI, ver
 * supabase/migrations/20260917090000_clinician_specialty_filtering.sql):
 * responsabilidad exclusiva del propio médico sobre su propia fila --
 * sin chequeo de rol admin aquí, la barrera real es RLS
 * (preferred_specialties_insert/delete, "el dueño de la fila").
 */
async function requireClinicMemberId(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  clinicId: string;
  clinicMemberId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: clinicMember } = await supabase
    .from("clinic_members")
    .select("id")
    .eq("clinic_id", membership.clinicId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!clinicMember) redirect("/onboarding");

  return { supabase, clinicId: membership.clinicId, clinicMemberId: clinicMember.id };
}

export async function markSpecialtyAsPreferred(
  specialtyTemplateId: string,
  _prevState: ProfileSpecialtiesActionState,
  _formData: FormData
): Promise<ProfileSpecialtiesActionState> {
  const { supabase, clinicId, clinicMemberId } = await requireClinicMemberId();

  // clinic_id se deriva aquí de la membresía y, de nuevo, en el trigger
  // preferred_specialties_set_clinic_id en la base de datos — la
  // barrera de seguridad real es el trigger, esto es solo para
  // satisfacer el tipo de Insert (mismo patrón que el resto del
  // proyecto).
  const { error } = await supabase.from("clinic_member_preferred_specialties").insert({
    clinic_id: clinicId,
    clinic_member_id: clinicMemberId,
    specialty_template_id: specialtyTemplateId,
  });
  if (error) return { error: "No se pudo marcar la especialidad." };

  revalidatePath("/profile/specialties");
  return undefined;
}

export async function unmarkSpecialtyAsPreferred(
  specialtyTemplateId: string,
  _prevState: ProfileSpecialtiesActionState,
  _formData: FormData
): Promise<ProfileSpecialtiesActionState> {
  const { supabase, clinicMemberId } = await requireClinicMemberId();

  const { error } = await supabase
    .from("clinic_member_preferred_specialties")
    .delete()
    .eq("clinic_member_id", clinicMemberId)
    .eq("specialty_template_id", specialtyTemplateId);
  if (error) return { error: "No se pudo desmarcar la especialidad." };

  revalidatePath("/profile/specialties");
  return undefined;
}
