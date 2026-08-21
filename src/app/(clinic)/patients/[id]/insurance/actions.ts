"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type InsuranceActionState = { error?: string; success?: string } | undefined;

async function requireClinicMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  return { supabase, userId: user.id, clinicId: membership.clinicId };
}

/**
 * Registrar una aseguradora nueva como vigente son dos statements
 * normales, no una transacción a mano: la garantía real de "solo una
 * vigente a la vez" es el índice único parcial
 * patient_insurers_one_current_idx (ver la migración) -- Postgres la hace
 * cumplir sin importar el orden en que lleguen las escrituras. Si el
 * proceso se interrumpe entre los dos pasos, el peor caso es quedarse sin
 * aseguradora vigente por un momento, nunca con dos.
 */
export async function registerInsurer(
  patientId: string,
  _prevState: InsuranceActionState,
  formData: FormData
): Promise<InsuranceActionState> {
  const { supabase, userId, clinicId } = await requireClinicMembership();

  const insurerName = String(formData.get("insurer_name") ?? "").trim();
  const affiliateNumber = String(formData.get("affiliate_number") ?? "").trim();

  if (!insurerName) return { error: "El nombre de la aseguradora es requerido." };
  if (!affiliateNumber) return { error: "El número de afiliado es requerido." };

  await supabase
    .from("patient_insurers")
    .update({ is_current: false })
    .eq("patient_id", patientId)
    .eq("is_current", true);

  // clinic_id se re-deriva aquí de la membresía del usuario (nunca de un
  // campo del formulario) -- el trigger set_clinic_id_from_patient() en la
  // base de datos es la barrera de seguridad real, mismo patrón que
  // src/app/(clinic)/patients/[id]/actions.ts.
  const { error } = await supabase.from("patient_insurers").insert({
    clinic_id: clinicId,
    patient_id: patientId,
    insurer_name: insurerName,
    affiliate_number: affiliateNumber,
    is_current: true,
    recorded_by: userId,
  });
  if (error) return { error: "No se pudo registrar la aseguradora." };

  revalidatePath(`/patients/${patientId}`);
  return { success: "Aseguradora registrada." };
}

export async function recordEligibilityCheck(
  patientId: string,
  patientInsurerId: string,
  _prevState: InsuranceActionState,
  formData: FormData
): Promise<InsuranceActionState> {
  const { supabase, userId, clinicId } = await requireClinicMembership();

  const result = String(formData.get("result") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!["elegible", "no_elegible", "pendiente"].includes(result)) {
    return { error: "Selecciona un resultado válido." };
  }

  const { error } = await supabase.from("eligibility_checks").insert({
    clinic_id: clinicId,
    patient_id: patientId,
    patient_insurer_id: patientInsurerId,
    result,
    notes: notes || null,
    checked_by: userId,
  });
  if (error) return { error: "No se pudo registrar la verificación." };

  revalidatePath(`/patients/${patientId}`);
  return { success: "Elegibilidad verificada." };
}
