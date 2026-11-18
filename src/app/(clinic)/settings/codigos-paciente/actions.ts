"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { patientCodeFormatError } from "@/lib/domain/patient-code";

export type PatientCodeSettingsState = { error?: string; success?: string } | undefined;

/**
 * Guarda el formato del código de paciente. Solo el admin; la barrera real es la función
 * save_patient_code_settings (verifica admin de la clínica, formato y que el número inicial no retroceda).
 * El cambio solo afecta a los pacientes nuevos.
 */
export async function savePatientCodeSettings(
  _prevState: PatientCodeSettingsState,
  formData: FormData
): Promise<PatientCodeSettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") return { error: "Solo el administrador puede cambiar esto." };
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { error: blocked };

  const format = String(formData.get("format") ?? "").trim();
  const resetYearly = formData.get("reset_yearly") === "on";
  const startNumber = Number.parseInt(String(formData.get("start_number") ?? ""), 10);

  const formatError = patientCodeFormatError(format, resetYearly);
  if (formatError) return { error: formatError };
  if (!Number.isInteger(startNumber) || startNumber < 1) return { error: "El número inicial debe ser 1 o mayor." };

  const { error } = await supabase.rpc("save_patient_code_settings", {
    p_clinic_id: membership.clinicId,
    p_format: format,
    p_start_number: startNumber,
    p_reset_yearly: resetYearly,
  });
  if (error) {
    // Los mensajes de la función ya están en español y son seguros de mostrar (errcode 22023 / 42501).
    if (error.code === "22023" || error.code === "42501") return { error: error.message };
    return { error: "No se pudo guardar el formato." };
  }

  revalidatePath("/settings/codigos-paciente");
  return { success: "Formato guardado. Se aplicará a los pacientes nuevos." };
}
