"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { buildZodSchemaForTemplate, parseTemplateSchema } from "@/lib/domain/specialty-template";
import type { Json } from "@/lib/supabase/database.types";

export type EncounterFormState = { error?: string } | undefined;

function optionalNumber(formData: FormData, key: string): number | null {
  const raw = formData.get(key);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}

/**
 * clinic_id se deriva aquí de la membresía del usuario y, de nuevo, en el
 * trigger set_clinic_id_from_patient() en la base de datos — la barrera de
 * seguridad real es el trigger, esto es solo para satisfacer el tipo de
 * Insert. provider_id SIEMPRE es auth.uid(), nunca un campo de formulario.
 */
export async function createEncounter(
  patientId: string,
  templateId: string,
  _prevState: EncounterFormState,
  formData: FormData
): Promise<EncounterFormState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { error: "No tienes permiso para registrar consultas." };
  }

  // Se vuelve a leer el template desde la base (no se confía en lo que el
  // formulario diga que es su schema) para construir la validación.
  const { data: template, error: templateError } = await supabase
    .from("specialty_templates")
    .select("id, schema")
    .eq("id", templateId)
    .single();
  if (templateError || !template) {
    return { error: "No se encontró la plantilla de especialidad." };
  }

  const parsed = parseTemplateSchema(template.schema);
  const zodSchema = buildZodSchemaForTemplate(parsed.fields);

  const rawSpecialtyData: Record<string, unknown> = {};
  for (const field of parsed.fields) {
    rawSpecialtyData[field.key] = formData.get(`field-${field.key}`) ?? "";
  }

  const validation = zodSchema.safeParse(rawSpecialtyData);
  if (!validation.success) {
    const firstIssue = validation.error.issues[0];
    return { error: firstIssue?.message ?? "Revisa los campos de la consulta." };
  }

  const chiefComplaint = String(formData.get("chief_complaint") ?? "").trim();

  const { data: encounter, error: encounterError } = await supabase
    .from("encounters")
    .insert({
      clinic_id: membership.clinicId,
      patient_id: patientId,
      provider_id: user.id,
      specialty_template_id: templateId,
      chief_complaint: chiefComplaint || null,
      specialty_data: validation.data as unknown as Json,
    })
    .select("id")
    .single();

  if (encounterError || !encounter) {
    return { error: "No se pudo guardar la consulta." };
  }

  const vitals = {
    systolic_bp: optionalNumber(formData, "systolic_bp"),
    diastolic_bp: optionalNumber(formData, "diastolic_bp"),
    heart_rate: optionalNumber(formData, "heart_rate"),
    respiratory_rate: optionalNumber(formData, "respiratory_rate"),
    temperature_celsius: optionalNumber(formData, "temperature_celsius"),
    oxygen_saturation: optionalNumber(formData, "oxygen_saturation"),
    weight_kg: optionalNumber(formData, "weight_kg"),
    height_cm: optionalNumber(formData, "height_cm"),
  };
  const hasAnyVital = Object.values(vitals).some((v) => v !== null);

  if (hasAnyVital) {
    await supabase.from("vital_signs").insert({
      clinic_id: membership.clinicId,
      encounter_id: encounter.id,
      ...vitals,
    });
  }

  redirect(`/patients/${patientId}/encounters/${encounter.id}`);
}
