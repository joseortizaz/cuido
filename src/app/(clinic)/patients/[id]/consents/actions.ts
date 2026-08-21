"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseUrl } from "@/lib/supabase/env";

export type ConsentActionState = { error?: string } | undefined;

/**
 * Llama a la Edge Function sign-consent (supabase/functions/sign-consent)
 * -- único camino para insertar en `consents`, esa tabla no tiene política
 * de INSERT para `authenticated` a propósito (ver la migración). Reenvía
 * el access_token de la SESIÓN REAL del usuario, nunca credenciales
 * propias del servidor -- la función se autoriza como ese usuario, exacto
 * mismo principio de "nunca confiar en un tenant_id del cliente" aplicado
 * a la llamada HTTP en vez de a una columna.
 */
export async function signConsent(
  patientId: string,
  _prevState: ConsentActionState,
  formData: FormData
): Promise<ConsentActionState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const consentTemplateId = String(formData.get("consent_template_id") ?? "");
  const signerName = String(formData.get("signer_name") ?? "").trim();
  const signerNationalId = String(formData.get("signer_national_id") ?? "").trim();
  const signerRelationship = String(formData.get("signer_relationship") ?? "paciente");
  const encounterId = String(formData.get("encounter_id") ?? "").trim();

  if (!consentTemplateId) return { error: "Selecciona una plantilla de consentimiento." };
  if (!signerName) return { error: "El nombre de quien firma es requerido." };

  let response: Response;
  try {
    response = await fetch(`${getSupabaseUrl()}/functions/v1/sign-consent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        patientId,
        encounterId: encounterId || undefined,
        consentTemplateId,
        signerName,
        signerNationalId: signerNationalId || undefined,
        signerRelationship,
      }),
    });
  } catch {
    return { error: "No se pudo contactar el servicio de firma. Intenta de nuevo." };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "No se pudo registrar la firma." };
  }

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

/**
 * Revocar SIEMPRE pasa por el RPC revoke_consent (SECURITY DEFINER, se
 * autogatea con is_clinic_clinician) -- `consents` no tiene política de
 * UPDATE para `authenticated`, ni siquiera esta acción podría hacer un
 * update directo aunque quisiera.
 */
export async function revokeConsent(
  patientId: string,
  consentId: string,
  _prevState: ConsentActionState,
  formData: FormData
): Promise<ConsentActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "El motivo de revocación es requerido." };

  const { error } = await supabase.rpc("revoke_consent", {
    target_consent_id: consentId,
    reason,
  });
  if (error) return { error: error.message };

  revalidatePath(`/patients/${patientId}`);
  return undefined;
}
