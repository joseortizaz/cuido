"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership, type ClinicMembership } from "@/lib/supabase/clinic-context";
import { validatePatientRows, type PatientImportRawRow } from "@/lib/bulk-import/patients";
import { validateEncounterGroups, type EncounterImportGroup } from "@/lib/bulk-import/encounters";
import { parseTemplateSchema } from "@/lib/domain/specialty-template";
import type { Database } from "@/lib/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BatchActionState = { error?: string } | undefined;

type PatientBatchRow = { row_number: number; raw: PatientImportRawRow; errors: string[] };
type Supabase = SupabaseClient<Database>;

async function requireAdminBatch(batchId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/patients");

  const { data: batch } = await supabase
    .from("bulk_import_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();

  return { supabase, user, membership, batch };
}

export async function cancelImportBatch(batchId: string): Promise<void> {
  const { supabase, batch } = await requireAdminBatch(batchId);
  if (!batch || batch.status !== "validado") return;

  await supabase.from("bulk_import_batches").update({ status: "cancelado" }).eq("id", batchId);
  revalidatePath(`/patients/import/review/${batchId}`);
}

/**
 * NUNCA confía en el resultado del preview -- vuelve a validar desde cero
 * contra el estado ACTUAL de la base (pudo pasar tiempo, o cambiar algo
 * desde entonces por otra vía). Éxito parcial tolerado: un dato malo en
 * una fila/consulta no bloquea las demás -- esperable en una migración
 * real. Despacha según `import_type` -- ambas ramas comparten el mismo
 * criterio de "revalidar todo, sobreescribir rows/valid_row_count/
 * error_row_count con el resultado REAL en vez de agregar columnas
 * nuevas solo para el reporte final" (Fase 1).
 */
export async function confirmImportBatch(
  batchId: string,
  _prevState: BatchActionState,
  _formData: FormData
): Promise<BatchActionState> {
  const { supabase, user, membership, batch } = await requireAdminBatch(batchId);
  if (!batch) return { error: "Lote no encontrado." };
  if (batch.status !== "validado") return { error: "Este lote ya fue confirmado o cancelado." };

  if (batch.import_type === "patients") {
    return confirmPatientBatch(supabase, membership, batchId, batch.rows as unknown as PatientBatchRow[]);
  }
  if (batch.import_type === "encounters") {
    if (!batch.specialty_template_id) return { error: "Este lote no tiene especialidad asociada." };
    return confirmEncounterBatch(
      supabase,
      membership,
      user.id,
      batchId,
      batch.specialty_template_id,
      batch.rows as unknown as EncounterImportGroup[]
    );
  }
  return { error: "Tipo de lote no soportado." };
}

async function confirmPatientBatch(
  supabase: Supabase,
  membership: ClinicMembership,
  batchId: string,
  storedRows: PatientBatchRow[]
): Promise<BatchActionState> {
  const rawRows = storedRows.map((r) => r.raw);

  const { data: existing } = await supabase
    .from("patients")
    .select("national_id")
    .not("national_id", "is", null);
  const existingNationalIds = new Set((existing ?? []).map((p) => p.national_id as string));

  const revalidated = validatePatientRows(rawRows, existingNationalIds);

  const finalRows: PatientBatchRow[] = [];
  let createdCount = 0;

  for (let i = 0; i < revalidated.length; i++) {
    const row = revalidated[i];
    if (row.errors.length > 0 || !row.data) {
      finalRows.push({ row_number: row.rowNumber, raw: rawRows[i], errors: row.errors });
      continue;
    }

    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .insert({
        clinic_id: membership.clinicId,
        first_name: row.data.first_name,
        last_name: row.data.last_name,
        national_id: row.data.national_id,
        date_of_birth: row.data.date_of_birth,
        sex: row.data.sex,
        phone: row.data.phone,
        email: row.data.email,
      })
      .select("id")
      .single();

    if (patientError || !patient) {
      finalRows.push({
        row_number: row.rowNumber,
        raw: rawRows[i],
        errors: [`No se pudo crear el paciente: ${patientError?.message ?? "error desconocido"}`],
      });
      continue;
    }

    // clinic_id se deriva del trigger *_set_clinic_id_from_patient en la
    // base (mismo patrón que encounters/appointments) -- se pasa aquí
    // solo para satisfacer el tipo de Insert.
    if (row.data.allergies.length > 0) {
      await supabase.from("allergies").insert(
        row.data.allergies.map((substance) => ({
          clinic_id: membership.clinicId,
          patient_id: patient.id,
          substance,
        }))
      );
    }
    if (row.data.medications.length > 0) {
      await supabase.from("medications").insert(
        row.data.medications.map((name) => ({
          clinic_id: membership.clinicId,
          patient_id: patient.id,
          name,
        }))
      );
    }

    createdCount++;
    finalRows.push({ row_number: row.rowNumber, raw: rawRows[i], errors: [] });
  }

  // Sin filtro por created_by a propósito: la política RLS ya gatea por
  // is_clinic_admin(clinic_id), no por quién subió el archivo -- cualquier
  // admin de la clínica puede confirmar un lote que otro admin dejó en
  // revisión, igual que cualquier admin puede ver/gestionar los mismos
  // datos de la clínica.
  await supabase
    .from("bulk_import_batches")
    .update({
      status: "confirmado",
      confirmed_at: new Date().toISOString(),
      rows: finalRows as unknown as Database["public"]["Tables"]["bulk_import_batches"]["Update"]["rows"],
      valid_row_count: createdCount,
      error_row_count: finalRows.length - createdCount,
    })
    .eq("id", batchId);

  revalidatePath(`/patients/import/review/${batchId}`);
  return undefined;
}

/**
 * Re-deriva TODO desde cero -- schema de la especialidad (pudo editarse
 * desde el preview), pacientes existentes, y miembros de la clínica.
 * Parte de `structuralErrors` de cada grupo persistido, NUNCA de
 * `errors` (que ya incluye validaciones de esta corrida específica) --
 * ver la nota en .../import/encounters/actions.ts sobre por qué.
 */
async function confirmEncounterBatch(
  supabase: Supabase,
  membership: ClinicMembership,
  importingAdminId: string,
  batchId: string,
  specialtyTemplateId: string,
  storedGroups: EncounterImportGroup[]
): Promise<BatchActionState> {
  const { data: template } = await supabase
    .from("specialty_templates")
    .select("schema, requires_explicit_access")
    .eq("id", specialtyTemplateId)
    .maybeSingle();
  if (!template) return { error: "La especialidad de este lote ya no existe." };

  const { fields } = parseTemplateSchema(template.schema);
  const importableFields = fields.filter((f) => (f.type === "text" || f.type === "textarea" || f.type === "number") && !f.condition);
  const allFieldsByNormalizedLabel = new Map(
    fields.map((f) => [f.label.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase(), f])
  );

  const { data: existingPatients } = await supabase
    .from("patients")
    .select("id, national_id")
    .not("national_id", "is", null);
  const existingPatientIdByNationalId = new Map((existingPatients ?? []).map((p) => [p.national_id as string, p.id]));

  const { data: clinicMembersRaw } = await supabase.from("clinic_members").select("user_id");
  const admin = createAdminClient();
  const clinicMemberIdByEmail = new Map<string, string>();
  await Promise.all(
    (clinicMembersRaw ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      if (data.user?.email) clinicMemberIdByEmail.set(data.user.email.toLowerCase(), m.user_id);
    })
  );

  const groupsForRevalidation: EncounterImportGroup[] = storedGroups.map((g) => ({
    ...g,
    structuralErrors: g.structuralErrors ?? [],
  }));

  const revalidated = validateEncounterGroups(groupsForRevalidation, {
    importableFields,
    allFieldsByNormalizedLabel,
    existingPatientIdByNationalId,
    clinicMemberIdByEmail,
    importingAdminId,
    specialtyIsSensitive: template.requires_explicit_access,
  });

  // Cada fila final conserva `structuralErrors` sin tocar (el sembrado
  // original de agrupación, sin significado después de confirmar) y
  // agrega/actualiza `errors` con el resultado REAL de esta confirmación
  // -- misma forma que un grupo `validado` (EncounterImportGroup +
  // `errors`), para que la página de revisión no necesite lógica
  // distinta según el estado del lote.
  const finalGroups: (EncounterImportGroup & { errors: string[] })[] = [];
  let createdCount = 0;

  for (const group of revalidated) {
    const { resolved, errors, ...rest } = group;

    if (errors.length > 0 || !resolved) {
      finalGroups.push({ ...rest, errors });
      continue;
    }

    const scheduledAt = new Date(`${group.scheduledAt}T12:00:00Z`).toISOString();
    const { error: encounterError } = await supabase.from("encounters").insert({
      clinic_id: membership.clinicId,
      patient_id: resolved.patientId,
      provider_id: resolved.providerId,
      specialty_template_id: specialtyTemplateId,
      specialty_data: resolved.specialtyData as Database["public"]["Tables"]["encounters"]["Insert"]["specialty_data"],
      encounter_date: scheduledAt,
    });

    if (encounterError) {
      finalGroups.push({ ...rest, errors: [`No se pudo crear la consulta: ${encounterError.message}`] });
      continue;
    }

    createdCount++;
    finalGroups.push({ ...rest, errors: [] });
  }

  await supabase
    .from("bulk_import_batches")
    .update({
      status: "confirmado",
      confirmed_at: new Date().toISOString(),
      rows: finalGroups as unknown as Database["public"]["Tables"]["bulk_import_batches"]["Update"]["rows"],
      valid_row_count: createdCount,
      error_row_count: finalGroups.length - createdCount,
    })
    .eq("id", batchId);

  revalidatePath(`/patients/import/review/${batchId}`);
  return undefined;
}
