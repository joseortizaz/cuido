"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { validatePatientRows, type PatientImportRawRow } from "@/lib/bulk-import/patients";
import type { Database } from "@/lib/supabase/database.types";

export type BatchActionState = { error?: string } | undefined;

type BatchRow = { row_number: number; raw: PatientImportRawRow; errors: string[] };

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
 * NUNCA confía en el resultado del preview (bulk_import_batches.rows.errors
 * calculado al subir el archivo) -- vuelve a validar desde cero contra el
 * estado ACTUAL de la base (pudo pasar tiempo, o crearse un paciente con
 * la misma cédula desde entonces por otra vía). Éxito parcial tolerado:
 * un dato malo en una fila no bloquea las demás -- esperable en una
 * migración real de cientos de pacientes.
 *
 * Al terminar, sobreescribe bulk_import_batches.rows/valid_row_count/
 * error_row_count con el resultado REAL de la confirmación (no el del
 * preview) -- mismas columnas, significado que pasa de "lo que se
 * proyectaba crear" a "lo que efectivamente se creó". Reutilizar en vez
 * de agregar columnas nuevas solo para este reporte final.
 */
export async function confirmImportBatch(
  batchId: string,
  _prevState: BatchActionState,
  _formData: FormData
): Promise<BatchActionState> {
  const { supabase, membership, batch } = await requireAdminBatch(batchId);
  if (!batch) return { error: "Lote no encontrado." };
  if (batch.status !== "validado") return { error: "Este lote ya fue confirmado o cancelado." };
  if (batch.import_type !== "patients") return { error: "Tipo de lote no soportado todavía." };

  const rawRows = (batch.rows as BatchRow[]).map((r) => r.raw);

  const { data: existing } = await supabase
    .from("patients")
    .select("national_id")
    .not("national_id", "is", null);
  const existingNationalIds = new Set((existing ?? []).map((p) => p.national_id as string));

  const revalidated = validatePatientRows(rawRows, existingNationalIds);

  const finalRows: BatchRow[] = [];
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
