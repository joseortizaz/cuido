"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { normalizeDominicanPhone } from "@/lib/domain/phone";

export type WhatsAppFormState = { error?: string; success?: string } | undefined;

const CONSENT_SOURCES = ["verbal", "escrito", "otro"] as const;
type ConsentSource = (typeof CONSENT_SOURCES)[number];

/**
 * Solo admin y recepción registran/revocan consentimientos y editan el contacto. El chequeo de rol
 * aquí es comodidad; las barreras reales son las políticas de patient_messaging_consents y
 * patients (supabase/migrations/20261018100000_whatsapp_reminders_base.sql).
 */
async function staffContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  const blocked = await readOnlyBlock(supabase);
  const canManage = membership.role === "admin" || membership.role === "recepcion";
  return { supabase, user, membership, blocked, canManage };
}

/** Edita el teléfono y el correo del paciente. Si el número cambia, el consentimiento anterior se revoca. */
export async function updatePatientContact(
  patientId: string,
  _prevState: WhatsAppFormState,
  formData: FormData
): Promise<WhatsAppFormState> {
  const { supabase, blocked, canManage } = await staffContext();
  if (blocked) return { error: blocked };
  if (!canManage) return { error: "No tienes permiso para editar el contacto del paciente." };

  const rawPhone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  // Un número dominicano se guarda normalizado (+1809…); cualquier otro (extranjero) se guarda tal cual.
  const phone = rawPhone ? (normalizeDominicanPhone(rawPhone) ?? rawPhone) : null;

  const { data: active } = await supabase
    .from("patient_messaging_consents")
    .select("id, phone_e164")
    .eq("patient_id", patientId)
    .is("revoked_at", null)
    .maybeSingle();

  const { error } = await supabase
    .from("patients")
    .update({ phone, email: email || null })
    .eq("id", patientId);
  if (error) return { error: "No se pudo guardar el contacto." };

  let message = "Contacto guardado.";
  if (active && normalizeDominicanPhone(phone) !== active.phone_e164) {
    // El consentimiento es de ESE número: si cambió, ya no vale para el nuevo.
    await supabase
      .from("patient_messaging_consents")
      .update({ revoked_at: new Date().toISOString(), revoke_source: "personal" })
      .eq("id", active.id);
    message =
      "Contacto guardado. El número cambió, así que el consentimiento anterior se revocó: registra uno nuevo para el número actual.";
  }

  revalidatePath(`/patients/${patientId}`);
  return { success: message };
}

/** Registra que el paciente aceptó recibir recordatorios por WhatsApp al teléfono que tiene en su ficha. */
export async function grantWhatsAppConsent(
  patientId: string,
  _prevState: WhatsAppFormState,
  formData: FormData
): Promise<WhatsAppFormState> {
  const { supabase, membership, blocked, canManage } = await staffContext();
  if (blocked) return { error: blocked };
  if (!canManage) return { error: "No tienes permiso para registrar consentimientos." };

  const source = String(formData.get("source") ?? "") as ConsentSource;
  if (!CONSENT_SOURCES.includes(source)) return { error: "Indica cómo aceptó el paciente." };
  if (formData.get("confirm") !== "on") {
    return { error: "Confirma que el paciente aceptó recibir recordatorios por WhatsApp." };
  }

  // El teléfono sale de la ficha (no del formulario): así el consentimiento corresponde al número guardado.
  const { data: patient } = await supabase.from("patients").select("phone").eq("id", patientId).maybeSingle();
  const phone = normalizeDominicanPhone(patient?.phone);
  if (!phone) {
    return { error: "El teléfono de la ficha no es un número dominicano válido (809, 829 o 849). Corrígelo primero." };
  }

  // clinic_id lo deriva el trigger del paciente; aquí solo cumple el tipo del Insert.
  const { error } = await supabase.from("patient_messaging_consents").insert({
    clinic_id: membership.clinicId,
    patient_id: patientId,
    phone_e164: phone,
    source,
  });
  if (error) {
    if (error.code === "23505") return { error: "Este paciente ya tiene un consentimiento activo." };
    return { error: "No se pudo registrar el consentimiento." };
  }

  revalidatePath(`/patients/${patientId}`);
  return { success: "Consentimiento registrado." };
}

/** Revoca el consentimiento activo (el personal quita al paciente de los recordatorios). */
export async function revokeWhatsAppConsent(
  patientId: string,
  consentId: string,
  _prevState: WhatsAppFormState,
  _formData: FormData
): Promise<WhatsAppFormState> {
  void _formData;
  const { supabase, blocked, canManage } = await staffContext();
  if (blocked) return { error: blocked };
  if (!canManage) return { error: "No tienes permiso para revocar consentimientos." };

  const { error } = await supabase
    .from("patient_messaging_consents")
    .update({ revoked_at: new Date().toISOString(), revoke_source: "personal" })
    .eq("id", consentId)
    .eq("patient_id", patientId)
    .is("revoked_at", null);
  if (error) return { error: "No se pudo revocar el consentimiento." };

  revalidatePath(`/patients/${patientId}`);
  return { success: "Consentimiento revocado." };
}
