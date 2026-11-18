"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import {
  ALLOWED_STUDY_MIME_TYPES,
  MAX_STUDY_FILES,
  MAX_STUDY_FILE_BYTES,
  buildStudyStoragePath,
  isStudyCategory,
  parseStudyValuesFromForm,
  sniffStudyMime,
  type StudyMimeType,
} from "@/lib/domain/study-results";
import type { Json } from "@/lib/supabase/database.types";

export type StudyFormState = { error?: string; success?: string } | undefined;

const BUCKET = "study-results";

/**
 * Estudios y analíticas: solo admin y médicos. La barrera real son las funciones de la base
 * (create_study_result, update_study_result, void_study_result, register_study_attachment…) y las políticas
 * de Storage; el chequeo de rol y de solo lectura de aquí es comodidad.
 */
async function clinicianContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    return { supabase, error: "Solo los médicos y el administrador manejan los estudios." as string | null };
  }
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { supabase, error: blocked as string | null };
  return { supabase, error: null as string | null };
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501" || error.message.includes("modo solo lectura")) return error.message;
  return "No se pudo guardar. Intenta de nuevo.";
}

const dateOrNull = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

// ---------------------------------------------------------------------------------------------
// Crear, indicar, corregir y anular
// ---------------------------------------------------------------------------------------------

export async function createStudy(patientId: string, _prev: StudyFormState, formData: FormData): Promise<StudyFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };

  const category = String(formData.get("category") ?? "");
  if (!isStudyCategory(category)) return { error: "Elige la categoría del estudio." };
  const name = String(formData.get("study_name") ?? "").trim();
  if (!name) return { error: "El nombre del estudio es obligatorio." };
  const mode = formData.get("mode") === "recibido" ? "recibido" : "pendiente";
  const parsed = parseStudyValuesFromForm(formData);
  if (parsed.error) return { error: parsed.error };

  const { data: studyId, error } = await ctx.supabase.rpc("create_study_result", {
    p_patient_id: patientId,
    p_category: category,
    p_study_name: name,
    ...(dateOrNull(formData.get("ordered_at")) ? { p_ordered_at: dateOrNull(formData.get("ordered_at"))! } : {}),
    ...(dateOrNull(formData.get("performed_at")) ? { p_performed_at: dateOrNull(formData.get("performed_at"))! } : {}),
    p_result_text: String(formData.get("result_text") ?? ""),
    p_result_values: parsed.values as unknown as Json,
    p_interpretation: String(formData.get("interpretation") ?? ""),
    p_status: mode,
    ...(formData.get("encounter_id") ? { p_encounter_id: String(formData.get("encounter_id")) } : {}),
  });
  if (error || !studyId) return { error: error ? friendly(error) : "No se pudo guardar." };

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/studies/${studyId}?adjuntar=1`);
}

/** Indicar un estudio desde una consulta: queda «pendiente» hasta que llegue el resultado. */
export async function orderStudyFromEncounter(
  patientId: string,
  encounterId: string,
  _prev: StudyFormState,
  formData: FormData
): Promise<StudyFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const category = String(formData.get("category") ?? "");
  if (!isStudyCategory(category)) return { error: "Elige la categoría del estudio." };
  const name = String(formData.get("study_name") ?? "").trim();
  if (!name) return { error: "El nombre del estudio es obligatorio." };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  const { error } = await ctx.supabase.rpc("create_study_result", {
    p_patient_id: patientId,
    p_category: category,
    p_study_name: name,
    p_ordered_at: today,
    p_status: "pendiente",
    p_encounter_id: encounterId,
  });
  if (error) return { error: friendly(error) };

  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/encounters/${encounterId}`);
  return { success: "Estudio indicado: queda pendiente en el expediente." };
}

export async function updateStudy(
  patientId: string,
  studyId: string,
  _prev: StudyFormState,
  formData: FormData
): Promise<StudyFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };

  const category = String(formData.get("category") ?? "");
  if (!isStudyCategory(category)) return { error: "Elige la categoría del estudio." };
  const name = String(formData.get("study_name") ?? "").trim();
  if (!name) return { error: "El nombre del estudio es obligatorio." };
  const status = formData.get("status") === "recibido" ? "recibido" : "pendiente";
  const parsed = parseStudyValuesFromForm(formData);
  if (parsed.error) return { error: parsed.error };

  const { error } = await ctx.supabase.rpc("update_study_result", {
    p_study_id: studyId,
    p_changes: {
      category,
      study_name: name,
      ordered_at: dateOrNull(formData.get("ordered_at")) ?? "",
      performed_at: dateOrNull(formData.get("performed_at")) ?? "",
      result_text: String(formData.get("result_text") ?? ""),
      result_values: parsed.values,
      interpretation: String(formData.get("interpretation") ?? ""),
      status,
    } as unknown as Json,
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error) return { error: friendly(error) };

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/studies/${studyId}`);
}

export async function voidStudy(
  patientId: string,
  studyId: string,
  _prev: StudyFormState,
  formData: FormData
): Promise<StudyFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("void_study_result", {
    p_study_id: studyId,
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}/studies/${studyId}`);
}

