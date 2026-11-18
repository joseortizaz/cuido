"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { normalizeDominicanPhone, samePhone } from "@/lib/domain/phone";

export type EditPatientState = { error?: string } | undefined;

/**
 * Edita los datos del paciente (sin el código, que no se cambia). Solo admin y médicos: la barrera
 * real es la política de UPDATE de patients; el chequeo de rol aquí es comodidad. Cada campo que
 * cambia queda en patient_change_log por trigger (quién, cuándo, antes y después).
 */
export async function updatePatient(
  patientId: string,
  _prevState: EditPatientState,
  formData: FormData
): Promise<EditPatientState> {
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const dateOfBirth = String(formData.get("date_of_birth") ?? "");
  const sex = String(formData.get("sex") ?? "");
  const nationalId = String(formData.get("national_id") ?? "").trim();
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!firstName || !lastName) return { error: "Nombre y apellido son requeridos." };
  if (!dateOfBirth) return { error: "La fecha de nacimiento es requerida." };
  if (sex !== "femenino" && sex !== "masculino") return { error: "Selecciona el sexo." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { error: "No tienes permiso para editar pacientes." };
  }
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { error: blocked };

  const { data: current } = await supabase
    .from("patients")
    .select("first_name, last_name, national_id, date_of_birth, sex, phone, email")
    .eq("id", patientId)
    .maybeSingle();
  if (!current) return { error: "No se encontró el paciente." };

  // Un número dominicano se guarda normalizado (+1809…); cualquier otro tal cual. Si es el mismo
  // número que ya estaba (aunque escrito distinto) se conserva como estaba, para no registrar un
  // «cambio» que no lo es.
  const phone = !rawPhone ? null : samePhone(rawPhone, current.phone) ? current.phone : (normalizeDominicanPhone(rawPhone) ?? rawPhone);

  const next = {
    first_name: firstName,
    last_name: lastName,
    national_id: nationalId || null,
    date_of_birth: dateOfBirth,
    sex,
    phone,
    email: email || null,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== current[k]);
  if (changed.length === 0) redirect(`/patients/${patientId}`);

  const { error } = await supabase.from("patients").update(next).eq("id", patientId);
  if (error) {
    if (error.code === "23505") return { error: "Ya existe otro paciente con esa cédula o pasaporte en tu clínica." };
    return { error: "No se pudo guardar. Intenta de nuevo." };
  }

  // El consentimiento de WhatsApp es de un número concreto: si el teléfono cambió, el vigente ya no vale.
  if (changed.includes("phone")) {
    await supabase.rpc("revoke_stale_patient_consent", {
      p_patient_id: patientId,
      p_phone_e164: normalizeDominicanPhone(phone) ?? "",
    });
  }

  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
  redirect(`/patients/${patientId}`);
}
