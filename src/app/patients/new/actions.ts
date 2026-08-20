"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

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

  const supabase = await createClient();
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const { data: patient, error } = await supabase
    .from("patients")
    .insert({
      clinic_id: membership.clinicId,
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      sex,
      national_id: nationalId || null,
      phone: phone || null,
      email: email || null,
    })
    .select("id")
    .single();

  if (error || !patient) {
    return { error: "No se pudo crear el paciente. Verifica que la cédula no esté duplicada." };
  }

  redirect(`/patients/${patient.id}`);
}
