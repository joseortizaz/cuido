"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";

export type SimpleFormState = { error?: string } | undefined;

/**
 * clinic_id se re-deriva aquí de la membresía del usuario (nunca de un
 * campo del formulario). El trigger set_clinic_id_from_patient() en la
 * base de datos es la barrera de seguridad real -- si patient_id no
 * perteneciera a esta clínica, el trigger lo sobreescribiría con el
 * clinic_id verdadero y RLS rechazaría el insert. Ver
 * supabase/migrations/20260820111106_clinical_core_and_templates.sql.
 */
export async function addAllergy(
  patientId: string,
  _prevState: SimpleFormState,
  formData: FormData
): Promise<SimpleFormState> {
  const substance = String(formData.get("substance") ?? "").trim();
  const reaction = String(formData.get("reaction") ?? "").trim();
  const severity = String(formData.get("severity") ?? "");

  if (!substance) return { error: "La sustancia es requerida." };

  const supabase = await createClient();
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) return { error: "No se pudo determinar tu clínica." };

  const { error } = await supabase.from("allergies").insert({
    clinic_id: membership.clinicId,
    patient_id: patientId,
    substance,
    reaction: reaction || null,
    severity: severity === "leve" || severity === "moderada" || severity === "severa" ? severity : null,
  });

  if (error) {
    return { error: "No se pudo registrar la alergia." };
  }

  revalidatePath(`/patients/${patientId}`);
  return undefined;
}

export async function addMedication(
  patientId: string,
  _prevState: SimpleFormState,
  formData: FormData
): Promise<SimpleFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const dose = String(formData.get("dose") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "").trim();

  if (!name) return { error: "El nombre del medicamento es requerido." };

  const supabase = await createClient();
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) return { error: "No se pudo determinar tu clínica." };

  const { error } = await supabase.from("medications").insert({
    clinic_id: membership.clinicId,
    patient_id: patientId,
    name,
    dose: dose || null,
    frequency: frequency || null,
    started_at: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    return { error: "No se pudo registrar el medicamento." };
  }

  revalidatePath(`/patients/${patientId}`);
  return undefined;
}
