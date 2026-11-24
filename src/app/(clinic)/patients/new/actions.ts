"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { normalizeDominicanPhone } from "@/lib/domain/phone";
import { parseIdentityFromForm, parseReligionFromForm } from "@/lib/domain/patient-identity";

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
  const isTest = formData.get("is_test") === "on";

  if (!firstName || !lastName) return { error: "Nombre y apellido son requeridos." };
  if (!dateOfBirth) return { error: "La fecha de nacimiento es requerida." };
  if (sex !== "femenino" && sex !== "masculino") return { error: "Selecciona el sexo." };

  // Ficha de identificación: listas cerradas, longitudes y regla del informante (la base de datos vuelve a validar).
  const identity = parseIdentityFromForm(formData);
  if (identity.error) return { error: identity.error };

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

  // La religión es un dato sensible: solo la registran administradores y médicos (recepción ni la ve en el formulario;
  // si llegara el campo, se ignora aquí y la base de datos lo rechazaría igual).
  const isClinician = membership.role === "admin" || membership.role === "medico";
  const religion = isClinician ? parseReligionFromForm(formData) : { value: null };
  if ("error" in religion && religion.error) return { error: religion.error };

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
      is_test: isTest,
      ...identity.values,
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

  // Religión (opcional): segunda escritura en la misma operación, por la función que verifica rol y clínica. Si fallara,
  // el paciente ya existe: se lleva a Editar para volver a indicarla (en vez de dejar el formulario y duplicar el alta).
  if (religion.value) {
    const { error: religionError } = await supabase.rpc("save_patient_religion", {
      p_patient_id: patient.id,
      p_religion: religion.value.religion,
      p_other: religion.value.religion_other ?? undefined,
    });
    if (religionError) redirect(`/patients/${patient.id}/edit?aviso=religion`);
  }

  redirect(`/patients/${patient.id}`);
}
