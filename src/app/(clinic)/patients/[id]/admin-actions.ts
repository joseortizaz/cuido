"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { createAdminClient } from "@/lib/supabase/admin";

export type PatientAdminState = { error?: string; success?: string } | undefined;

/**
 * Eliminar, anular y marcar pacientes de prueba: solo el administrador. El chequeo de rol aquí es
 * comodidad; la barrera real son las funciones de la base (verifican admin y clínica adentro, y
 * respetan el modo solo lectura). Sus mensajes ya están en español (errcode 22023 / 42501).
 */
async function adminContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") return { supabase, error: "Solo el administrador puede hacer esto." as const };
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { supabase, error: blocked };
  return { supabase, error: null };
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501") return error.message;
  if ((error.message ?? "").includes("modo solo lectura")) return error.message;
  return "No se pudo completar la acción. Intenta de nuevo.";
}

export async function deleteTestPatient(patientId: string): Promise<PatientAdminState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  // Los archivos de sus estudios viven en Storage: la base borra las filas en cascada pero no los archivos.
  const { data: studyFiles } = await ctx.supabase.from("study_attachments").select("storage_path").eq("patient_id", patientId);
  const { error } = await ctx.supabase.rpc("delete_test_patient", { p_patient_id: patientId });
  if (error) return { error: friendly(error) };
  const paths = (studyFiles ?? []).map((f) => f.storage_path);
  if (paths.length > 0) await createAdminClient().storage.from("study-results").remove(paths);
  revalidatePath("/patients");
  redirect("/patients");
}

export async function deleteEmptyPatient(
  patientId: string,
  _prev: PatientAdminState,
  formData: FormData
): Promise<PatientAdminState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("delete_empty_patient", {
    p_patient_id: patientId,
    p_confirm_name: String(formData.get("confirm_name") ?? ""),
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/patients");
  redirect("/patients");
}

export async function voidPatient(
  patientId: string,
  _prev: PatientAdminState,
  formData: FormData
): Promise<PatientAdminState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("void_patient", {
    p_patient_id: patientId,
    p_reason: String(formData.get("reason") ?? ""),
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/patients");
  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

export async function unvoidPatient(patientId: string): Promise<PatientAdminState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("unvoid_patient", { p_patient_id: patientId });
  if (error) return { error: friendly(error) };
  revalidatePath("/patients");
  revalidatePath(`/patients/${patientId}`);
  return { success: "Paciente reactivado." };
}

export async function setPatientTestFlag(patientId: string, isTest: boolean): Promise<PatientAdminState> {
  const ctx = await adminContext();
  if (ctx.error) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("set_patient_test_flag", { p_patient_id: patientId, p_is_test: isTest });
  if (error) return { error: friendly(error) };
  revalidatePath("/patients");
  revalidatePath(`/patients/${patientId}`);
  return { success: isTest ? "Marcado como paciente de prueba." : "Ya no es paciente de prueba." };
}
