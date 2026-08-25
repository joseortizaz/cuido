"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { parseTemplateSchema } from "@/lib/domain/specialty-template";
import {
  ENCOUNTER_ROW_LIMIT,
  groupEncounterRows,
  parseEncounterImportFile,
  validateEncounterGroups,
  isImportableField,
  type EncounterImportGroup,
} from "@/lib/bulk-import/encounters";

export type UploadEncounterImportState = { error?: string } | undefined;

/**
 * Sube el archivo, agrupa por (Cédula, Fecha), valida y guarda el batch
 * como staging (status='validado') -- NO escribe nada en encounters
 * todavía. Solo admin de la propia clínica, misma regla que Fase 1.
 *
 * Persiste los insumos de cada grupo (cédula/fecha/médico/campos tal
 * como vinieron del archivo) + `structuralErrors` (semilla determinística
 * de agrupación) + `errors` (resultado completo de ESTA validación, para
 * mostrar en el preview) -- pero nunca `resolved` (paciente/proveedor/
 * specialty_data ya resueltos). Al confirmar se vuelve a llamar
 * `validateEncounterGroups` partiendo de `structuralErrors`, nunca de
 * `errors` -- si partiera de `errors` (que ya incluye validaciones
 * contra la base de ESTA corrida), una segunda validación duplicaría
 * mensajes en vez de simplemente refrescarlos.
 */
export async function uploadEncounterImport(
  _prevState: UploadEncounterImportState,
  formData: FormData
): Promise<UploadEncounterImportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") {
    return { error: "Solo el administrador de la clínica puede importar consultas." };
  }

  const specialtyTemplateId = String(formData.get("specialty_template_id") ?? "").trim();
  if (!specialtyTemplateId) return { error: "Selecciona una especialidad." };

  const { data: template } = await supabase
    .from("specialty_templates")
    .select("id, name, schema, is_active, requires_explicit_access")
    .eq("id", specialtyTemplateId)
    .maybeSingle();
  if (!template || !template.is_active) return { error: "Especialidad no encontrada." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo .xlsx o .csv." };
  }
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return { error: "El archivo debe ser .xlsx o .csv." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows: rawRows, parseError } = await parseEncounterImportFile(buffer, file.name);
  if (parseError) return { error: parseError };
  if (rawRows.length === 0) return { error: "El archivo no tiene filas de datos." };
  if (rawRows.length > ENCOUNTER_ROW_LIMIT) {
    return { error: `Este archivo tiene ${rawRows.length} filas. Divide tu archivo en lotes de máximo ${ENCOUNTER_ROW_LIMIT} filas.` };
  }

  const { fields } = parseTemplateSchema(template.schema);
  const importableFields = fields.filter(isImportableField);
  const allFieldsByNormalizedLabel = new Map(
    fields.map((f) => [
      f.label
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase(),
      f,
    ])
  );

  const groups = groupEncounterRows(rawRows);

  const { data: existingPatients } = await supabase
    .from("patients")
    .select("id, national_id")
    .not("national_id", "is", null);
  const existingPatientIdByNationalId = new Map(
    (existingPatients ?? []).map((p) => [p.national_id as string, p.id])
  );

  const { data: clinicMembers } = await supabase.from("clinic_members").select("user_id");
  const admin = createAdminClient();
  const clinicMemberIdByEmail = new Map<string, string>();
  await Promise.all(
    (clinicMembers ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      if (data.user?.email) clinicMemberIdByEmail.set(data.user.email.toLowerCase(), m.user_id);
    })
  );

  const validated = validateEncounterGroups(groups, {
    importableFields,
    allFieldsByNormalizedLabel,
    existingPatientIdByNationalId,
    clinicMemberIdByEmail,
    importingAdminId: user.id,
    specialtyIsSensitive: template.requires_explicit_access,
  });

  const validCount = validated.filter((g) => g.errors.length === 0).length;

  // Persiste solo los insumos (sin `resolved`) -- ver nota arriba.
  const batchRows: EncounterImportGroup[] = validated.map(({ resolved: _resolved, ...group }) => group);

  const { data: batch, error } = await supabase
    .from("bulk_import_batches")
    .insert({
      clinic_id: membership.clinicId,
      import_type: "encounters",
      specialty_template_id: specialtyTemplateId,
      file_name: file.name,
      row_count: validated.length,
      valid_row_count: validCount,
      error_row_count: validated.length - validCount,
      rows: batchRows,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !batch) {
    return { error: "No se pudo guardar el lote para revisión." };
  }

  redirect(`/patients/import/review/${batch.id}`);
}
