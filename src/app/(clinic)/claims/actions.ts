"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import type { Database } from "@/lib/supabase/database.types";

export type ClaimActionState = { error?: string; success?: string } | undefined;

async function requireSignedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

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
 * Vive en (clinic)/claims/ -- no en la ruta anidada del encounter -- porque
 * es el hogar natural de "el feature de reclamaciones" en su conjunto:
 * tanto el formulario inline en el detalle de una consulta
 * (patients/[id]/encounters/[encounterId]/claims/claim-form.tsx) como el
 * listado clínico (claims/page.tsx) importan de acá.
 */
export async function createClaim(
  patientId: string,
  encounterId: string,
  _prevState: ClaimActionState,
  formData: FormData
): Promise<ClaimActionState> {
  const { supabase, userId, clinicId } = await requireClinicMembership();

  const patientInsurerId = String(formData.get("patient_insurer_id") ?? "");
  const claimedAmountRaw = String(formData.get("claimed_amount") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!patientInsurerId) return { error: "Selecciona una aseguradora." };

  // La aseguradora elegida debe pertenecer al MISMO paciente de este
  // encounter -- RLS solo garantiza que sea de la misma clínica, no que
  // sea del paciente correcto. Sin esta verificación en la app, alguien
  // podría reclamar contra la aseguradora de otro paciente de la clínica.
  const { data: insurer } = await supabase
    .from("patient_insurers")
    .select("id")
    .eq("id", patientInsurerId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!insurer) return { error: "La aseguradora seleccionada no pertenece a este paciente." };

  let claimedAmount: number | null = null;
  if (claimedAmountRaw !== "") {
    claimedAmount = Number(claimedAmountRaw);
    if (Number.isNaN(claimedAmount) || claimedAmount < 0) {
      return { error: "El monto reclamado debe ser un número válido." };
    }
  }

  // clinic_id se re-deriva de la membresía del usuario (nunca de un campo
  // del formulario) -- el trigger set_clinic_id_from_encounter() en la
  // base de datos es la barrera de seguridad real: si encounter_id no
  // perteneciera a esta clínica, el trigger lo sobreescribiría con el
  // clinic_id verdadero y RLS rechazaría el insert.
  const { error } = await supabase.from("insurance_claims").insert({
    clinic_id: clinicId,
    encounter_id: encounterId,
    patient_insurer_id: patientInsurerId,
    claimed_amount: claimedAmount,
    notes: notes || null,
    created_by: userId,
  });
  if (error) return { error: "No se pudo registrar la reclamación." };

  revalidatePath(`/patients/${patientId}/encounters/${encounterId}`);
  revalidatePath("/claims");
  return { success: "Reclamación registrada." };
}

type ClaimStatus = Database["public"]["Tables"]["insurance_claims"]["Row"]["status"];
const VALID_STATUSES: ClaimStatus[] = ["pendiente", "enviada", "aprobada", "rechazada"];

export async function updateClaimStatus(
  claimId: string,
  _prevState: ClaimActionState,
  formData: FormData
): Promise<ClaimActionState> {
  const { supabase, userId } = await requireSignedIn();

  const status = String(formData.get("status") ?? "");
  const rejectionReason = String(formData.get("rejection_reason") ?? "").trim();

  if (!VALID_STATUSES.includes(status as ClaimStatus)) {
    return { error: "Selecciona un estado válido." };
  }
  if (status === "rechazada" && !rejectionReason) {
    return { error: "El motivo de rechazo es requerido." };
  }

  const { error } = await supabase
    .from("insurance_claims")
    .update({
      status,
      rejection_reason: status === "rechazada" ? rejectionReason : null,
      status_updated_by: userId,
      status_updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (error) return { error: "No se pudo actualizar la reclamación." };

  revalidatePath("/claims");
  return { success: "Reclamación actualizada." };
}
