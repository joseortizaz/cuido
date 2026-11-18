"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { isPrintFormat, parseRxItemsFromForm } from "@/lib/domain/prescriptions";
import type { Json } from "@/lib/supabase/database.types";

export type RxFormState = { error?: string; success?: string; profileIncomplete?: boolean } | undefined;

/**
 * Recetas: solo admin y médicos. La barrera real son las funciones de la base (issue_prescription,
 * void_prescription, log_prescription_print): verifican rol, clínica, expediente abierto, paciente no anulado y que
 * el médico tenga nombre y exequátur. El chequeo de aquí es comodidad.
 */
async function clinicianContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { supabase, membership, error: "Solo los médicos y el administrador emiten recetas." as string | null };
  }
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { supabase, membership, error: blocked as string | null };
  return { supabase, membership, error: null as string | null };
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501" || error.message.includes("modo solo lectura")) return error.message;
  return "No se pudo guardar. Intenta de nuevo.";
}

export async function issuePrescription(patientId: string, _prev: RxFormState, formData: FormData): Promise<RxFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };

  const parsed = parseRxItemsFromForm(formData);
  if (parsed.error) return { error: parsed.error };

  const encounterId = String(formData.get("encounter_id") ?? "");
  const { data: rxId, error } = await ctx.supabase.rpc("issue_prescription", {
    p_patient_id: patientId,
    p_items: parsed.items as unknown as Json,
    p_notes: String(formData.get("notes") ?? ""),
    ...(encounterId ? { p_encounter_id: encounterId } : {}),
  });
  if (error || !rxId) {
    if (error?.hint === "profile_incomplete") return { error: error.message, profileIncomplete: true };
    return { error: error ? friendly(error) : "No se pudo emitir la receta." };
  }

  // Opcional: los medicamentos recetados pasan a «medicamentos activos» del paciente (sin repetir los que ya están).
  if (formData.get("add_to_active") === "on") {
    const { data: active } = await ctx.supabase
      .from("medications")
      .select("name")
      .eq("patient_id", patientId)
      .eq("status", "activo");
    const have = new Set((active ?? []).map((m) => m.name.trim().toLowerCase()));
    const rows = parsed.items
      .filter((it) => !have.has(it.medication.trim().toLowerCase()))
      .map((it) => ({
        clinic_id: ctx.membership.clinicId,
        patient_id: patientId,
        name: it.medication,
        dose: it.dose ?? null,
        frequency: it.frequency ?? null,
      }));
    if (rows.length > 0) await ctx.supabase.from("medications").insert(rows);
  }

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/prescriptions/${rxId}`);
}

export async function voidPrescription(
  patientId: string,
  prescriptionId: string,
  _prev: RxFormState,
  formData: FormData
): Promise<RxFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("void_prescription", {
    p_prescription_id: prescriptionId,
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/prescriptions/${prescriptionId}`);
  return { success: "Receta anulada. Para corregirla, emite una nueva." };
}

/** Deja constancia de una impresión (la primera es el original; las siguientes salen «COPIA»). */
export async function logPrescriptionPrint(
  patientId: string,
  prescriptionId: string,
  format: string
): Promise<{ error?: string; isCopy?: boolean }> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const { data, error } = await ctx.supabase.rpc("log_prescription_print", {
    p_prescription_id: prescriptionId,
    p_format: isPrintFormat(format) ? format : "a6",
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/patients/${patientId}/prescriptions/${prescriptionId}`);
  return { isCopy: data === true };
}

/** Los datos profesionales del médico (salen impresos en sus recetas). */
export async function updateProfessionalProfile(_prev: RxFormState, formData: FormData): Promise<RxFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("update_my_professional_profile", {
    p_clinic_id: ctx.membership.clinicId,
    p_name: String(formData.get("professional_name") ?? ""),
    p_title: String(formData.get("professional_title") ?? ""),
    p_exequatur: String(formData.get("exequatur") ?? ""),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/profile/professional");
  return { success: "Datos profesionales guardados. Saldrán impresos en tus próximas recetas." };
}
