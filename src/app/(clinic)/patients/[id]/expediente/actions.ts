"use server";
import "server-only";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { readOnlyBlock } from "@/lib/supabase/clinic-access";
import { findSection, pickHistoryChanges, sectionsForSex, type HistorySection } from "@/lib/domain/medical-history";

export type HistoryFormState = { error?: string } | undefined;

/**
 * Abrir el expediente y completar/corregir la historia general: solo admin y médicos. La barrera real
 * son las funciones open_patient_record / save_medical_history (verifican rol, clínica y paciente no
 * anulado, y dejan una revisión por cada campo que cambia); el chequeo de aquí es comodidad.
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
    return { supabase, error: "Solo los médicos y el administrador manejan el expediente." };
  }
  const blocked = await readOnlyBlock(supabase);
  if (blocked) return { supabase, error: blocked };
  return { supabase, error: null };
}

function friendly(error: { code?: string; message: string }): string {
  if (error.code === "22023" || error.code === "42501") return error.message;
  if (error.message.includes("modo solo lectura")) return error.message;
  return "No se pudo guardar. Intenta de nuevo.";
}

async function patientSections(supabase: Awaited<ReturnType<typeof createClient>>, patientId: string): Promise<HistorySection[] | null> {
  const { data } = await supabase.from("patients").select("sex").eq("id", patientId).maybeSingle();
  return data ? sectionsForSex(data.sex) : null;
}

export async function openPatientRecord(patientId: string, _prev: HistoryFormState, formData: FormData): Promise<HistoryFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const sections = await patientSections(ctx.supabase, patientId);
  if (!sections) return { error: "No se encontró el paciente." };

  const { error } = await ctx.supabase.rpc("open_patient_record", {
    p_patient_id: patientId,
    p_history: pickHistoryChanges(formData, sections),
  });
  if (error) return { error: friendly(error) };

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?tab=expediente`);
}

export async function savePatientHistory(
  patientId: string,
  sectionId: string,
  _prev: HistoryFormState,
  formData: FormData
): Promise<HistoryFormState> {
  const ctx = await clinicianContext();
  if (ctx.error) return { error: ctx.error };
  const all = await patientSections(ctx.supabase, patientId);
  if (!all) return { error: "No se encontró el paciente." };
  const section = sectionId === "todas" ? null : findSection(sectionId);
  const sections = section ? all.filter((s) => s.id === section.id) : all;
  if (sections.length === 0) return { error: "Esa sección no corresponde a este paciente." };

  const { error } = await ctx.supabase.rpc("save_medical_history", {
    p_patient_id: patientId,
    p_changes: pickHistoryChanges(formData, sections),
    p_reason: String(formData.get("reason") ?? "").trim(),
  });
  if (error) return { error: friendly(error) };

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}?tab=expediente`);
}
