"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { claimStatusError, validateDiagnosis, validatePayment } from "@/lib/domain/claims";

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

/** Hoy en America/Santo_Domingo, "YYYY-MM-DD". */
function todayInSantoDomingo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
}

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? NaN : n;
}

/** Mensaje claro para los errores que la base de datos devuelve con sugerencia (hint). */
function friendlyClaimError(error: { message?: string; hint?: string | null } | null): string | null {
  if (!error) return null;
  if (error.hint === "claim_insurer_mismatch" || error.hint === "claim_document_mismatch") return error.message ?? null;
  return null;
}

function revalidateClaim(patientId: string | null, encounterId: string | null) {
  if (patientId && encounterId) revalidatePath(`/patients/${patientId}/encounters/${encounterId}`);
  revalidatePath("/claims");
}

async function claimContext(claimId: string) {
  const { supabase, userId } = await requireSignedIn();
  const { data: claim } = await supabase
    .from("insurance_claims")
    .select("id, status, encounter_id, approved_amount")
    .eq("id", claimId)
    .maybeSingle();
  if (!claim) return null;
  const { data: encounter } = await supabase
    .from("encounters")
    .select("patient_id")
    .eq("id", claim.encounter_id)
    .maybeSingle();
  return { supabase, userId, claim, patientId: encounter?.patient_id ?? null };
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
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  const patientInsurerId = String(formData.get("patient_insurer_id") ?? "");
  const claimedAmountRaw = String(formData.get("claimed_amount") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const fiscalDocumentId = String(formData.get("fiscal_document_id") ?? "").trim();
  const authorizationNumber = String(formData.get("authorization_number") ?? "").trim();
  const dxCode = String(formData.get("dx_code") ?? "").trim();
  const dxDescription = String(formData.get("dx_description") ?? "").trim();
  const dxSystem = String(formData.get("dx_system") ?? "CIE-10");

  if (!patientInsurerId) return { error: "Selecciona una aseguradora." };

  // El diagnóstico inicial es opcional, pero si se escribe algo debe ser válido.
  let firstDiagnosis: { codeSystem: string; code: string; description: string } | null = null;
  if (dxCode || dxDescription) {
    const check = validateDiagnosis({ codeSystem: dxSystem, code: dxCode, description: dxDescription });
    if (!check.ok) return { error: check.error };
    firstDiagnosis = check;
  }

  // La aseguradora elegida debe pertenecer al MISMO paciente de este
  // encounter. Esto se valida aquí para dar un mensaje claro, pero la barrera
  // real es el trigger enforce_claim_links() de la base de datos (también cubre
  // el comprobante), que rechaza cualquier mezcla entre pacientes.
  const { data: insurer } = await supabase
    .from("patient_insurers")
    .select("id")
    .eq("id", patientInsurerId)
    .eq("patient_id", patientId)
    .maybeSingle();
  if (!insurer) return { error: "La aseguradora seleccionada no pertenece a este paciente." };

  const claimedAmount = parseAmount(claimedAmountRaw);
  if (claimedAmount !== null && (Number.isNaN(claimedAmount) || claimedAmount < 0)) {
    return { error: "El monto reclamado debe ser un número válido." };
  }

  // clinic_id se re-deriva de la membresía del usuario (nunca de un campo
  // del formulario) -- el trigger set_clinic_id_from_encounter() en la
  // base de datos es la barrera de seguridad real: si encounter_id no
  // perteneciera a esta clínica, el trigger lo sobreescribiría con el
  // clinic_id verdadero y RLS rechazaría el insert.
  const { data: created, error } = await supabase
    .from("insurance_claims")
    .insert({
      clinic_id: clinicId,
      encounter_id: encounterId,
      patient_insurer_id: patientInsurerId,
      claimed_amount: claimedAmount,
      notes: notes || null,
      fiscal_document_id: fiscalDocumentId || null,
      authorization_number: authorizationNumber || null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) return { error: friendlyClaimError(error) ?? "No se pudo registrar la reclamación." };

  if (firstDiagnosis) {
    const { error: dxError } = await supabase.from("insurance_claim_diagnoses").insert({
      clinic_id: clinicId,
      claim_id: created.id,
      code_system: firstDiagnosis.codeSystem,
      code: firstDiagnosis.code,
      description: firstDiagnosis.description,
      is_primary: true,
      position: 1,
      created_by: userId,
    });
    if (dxError) {
      revalidateClaim(patientId, encounterId);
      return { error: "La reclamación se registró, pero no se pudo guardar el diagnóstico. Agrégalo desde su detalle." };
    }
  }

  revalidateClaim(patientId, encounterId);
  return { success: "Reclamación registrada." };
}

export async function updateClaimStatus(
  claimId: string,
  _prevState: ClaimActionState,
  formData: FormData
): Promise<ClaimActionState> {
  const ctx = await claimContext(claimId);
  if (!ctx) return { error: "Reclamación no encontrada." };
  const { supabase, userId, claim, patientId } = ctx;
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  const status = String(formData.get("status") ?? "");
  const rejectionReason = String(formData.get("rejection_reason") ?? "").trim();
  const approvedRaw = String(formData.get("approved_amount") ?? "");
  const approvedAmount = parseAmount(approvedRaw);

  // Para «aprobada» y mantener el monto ya registrado si no se vuelve a escribir.
  const effectiveApproved = approvedAmount !== null ? approvedAmount : claim.approved_amount;

  let diagnosesCount = 0;
  if (status === "enviada") {
    const { count } = await supabase
      .from("insurance_claim_diagnoses")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId);
    diagnosesCount = count ?? 0;
  }

  const problem = claimStatusError({
    next: status,
    diagnosesCount,
    rejectionReason,
    approvedAmount: effectiveApproved,
  });
  if (problem) return { error: problem };

  const { error } = await supabase
    .from("insurance_claims")
    .update({
      status,
      rejection_reason: status === "rechazada" ? rejectionReason : null,
      ...(status === "aprobada" ? { approved_amount: effectiveApproved } : {}),
      status_updated_by: userId,
      status_updated_at: new Date().toISOString(),
    })
    .eq("id", claimId);
  if (error) return { error: "No se pudo actualizar la reclamación." };

  revalidateClaim(patientId, claim.encounter_id);
  return { success: "Reclamación actualizada." };
}

/** Registra el cobro (un solo valor acumulado, con su fecha) de una reclamación aprobada. */
export async function registerClaimPayment(
  claimId: string,
  _prevState: ClaimActionState,
  formData: FormData
): Promise<ClaimActionState> {
  const ctx = await claimContext(claimId);
  if (!ctx) return { error: "Reclamación no encontrada." };
  const { supabase, claim, patientId } = ctx;
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  if (claim.status !== "aprobada") return { error: "Solo se registra el cobro de una reclamación aprobada." };

  const check = validatePayment(
    String(formData.get("paid_amount") ?? ""),
    String(formData.get("paid_on") ?? ""),
    todayInSantoDomingo()
  );
  if (!check.ok) return { error: check.error };

  const { error } = await supabase
    .from("insurance_claims")
    .update({ paid_amount: check.amount, paid_on: check.paidOn })
    .eq("id", claimId);
  if (error) return { error: "No se pudo registrar el cobro." };

  revalidateClaim(patientId, claim.encounter_id);
  return { success: "Cobro registrado." };
}

/** Comprobante vinculado y número de autorización. */
export async function updateClaimDetails(
  claimId: string,
  _prevState: ClaimActionState,
  formData: FormData
): Promise<ClaimActionState> {
  const ctx = await claimContext(claimId);
  if (!ctx) return { error: "Reclamación no encontrada." };
  const { supabase, claim, patientId } = ctx;
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  const fiscalDocumentId = String(formData.get("fiscal_document_id") ?? "").trim();
  const authorizationNumber = String(formData.get("authorization_number") ?? "").trim();

  const { error } = await supabase
    .from("insurance_claims")
    .update({
      fiscal_document_id: fiscalDocumentId || null,
      authorization_number: authorizationNumber || null,
    })
    .eq("id", claimId);
  if (error) return { error: friendlyClaimError(error) ?? "No se pudieron guardar los datos." };

  revalidateClaim(patientId, claim.encounter_id);
  return { success: "Datos guardados." };
}

export async function addClaimDiagnosis(
  claimId: string,
  _prevState: ClaimActionState,
  formData: FormData
): Promise<ClaimActionState> {
  const ctx = await claimContext(claimId);
  if (!ctx) return { error: "Reclamación no encontrada." };
  const { supabase, claim, patientId } = ctx;
  const { userId, clinicId } = await requireClinicMembership();
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  const check = validateDiagnosis({
    codeSystem: String(formData.get("code_system") ?? "CIE-10"),
    code: String(formData.get("code") ?? ""),
    description: String(formData.get("description") ?? ""),
  });
  if (!check.ok) return { error: check.error };

  const { data: existing } = await supabase
    .from("insurance_claim_diagnoses")
    .select("id, is_primary, position")
    .eq("claim_id", claimId);
  const rows = existing ?? [];
  // El primer diagnóstico es siempre el principal; los demás, solo si se marca.
  const makePrimary = rows.length === 0 || formData.get("is_primary") === "on";
  const position = rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;

  if (makePrimary && rows.some((r) => r.is_primary)) {
    await supabase.from("insurance_claim_diagnoses").update({ is_primary: false }).eq("claim_id", claimId).eq("is_primary", true);
  }

  const { error } = await supabase.from("insurance_claim_diagnoses").insert({
    clinic_id: clinicId,
    claim_id: claimId,
    code_system: check.codeSystem,
    code: check.code,
    description: check.description,
    is_primary: makePrimary,
    position,
    created_by: userId,
  });
  if (error) {
    return {
      error: /duplicate|unique/i.test(error.message)
        ? "Ese código ya está registrado en esta reclamación."
        : "No se pudo guardar el diagnóstico.",
    };
  }

  revalidateClaim(patientId, claim.encounter_id);
  return { success: "Diagnóstico agregado." };
}

export async function removeClaimDiagnosis(
  claimId: string,
  diagnosisId: string,
  _prevState: ClaimActionState
): Promise<ClaimActionState> {
  const ctx = await claimContext(claimId);
  if (!ctx) return { error: "Reclamación no encontrada." };
  const { supabase, claim, patientId } = ctx;
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  const { error } = await supabase.from("insurance_claim_diagnoses").delete().eq("id", diagnosisId).eq("claim_id", claimId);
  if (error) return { error: "No se pudo quitar el diagnóstico." };

  revalidateClaim(patientId, claim.encounter_id);
  return { success: "Diagnóstico quitado." };
}
