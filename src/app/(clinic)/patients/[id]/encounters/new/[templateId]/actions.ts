"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { activeFieldsForType, buildZodSchemaForTemplate, parseTemplateSchema } from "@/lib/domain/specialty-template";
import { FIXED_TYPE_BY_TEMPLATE_CODE, asksPresentIllness, isEncounterType, type EncounterType } from "@/lib/domain/encounter-types";
import { parseDiagnosesJson } from "@/lib/domain/encounter-diagnoses";
import { getIcdRelease } from "@/lib/cie11/who-client";
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
  appointmentId: string | null,
  encounterType: EncounterType,
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
  const readOnly = await readOnlyBlock(supabase);
  if (readOnly) return { error: readOnly };
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { error: "No tienes permiso para registrar consultas." };
  }

  // Se vuelve a leer el template desde la base (no se confía en lo que el
  // formulario diga que es su schema) para construir la validación.
  const { data: template, error: templateError } = await supabase
    .from("specialty_templates")
    .select("id, code, schema")
    .eq("id", templateId)
    .single();
  if (templateError || !template) {
    return { error: "No se encontró la plantilla de especialidad." };
  }

  // El tipo viene de la URL del formulario: se valida aquí, y las plantillas quirúrgicas fijan el suyo.
  if (!isEncounterType(encounterType)) return { error: "Elige el tipo de consulta." };
  const fixedType = FIXED_TYPE_BY_TEMPLATE_CODE[template.code];
  if (fixedType && fixedType !== encounterType) return { error: "El tipo de consulta no corresponde a esta plantilla." };

  // Solo se piden y se validan los campos que aplican a este tipo (los legacy y los de otro tipo se ignoran).
  const parsed = parseTemplateSchema(template.schema);
  const activeFields = activeFieldsForType(parsed.fields, encounterType);
  const zodSchema = buildZodSchemaForTemplate(activeFields);

  const rawSpecialtyData: Record<string, unknown> = {};
  for (const field of activeFields) {
    rawSpecialtyData[field.key] = formData.get(`field-${field.key}`) ?? "";
  }

  const validation = zodSchema.safeParse(rawSpecialtyData);
  if (!validation.success) {
    const firstIssue = validation.error.issues[0];
    return { error: firstIssue?.message ?? "Revisa los campos de la consulta." };
  }

  const chiefComplaint = String(formData.get("chief_complaint") ?? "").trim();
  const presentIllness = asksPresentIllness(encounterType) ? String(formData.get("present_illness") ?? "").trim() : "";
  if (presentIllness.length > 5000) return { error: "La historia de la enfermedad actual es demasiado larga (máximo 5000 caracteres)." };

  // Diagnósticos codificados CIE-11 (opcionales): se validan aquí y la base los guarda JUNTO con la consulta, en
  // una sola transacción (create_encounter_with_diagnoses): si algo falla, no queda una consulta a medias.
  const diagnoses = parseDiagnosesJson(String(formData.get("diagnoses_json") ?? ""));
  if (diagnoses.error) return { error: diagnoses.error };

  // provider_id = auth.uid() y clinic_id (del paciente) los fija la función; el cliente no los envía.
  const { data: encounterId, error: encounterError } = await supabase.rpc("create_encounter_with_diagnoses", {
    p_patient_id: patientId,
    p_template_id: templateId,
    p_encounter_type: encounterType,
    p_chief_complaint: chiefComplaint,
    p_present_illness: presentIllness,
    p_specialty_data: validation.data as unknown as Json,
    p_diagnoses: diagnoses.items as unknown as Json,
    p_release: getIcdRelease(),
  });

  if (encounterError || !encounterId) {
    const message = encounterError?.message ?? "";
    if (message.includes("expediente abierto")) {
      return { error: "El paciente no tiene el expediente abierto: un médico debe abrirlo antes de registrar consultas." };
    }
    if (message.includes("anulado")) return { error: message };
    // Errores de validación de los diagnósticos codificados (la consulta no se guardó).
    if (encounterError?.code === "22023" || encounterError?.code === "42501") return { error: message };
    return { error: "No se pudo guardar la consulta." };
  }
  const encounter = { id: encounterId };

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

  // "Convertir a consulta": si la consulta vino de una cita agendada,
  // marca la cita completada y la enlaza a este encounter en un solo
  // paso, vía el RPC security definer (el médico no tiene UPDATE
  // directo sobre appointments -- ver
  // supabase/migrations/20260824100000_appointments.sql). No bloquea el
  // flujo principal si falla: el encounter ya se guardó y es válido por
  // sí solo, igual que el registro opcional de vital_signs arriba.
  if (appointmentId) {
    await supabase.rpc("complete_appointment_with_encounter", {
      target_appointment_id: appointmentId,
      target_encounter_id: encounter.id,
    });
  }

  redirect(`/patients/${patientId}/encounters/${encounter.id}`);
}
