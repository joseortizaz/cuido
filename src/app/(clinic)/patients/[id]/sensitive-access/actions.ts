"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SensitiveAccessActionState = { error?: string; success?: string } | undefined;

/**
 * Otorgar acceso SIEMPRE pasa por el RPC grant_sensitive_specialty_access
 * (SECURITY DEFINER, se autogatea con is_clinic_admin) --
 * sensitive_specialty_access_grants no tiene política de INSERT para
 * `authenticated`, ni siquiera esta acción podría hacer un insert directo
 * aunque quisiera. Ver
 * supabase/migrations/20260822010000_sensitive_specialty_access.sql para
 * el razonamiento completo de por qué solo admin (no médico) puede otorgar.
 */
export async function grantSensitiveAccess(
  patientId: string,
  _prevState: SensitiveAccessActionState,
  formData: FormData
): Promise<SensitiveAccessActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const specialtyTemplateId = String(formData.get("specialty_template_id") ?? "");
  const targetUserId = String(formData.get("target_user_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!specialtyTemplateId) return { error: "Selecciona una especialidad sensible." };
  if (!targetUserId) return { error: "Selecciona a quién se le otorga el acceso." };
  if (!reason) return { error: "El motivo de la concesión es requerido." };

  const { error } = await supabase.rpc("grant_sensitive_specialty_access", {
    target_patient_id: patientId,
    target_specialty_template_id: specialtyTemplateId,
    target_user_id: targetUserId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidatePath(`/patients/${patientId}`);
  return { success: "Acceso otorgado." };
}

/**
 * Revocar SIEMPRE pasa por el RPC revoke_sensitive_specialty_access, mismo
 * principio que revoke_consent -- sin política de UPDATE directo.
 */
export async function revokeSensitiveAccess(
  patientId: string,
  grantId: string,
  _prevState: SensitiveAccessActionState,
  formData: FormData
): Promise<SensitiveAccessActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "El motivo de la revocación es requerido." };

  const { error } = await supabase.rpc("revoke_sensitive_specialty_access", {
    target_grant_id: grantId,
    p_reason: reason,
  });
  if (error) return { error: error.message };

  revalidatePath(`/patients/${patientId}`);
  return undefined;
}
