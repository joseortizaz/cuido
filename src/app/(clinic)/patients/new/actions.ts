"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { normalizeDominicanPhone } from "@/lib/domain/phone";

export type PatientFormState = { error?: string } | undefined;

export async function createPatient(
  _prevState: PatientFormState,
  formData: FormData
): Promise<PatientFormState> {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const dateOfBirth = String(formData.get("date_of_birth") ?? "");
  const sex = String(formData.get("sex") ?? "");
  const nationalId = String(formData.get("national_id") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!firstName || !lastName) return { error: "Nombre y apellido son requeridos." };
  if (!dateOfBirth) return { error: "La fecha de nacimiento es requerida." };
  if (sex !== "femenino" && sex !== "masculino") return { error: "Selecciona el sexo." };

  // Consentimiento de WhatsApp (opcional): exige un teléfono dominicano válido ANTES de crear al paciente.
  const wantsConsent = formData.get("whatsapp_consent") === "on";
  const consentSource = String(formData.get("whatsapp_source") ?? "verbal");
  const consentPhone = normalizeDominicanPhone(phone);
  if (wantsConsent && !consentPhone) {
    return { error: "Para registrar el consentimiento de WhatsApp indica un teléfono dominicano válido (809, 829 o 849)." };
  }
  if (wantsConsent && !["verbal", "escrito", "otro"].includes(consentSource)) {
    return { error: "Indica cómo aceptó el paciente." };
  }

  const supabase = await createClient();
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };

  const { data: patient, error } = await supabase
    .from("patients")
    .insert({
      clinic_id: membership.clinicId,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      sex,
      national_id: nationalId || null,
      phone: consentPhone ?? (phone || null),
      email: email || null,
    })
    .select("id")
    .single();

  if (error || !patient) {
    return { error: "No se pudo crear el paciente. Verifica que la cédula no esté duplicada." };
  }

  // Solo admin y recepción registran consentimientos (la política de la tabla lo exige igual).
  if (wantsConsent && consentPhone && (membership.role === "admin" || membership.role === "recepcion")) {
    await supabase.from("patient_messaging_consents").insert({
      clinic_id: membership.clinicId,
      patient_id: patient.id,
      phone_e164: consentPhone,
      source: consentSource as "verbal" | "escrito" | "otro",
    });
  }

  redirect(`/patients/${patient.id}`);
}
