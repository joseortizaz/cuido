"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import {
  PATIENT_ROW_LIMIT,
  parsePatientImportFile,
  validatePatientRows,
  type PatientImportRawRow,
} from "@/lib/bulk-import/patients";

export type UploadPatientImportState = { error?: string } | undefined;

/**
 * Sube el archivo, parsea, valida y guarda el batch como staging
 * (status='validado') -- NO escribe nada en patients/allergies/
 * medications todavía. Solo admin de la propia clínica -- decisión
 * explícita del usuario, reforzada aquí (no hay política RLS "solo
 * admin" separada para patients, esta es una regla de esta función).
 */
export async function uploadPatientImport(
  _prevState: UploadPatientImportState,
  formData: FormData
): Promise<UploadPatientImportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") {
    return { error: "Solo el administrador de la clínica puede importar pacientes." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona un archivo .xlsx o .csv." };
  }
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return { error: "El archivo debe ser .xlsx o .csv." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows: rawRows, parseError } = await parsePatientImportFile(buffer, file.name);
  if (parseError) return { error: parseError };
  if (rawRows.length === 0) return { error: "El archivo no tiene filas de datos." };
  if (rawRows.length > PATIENT_ROW_LIMIT) {
    return { error: `Este archivo tiene ${rawRows.length} filas. Divide tu archivo en lotes de máximo ${PATIENT_ROW_LIMIT} filas.` };
  }

  const { data: existing } = await supabase
    .from("patients")
    .select("national_id")
    .not("national_id", "is", null);
  const existingNationalIds = new Set((existing ?? []).map((p) => p.national_id as string));

  const validated = validatePatientRows(rawRows, existingNationalIds);
  const validCount = validated.filter((r) => r.errors.length === 0).length;

  const batchRows = validated.map((v, i) => ({
    row_number: v.rowNumber,
    raw: rawRows[i] as PatientImportRawRow,
    errors: v.errors,
  }));

  const { data: batch, error } = await supabase
    .from("bulk_import_batches")
    .insert({
      clinic_id: membership.clinicId,
      import_type: "patients",
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