// ---------------------------------------------------------------------------------------------
// Archivos adjuntos. El archivo viaja DIRECTO del navegador a Storage (Vercel limita el cuerpo de una
// función a ~4.5 MB, y un PDF puede pesar 10): el servidor autoriza (URL firmada de subida para una ruta
// que él mismo genera) y, al terminar, verifica el archivo y registra sus metadatos.
// ---------------------------------------------------------------------------------------------

export type PrepareUploadResult = { path: string; token: string } | { error: string };

export async function prepareStudyFileUpload(
  studyId: string,
  fileName: string,
  size: number,
  declaredMime: string
): Promise<PrepareUploadResult> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  if (!(ALLOWED_STUDY_MIME_TYPES as readonly string[]).includes(declaredMime)) {
    return { error: `«${fileName}»: solo se admiten archivos PDF, JPG o PNG.` };
  }
  if (!Number.isFinite(size) || size < 1) return { error: `«${fileName}» está vacío.` };
  if (size > MAX_STUDY_FILE_BYTES) return { error: `«${fileName}» pasa de 10 MB.` };

  // RLS: si el usuario no puede ver el estudio (o es de otra clínica) no se obtiene nada.
  const { data: study } = await ctx.supabase
    .from("study_results")
    .select("id, clinic_id, patient_id, status")
    .eq("id", studyId)
    .maybeSingle();
  if (!study) return { error: "No se encontró el estudio." };
  if (study.status === "anulado") return { error: "Un estudio anulado no admite archivos." };
  const { count } = await ctx.supabase
    .from("study_attachments")
    .select("id", { count: "exact", head: true })
    .eq("study_id", studyId)
    .is("removed_at", null);
  if ((count ?? 0) >= MAX_STUDY_FILES) return { error: `Un estudio admite como máximo ${MAX_STUDY_FILES} adjuntos.` };

  const path = buildStudyStoragePath(study.clinic_id, study.patient_id, studyId, crypto.randomUUID(), fileName);
  const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: "No se pudo preparar la subida del archivo." };
  return { path, token: data.token };
}

/** Verifica el archivo ya subido (tipo REAL por sus primeros bytes y tamaño) y registra sus metadatos. */
export async function finalizeStudyFileUpload(
  patientId: string,
  studyId: string,
  path: string,
  fileName: string
): Promise<{ error?: string; ok?: boolean }> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  if (!path.includes(`/${patientId}/${studyId}/`)) return { error: "La ruta del archivo no corresponde a este estudio." };

  const discard = async () => {
    // Un archivo que no pasó la verificación nunca se registró: se retira del bucket (única vez que el servidor borra).
    await createAdminClient().storage.from(BUCKET).remove([path]);
  };

  const { data: signed } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (!signed?.signedUrl) return { error: `«${fileName}»: no se encontró el archivo subido.` };
  const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-15" }, cache: "no-store" });
  if (!res.ok && res.status !== 206) {
    await discard();
    return { error: `«${fileName}»: no se pudo verificar el archivo.` };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1] ?? res.headers.get("content-length") ?? 0);
  const mime: StudyMimeType | null = sniffStudyMime(bytes);
  if (!mime) {
    await discard();
    return { error: `«${fileName}» no es un PDF, JPG o PNG válido.` };
  }
  if (!Number.isFinite(total) || total < 1 || total > MAX_STUDY_FILE_BYTES) {
    await discard();
    return { error: `«${fileName}» pasa de 10 MB.` };
  }

  const { error } = await ctx.supabase.rpc("register_study_attachment", {
    p_study_id: studyId,
    p_storage_path: path,
    p_file_name: fileName,
    p_mime_type: mime,
    p_size_bytes: total,
  });
  if (error) {
    await discard();
    return { error: friendly(error) };
  }
  revalidatePath(`/patients/${patientId}/studies/${studyId}`);
  return { ok: true };
}

export async function voidStudyAttachment(
  patientId: string,
  studyId: string,
  attachmentId: string,
  _prev: StudyFormState,
  formData: FormData
): Promise<StudyFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("void_study_attachment", {
    p_attachment_id: attachmentId,
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error) return { error: friendly(error) };
  revalidatePath(`/patients/${patientId}/studies/${studyId}`);
  return { success: "Adjunto retirado (el archivo se conserva)." };
}
